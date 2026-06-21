-- ============================================================
-- 0165: cob_cv_resumenes + cob_cv_resumen_lines + soporte base
--
-- Objetivo:
--   - Crear historial formal de resúmenes mensuales para Cargo de Vuelta
--   - Mantener snapshots inmutables por caso y período
--   - Separar monto aplicado al balance vs fee de plataforma
--   - Incorporar créditos/ajustes que reducen saldo por mercancía devuelta
--
-- Importante:
--   - NO toca DFP (`cob_statements`, `fn_cob_statement_generar`)
--   - NO activa envío automático
--   - Los resúmenes nacen en status = 'draft'
-- ============================================================

begin;

-- ── 0. Soporte mínimo en cob_pagos para separar balance vs fee ───────────────
-- Regla de compatibilidad:
--   - filas legacy: si monto_aplicado_balance es null, asumir que todo `monto`
--     se aplicó al balance y fee_plataforma = 0.

alter table public.cob_pagos
  add column if not exists monto_aplicado_balance numeric(12,2)
    check (monto_aplicado_balance is null or monto_aplicado_balance >= 0),
  add column if not exists fee_plataforma numeric(12,2) not null default 0
    check (fee_plataforma >= 0);

comment on column public.cob_pagos.monto is
  'Campo legacy del monto recibido. Para resúmenes nuevos, el saldo del caso debe calcularse usando monto_aplicado_balance si existe; si es null, se asume que monto se aplicó completo al balance.';

comment on column public.cob_pagos.monto_aplicado_balance is
  'Monto del cobro que realmente reduce el balance del caso. Debe excluir fee de plataforma, recargos de procesador u otros montos que no reduzcan principal operativo.';

comment on column public.cob_pagos.fee_plataforma is
  'Fee cobrado al cliente por plataforma/pasarela/tarjeta. Nunca reduce el balance principal operativo del caso.';

-- CORRECCIÓN v2: columna real en cob_pagos es cargo_vuelta_case_id (confirmada en prod)
create index if not exists cob_pagos_cv_case_fecha_balance_idx
  on public.cob_pagos (cargo_vuelta_case_id, fecha_pago desc)
  where cargo_vuelta_case_id is not null;

-- ── 1. Fuente operativa para créditos / ajustes que reducen balance ──────────
-- Alcance inicial:
--   - reducción por devolución parcial de mercancía
--   - bonificación / goodwill
--   - ajuste manual auditado
--
-- Nota:
--   En esta fase solo modelamos ajustes que REDUCEN balance.
--   Si luego se requieren ajustes que incrementen balance, van en una fase
--   aparte para no mezclar signos ambiguos en este histórico.

create table if not exists public.cob_cv_balance_adjustments (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null,
  case_id                  uuid not null references public.cargo_vuelta_cases(id) on delete cascade,
  cliente_id               uuid not null references public.clientes(id) on delete cascade,
  clase                    text not null check (clase in ('credito', 'ajuste')),
  motivo                   text not null check (
                             motivo in (
                               'devolucion_parcial_mercancia',
                               'bonificacion_comercial',
                               'ajuste_manual',
                               'otro'
                             )
                           ),
  monto_aplicado_balance   numeric(12,2) not null check (monto_aplicado_balance >= 0),
  fecha_ajuste             date not null,
  descripcion              text,
  soporte_url              text,
  status                   text not null default 'activo'
                             check (status in ('activo', 'anulado')),
  created_by               uuid references public.usuarios(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.cob_cv_balance_adjustments is
  'Fuente operativa de créditos y ajustes que reducen balance en casos Cargo de Vuelta. Soporta devoluciones parciales de mercancía y ajustes auditados sin mezclar esta lógica con DFP.';

comment on column public.cob_cv_balance_adjustments.clase is
  'credito = reducción del balance por crédito otorgado; ajuste = reducción operativa/manual del balance.';

comment on column public.cob_cv_balance_adjustments.monto_aplicado_balance is
  'Monto que reduce directamente el balance operativo del caso. Siempre positivo en esta fase.';

create index if not exists cob_cv_balance_adjustments_case_fecha_idx
  on public.cob_cv_balance_adjustments (case_id, fecha_ajuste desc);

create index if not exists cob_cv_balance_adjustments_org_status_idx
  on public.cob_cv_balance_adjustments (org_id, status);

alter table public.cob_cv_balance_adjustments enable row level security;

drop policy if exists cob_cv_balance_adjustments_cartera_role on public.cob_cv_balance_adjustments;
create policy cob_cv_balance_adjustments_cartera_role
  on public.cob_cv_balance_adjustments
  for all to authenticated
  using (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() = 'telemercadeo'
    )
  )
  with check (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
    )
  );

drop trigger if exists trg_cob_cv_balance_adjustments_updated_at on public.cob_cv_balance_adjustments;
create trigger trg_cob_cv_balance_adjustments_updated_at
  before update on public.cob_cv_balance_adjustments
  for each row execute function public.fn_set_updated_at();

-- ── 2. Cabecera histórica del resumen mensual de Cargo de Vuelta ─────────────

create table if not exists public.cob_cv_resumenes (
  id                              uuid primary key default gen_random_uuid(),
  org_id                          uuid not null,
  case_id                         uuid not null references public.cargo_vuelta_cases(id) on delete cascade,
  cliente_id                      uuid not null references public.clientes(id) on delete cascade,
  periodo_inicio                  date not null,
  periodo_fin                     date not null,
  fecha_corte                     date not null,

  monto_devuelto_snapshot         numeric(12,2),
  monto_total_legacy_snapshot     numeric(12,2),
  monto_original                  numeric(12,2) not null check (monto_original >= 0),
  monto_base_source               text not null check (monto_base_source in ('monto_devuelto', 'monto_total_legacy')),
  requiere_reconciliacion_snapshot boolean not null default false,

  saldo_apertura_periodo          numeric(12,2) not null check (saldo_apertura_periodo >= 0),
  pagos_periodo                   numeric(12,2) not null default 0 check (pagos_periodo >= 0),
  pagos_acumulados                numeric(12,2) not null default 0 check (pagos_acumulados >= 0),
  fee_plataforma_periodo          numeric(12,2) not null default 0 check (fee_plataforma_periodo >= 0),
  fee_plataforma_acumulado        numeric(12,2) not null default 0 check (fee_plataforma_acumulado >= 0),
  monto_total_cobrado_periodo     numeric(12,2) not null default 0 check (monto_total_cobrado_periodo >= 0),
  monto_total_cobrado_acumulado   numeric(12,2) not null default 0 check (monto_total_cobrado_acumulado >= 0),
  creditos_periodo                numeric(12,2) not null default 0 check (creditos_periodo >= 0),
  creditos_acumulados             numeric(12,2) not null default 0 check (creditos_acumulados >= 0),
  ajustes_periodo                 numeric(12,2) not null default 0 check (ajustes_periodo >= 0),
  ajustes_acumulados              numeric(12,2) not null default 0 check (ajustes_acumulados >= 0),
  saldo_pendiente_corte           numeric(12,2) not null check (saldo_pendiente_corte >= 0),

  proximo_pago_esperado           numeric(12,2),
  fecha_proximo_pago              date,
  fuente_proximo_pago             text,

  status                          text not null default 'draft'
                                    check (status in ('draft', 'enviado', 'anulado')),
  sent_at                         timestamptz,
  outbox_message_id               uuid references public.outbox_messages(id) on delete set null,
  generated_by                    uuid references public.usuarios(id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  -- CORRECCIÓN v2: fecha_corte debe ser <= periodo_fin (snapshot mid-period válido)
  -- La constraint original (fecha_corte >= periodo_fin) bloqueaba snapshots intermedios.
  constraint cob_cv_resumenes_periodo_chk
    check (
      periodo_fin >= periodo_inicio
      and fecha_corte >= periodo_inicio
      and fecha_corte <= periodo_fin
    ),
  constraint cob_cv_resumenes_case_periodo_uidx
    unique (case_id, periodo_inicio, periodo_fin)
);

comment on table public.cob_cv_resumenes is
  'Snapshot histórico mensual del balance recuperable de un caso Cargo de Vuelta. Cada fila representa un documento inmutable por período y siempre nace en draft en esta fase.';

comment on column public.cob_cv_resumenes.monto_original is
  'Monto base del caso para el snapshot. La fuente oficial esperada es cargo_vuelta_cases.monto_devuelto; se permite fallback a monto_total_legacy solo para compatibilidad mientras existan casos legacy.';

comment on column public.cob_cv_resumenes.pagos_periodo is
  'Monto aplicado al balance dentro del período. No incluye fee de plataforma.';

comment on column public.cob_cv_resumenes.monto_total_cobrado_periodo is
  'Monto total cobrado al cliente en el período: pagos_periodo + fee_plataforma_periodo.';

comment on column public.cob_cv_resumenes.saldo_pendiente_corte is
  'Saldo pendiente al corte calculado como monto_original - pagos_acumulados - creditos_acumulados - ajustes_acumulados.';

create index if not exists cob_cv_resumenes_org_periodo_idx
  on public.cob_cv_resumenes (org_id, periodo_fin desc, created_at desc);

create index if not exists cob_cv_resumenes_case_status_idx
  on public.cob_cv_resumenes (case_id, status, created_at desc);

alter table public.cob_cv_resumenes enable row level security;

drop policy if exists cob_cv_resumenes_cartera_role on public.cob_cv_resumenes;
create policy cob_cv_resumenes_cartera_role
  on public.cob_cv_resumenes
  for all to authenticated
  using (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() = 'telemercadeo'
    )
  )
  with check (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
    )
  );

drop trigger if exists trg_cob_cv_resumenes_updated_at on public.cob_cv_resumenes;
create trigger trg_cob_cv_resumenes_updated_at
  before update on public.cob_cv_resumenes
  for each row execute function public.fn_set_updated_at();

-- ── 3. Líneas históricas del resumen mensual ─────────────────────────────────

create table if not exists public.cob_cv_resumen_lines (
  id                             uuid primary key default gen_random_uuid(),
  org_id                         uuid not null,
  resumen_id                     uuid not null references public.cob_cv_resumenes(id) on delete cascade,
  case_id                        uuid not null references public.cargo_vuelta_cases(id) on delete cascade,
  cliente_id                     uuid not null references public.clientes(id) on delete cascade,
  line_number                    integer not null check (line_number > 0),
  line_type                      text not null check (
                                   line_type in (
                                     'saldo_apertura',
                                     'pago',
                                     'credito',
                                     'ajuste',
                                     'saldo_cierre',
                                     'proximo_pago'
                                   )
                                 ),
  source_table                   text,
  source_id                      uuid,
  event_date                     date,
  description                    text not null,
  monto_aplicado_balance         numeric(12,2) not null default 0,
  fee_plataforma                 numeric(12,2) not null default 0,
  monto_total_cobrado_cliente    numeric(12,2) not null default 0,
  running_balance_after          numeric(12,2),
  metadata                       jsonb,
  created_at                     timestamptz not null default now(),

  constraint cob_cv_resumen_lines_line_uidx
    unique (resumen_id, line_number),
  constraint cob_cv_resumen_lines_amounts_chk
    check (
      monto_aplicado_balance >= 0
      and fee_plataforma >= 0
      and monto_total_cobrado_cliente >= 0
    )
);

comment on table public.cob_cv_resumen_lines is
  'Detalle histórico del resumen mensual de Cargo de Vuelta. Guarda eventos de apertura, pagos, créditos, ajustes, cierre y próximo pago esperado.';

comment on column public.cob_cv_resumen_lines.running_balance_after is
  'Saldo pendiente inmediatamente después de aplicar la línea dentro del documento.';

create index if not exists cob_cv_resumen_lines_resumen_idx
  on public.cob_cv_resumen_lines (resumen_id, line_number);

alter table public.cob_cv_resumen_lines enable row level security;

drop policy if exists cob_cv_resumen_lines_cartera_role on public.cob_cv_resumen_lines;
create policy cob_cv_resumen_lines_cartera_role
  on public.cob_cv_resumen_lines
  for all to authenticated
  using (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() = 'telemercadeo'
    )
  )
  with check (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
    )
  );

commit;
