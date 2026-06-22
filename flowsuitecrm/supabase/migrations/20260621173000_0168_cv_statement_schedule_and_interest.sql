begin;

-- ============================================================
-- 0168: cv statement schedule + interest projection
--
-- Objetivo:
--   - Formalizar calendario documental para Cargo de Vuelta aprobado
--   - Guardar APR por caso (no global) como decimal
--   - Permitir proyección de interés hasta due_date
--   - Mantener compatibilidad con fn_cv_resumen_generar existente
--
-- Reglas aprobadas:
--   - cv_approval_date = fecha de aprobación
--   - cv_due_date = cv_approval_date + 15 días
--   - cv_statement_date = cv_due_date - 10 días
--   - cv_interest_period_start = cv_approval_date
--   - cv_interest_period_end = cv_due_date
--   - APR por caso: cv_interest_apr numeric(6,5)
--   - Fórmula:
--       interest_amount = round(balance_base * cv_interest_apr / 365 * interest_days, 2)
--   - balance_base recomendado:
--       saldo_pendiente_corte al statement_date
--
-- Importante:
--   - No define APR global
--   - No activa cron
--   - No envía mensajes
--   - No marca statement_generated automáticamente salvo parámetro explícito
-- ============================================================

-- ── 1. cargo_vuelta_cases: schedule + APR por caso ──────────────────────────

alter table public.cargo_vuelta_cases
  add column if not exists cv_approval_date date,
  add column if not exists cv_due_date date,
  add column if not exists cv_statement_date date,
  add column if not exists cv_interest_period_start date,
  add column if not exists cv_interest_period_end date,
  add column if not exists cv_interest_apr numeric(6,5),
  add column if not exists cv_interest_method text not null default 'daily_simple_365',
  add column if not exists cv_statement_schedule_status text not null default 'pending_approval',
  add column if not exists cv_statement_generated_at timestamptz,
  add column if not exists cv_statement_last_resumen_id uuid;

comment on column public.cargo_vuelta_cases.cv_approval_date is
  'Fecha oficial de aprobación del financiamiento CV. Dispara due_date, statement_date y período de interés.';

comment on column public.cargo_vuelta_cases.cv_due_date is
  'Fecha límite de pago del statement CV. Regla aprobada: cv_approval_date + 15 días.';

comment on column public.cargo_vuelta_cases.cv_statement_date is
  'Fecha en que debe generarse el statement CV. Regla aprobada: cv_due_date - 10 días.';

comment on column public.cargo_vuelta_cases.cv_interest_period_start is
  'Inicio del período de interés CV. Regla aprobada: cv_approval_date.';

comment on column public.cargo_vuelta_cases.cv_interest_period_end is
  'Fin del período de interés CV. Regla aprobada: cv_due_date.';

comment on column public.cargo_vuelta_cases.cv_interest_apr is
  'APR anual acordado para este caso CV, guardado como decimal. Ejemplos: 0.00000=0%, 0.18000=18%, 0.24000=24%, 0.29990=29.99%. No existe APR global fijo.';

comment on column public.cargo_vuelta_cases.cv_interest_method is
  'Método de cálculo de interés CV. Fase actual: daily_simple_365.';

comment on column public.cargo_vuelta_cases.cv_statement_schedule_status is
  'Estado del calendario documental CV: pending_approval, approved_pending_statement, statement_ready, statement_generated, void.';

comment on column public.cargo_vuelta_cases.cv_statement_generated_at is
  'Timestamp de la generación documental oficial más reciente del statement CV. Debe ser manejado por el job futuro o por una llamada explícita.';

comment on column public.cargo_vuelta_cases.cv_statement_last_resumen_id is
  'Último cob_cv_resumenes.id generado como statement CV para este caso.';

alter table public.cargo_vuelta_cases
  drop constraint if exists cargo_vuelta_cases_cv_interest_apr_chk;

alter table public.cargo_vuelta_cases
  add constraint cargo_vuelta_cases_cv_interest_apr_chk
  check (
    cv_interest_apr is null
    or (cv_interest_apr >= 0 and cv_interest_apr <= 0.99999)
  );

alter table public.cargo_vuelta_cases
  drop constraint if exists cargo_vuelta_cases_cv_interest_method_chk;

alter table public.cargo_vuelta_cases
  add constraint cargo_vuelta_cases_cv_interest_method_chk
  check (cv_interest_method in ('daily_simple_365'));

alter table public.cargo_vuelta_cases
  drop constraint if exists cargo_vuelta_cases_cv_statement_schedule_status_chk;

alter table public.cargo_vuelta_cases
  add constraint cargo_vuelta_cases_cv_statement_schedule_status_chk
  check (
    cv_statement_schedule_status in (
      'pending_approval',
      'approved_pending_statement',
      'statement_ready',
      'statement_generated',
      'void'
    )
  );

alter table public.cargo_vuelta_cases
  drop constraint if exists cargo_vuelta_cases_cv_schedule_consistency_chk;

alter table public.cargo_vuelta_cases
  add constraint cargo_vuelta_cases_cv_schedule_consistency_chk
  check (
    (
      cv_statement_schedule_status = 'pending_approval'
    )
    or
    (
      cv_statement_schedule_status in (
        'approved_pending_statement',
        'statement_ready',
        'statement_generated'
      )
      and cv_approval_date is not null
      and cv_interest_apr is not null
      and cv_due_date is not null
      and cv_statement_date is not null
      and cv_interest_period_start is not null
      and cv_interest_period_end is not null
      and cv_interest_period_start = cv_approval_date
      and cv_due_date = cv_approval_date + 15
      and cv_statement_date = cv_due_date - 10
      and cv_interest_period_end = cv_due_date
      and cv_statement_date <= cv_due_date
    )
    or
    (
      cv_statement_schedule_status = 'void'
    )
  );

alter table public.cargo_vuelta_cases
  drop constraint if exists cargo_vuelta_cases_cv_statement_last_resumen_fkey;

alter table public.cargo_vuelta_cases
  add constraint cargo_vuelta_cases_cv_statement_last_resumen_fkey
  foreign key (cv_statement_last_resumen_id)
  references public.cob_cv_resumenes(id)
  on delete set null
  not valid;

create index if not exists cargo_vuelta_cases_cv_statement_date_status_idx
  on public.cargo_vuelta_cases (cv_statement_date, cv_statement_schedule_status)
  where cv_statement_date is not null;

create index if not exists cargo_vuelta_cases_cv_due_date_idx
  on public.cargo_vuelta_cases (cv_due_date)
  where cv_due_date is not null;

-- ── 2. cob_cv_resumenes: snapshots obligatorios de schedule/interés ─────────

alter table public.cob_cv_resumenes
  add column if not exists approval_date_snapshot date,
  add column if not exists statement_date_snapshot date,
  add column if not exists due_date_snapshot date,
  add column if not exists interest_period_start_snapshot date,
  add column if not exists interest_period_end_snapshot date,
  add column if not exists interest_days_snapshot integer not null default 0,
  add column if not exists interest_apr_snapshot numeric(6,5),
  add column if not exists interest_method_snapshot text,
  add column if not exists interest_amount_periodo numeric(12,2) not null default 0,
  add column if not exists interest_amount_acumulado numeric(12,2) not null default 0,
  add column if not exists balance_proyectado_due_date numeric(12,2) not null default 0;

comment on column public.cob_cv_resumenes.approval_date_snapshot is
  'Snapshot de la fecha de aprobación CV usada para este documento.';

comment on column public.cob_cv_resumenes.statement_date_snapshot is
  'Snapshot de la fecha oficial del statement CV usada para este documento.';

comment on column public.cob_cv_resumenes.due_date_snapshot is
  'Snapshot de la fecha límite de pago CV usada para este documento.';

comment on column public.cob_cv_resumenes.interest_period_start_snapshot is
  'Snapshot del inicio del período de interés CV usado para este documento.';

comment on column public.cob_cv_resumenes.interest_period_end_snapshot is
  'Snapshot del fin del período de interés CV usado para este documento.';

comment on column public.cob_cv_resumenes.interest_days_snapshot is
  'Cantidad de días usados para la proyección de interés CV del documento.';

comment on column public.cob_cv_resumenes.interest_apr_snapshot is
  'APR CV usado al momento de generar el documento, guardado como decimal.';

comment on column public.cob_cv_resumenes.interest_method_snapshot is
  'Método de cálculo de interés CV snapshoteado para este documento.';

comment on column public.cob_cv_resumenes.interest_amount_periodo is
  'Interés proyectado para este statement CV desde approval_date hasta due_date.';

comment on column public.cob_cv_resumenes.interest_amount_acumulado is
  'Acumulado de interés proyectado reflejado en este documento. En esta fase coincide con interest_amount_periodo.';

comment on column public.cob_cv_resumenes.balance_proyectado_due_date is
  'Saldo proyectado al due_date = saldo_pendiente_corte + interest_amount_periodo.';

alter table public.cob_cv_resumenes
  drop constraint if exists cob_cv_resumenes_interest_days_snapshot_chk;

alter table public.cob_cv_resumenes
  add constraint cob_cv_resumenes_interest_days_snapshot_chk
  check (interest_days_snapshot >= 0);

alter table public.cob_cv_resumenes
  drop constraint if exists cob_cv_resumenes_interest_apr_snapshot_chk;

alter table public.cob_cv_resumenes
  add constraint cob_cv_resumenes_interest_apr_snapshot_chk
  check (
    interest_apr_snapshot is null
    or (interest_apr_snapshot >= 0 and interest_apr_snapshot <= 0.99999)
  );

alter table public.cob_cv_resumenes
  drop constraint if exists cob_cv_resumenes_interest_amount_periodo_chk;

alter table public.cob_cv_resumenes
  add constraint cob_cv_resumenes_interest_amount_periodo_chk
  check (interest_amount_periodo >= 0);

alter table public.cob_cv_resumenes
  drop constraint if exists cob_cv_resumenes_interest_amount_acumulado_chk;

alter table public.cob_cv_resumenes
  add constraint cob_cv_resumenes_interest_amount_acumulado_chk
  check (interest_amount_acumulado >= 0);

alter table public.cob_cv_resumenes
  drop constraint if exists cob_cv_resumenes_balance_proyectado_due_date_chk;

alter table public.cob_cv_resumenes
  add constraint cob_cv_resumenes_balance_proyectado_due_date_chk
  check (balance_proyectado_due_date >= 0);

create index if not exists cob_cv_resumenes_due_statement_snapshot_idx
  on public.cob_cv_resumenes (due_date_snapshot, statement_date_snapshot);

-- ── 3. cob_cv_resumen_lines: permitir cargo_interes ──────────────────────────

alter table public.cob_cv_resumen_lines
  drop constraint if exists cob_cv_resumen_lines_line_type_check;

alter table public.cob_cv_resumen_lines
  add constraint cob_cv_resumen_lines_line_type_check
  check (
    line_type in (
      'saldo_apertura',
      'pago',
      'credito',
      'ajuste',
      'cargo_interes',
      'saldo_cierre',
      'proximo_pago'
    )
  );

comment on column public.cob_cv_resumen_lines.line_type is
  'Tipos de línea CV: saldo_apertura, pago, credito, ajuste, cargo_interes, saldo_cierre, proximo_pago.';

-- ── 4. Helper: calendario oficial CV ─────────────────────────────────────────

drop function if exists public.fn_cv_calcular_statement_schedule(date);

create or replace function public.fn_cv_calcular_statement_schedule(
  p_approval_date date
)
returns table (
  approval_date          date,
  due_date               date,
  statement_date         date,
  interest_period_start  date,
  interest_period_end    date,
  interest_days          integer
)
language plpgsql
immutable
as $$
begin
  if p_approval_date is null then
    return;
  end if;

  approval_date := p_approval_date;
  due_date := p_approval_date + 15;
  statement_date := due_date - 10;
  interest_period_start := p_approval_date;
  interest_period_end := due_date;
  interest_days := greatest((interest_period_end - interest_period_start), 0);

  return next;
end;
$$;

comment on function public.fn_cv_calcular_statement_schedule(date) is
  'Calcula el calendario oficial CV desde la aprobación: due_date = approval + 15, statement_date = due_date - 10, interest_period = approval → due_date.';

revoke all on function public.fn_cv_calcular_statement_schedule(date) from public, anon;
grant execute on function public.fn_cv_calcular_statement_schedule(date) to authenticated;

-- ── 5. Helper: interés proyectado CV ─────────────────────────────────────────

drop function if exists public.fn_cv_calcular_interes_proyectado(numeric, numeric, date, date);

create or replace function public.fn_cv_calcular_interes_proyectado(
  p_balance_base numeric,
  p_apr          numeric,
  p_start_date   date,
  p_end_date     date
)
returns table (
  interest_days   integer,
  interest_amount numeric(12,2)
)
language plpgsql
immutable
as $$
declare
  v_days integer;
begin
  if p_start_date is null or p_end_date is null then
    interest_days := 0;
    interest_amount := 0;
    return next;
  end if;

  v_days := greatest((p_end_date - p_start_date), 0);

  interest_days := v_days;
  interest_amount := round(
    coalesce(p_balance_base, 0)::numeric
    * coalesce(p_apr, 0)::numeric
    / 365.0
    * v_days::numeric,
    2
  );

  if interest_amount < 0 then
    interest_amount := 0;
  end if;

  return next;
end;
$$;

comment on function public.fn_cv_calcular_interes_proyectado(numeric, numeric, date, date) is
  'Calcula interés proyectado CV con método daily_simple_365. APR guardado como decimal: 0.18000 = 18%%. Fórmula: balance_base * apr / 365 * días.';

revoke all on function public.fn_cv_calcular_interes_proyectado(numeric, numeric, date, date) from public, anon;
grant execute on function public.fn_cv_calcular_interes_proyectado(numeric, numeric, date, date) to authenticated;

-- ── 6. fn_cv_resumen_generar v3 (firma nueva) ───────────────────────────────
-- Compatibilidad:
--   - se mantiene wrapper legacy de 5 parámetros
--   - la firma nueva agrega:
--       p_allow_missing_apr_for_draft boolean
--       p_mark_statement_generated boolean

drop function if exists public.fn_cv_resumen_generar(uuid, date, date, date, uuid);
drop function if exists public.fn_cv_resumen_generar(uuid, date, date, date, uuid, boolean, boolean);

create or replace function public.fn_cv_resumen_generar(
  p_case_id                        uuid,
  p_periodo_inicio                 date,
  p_periodo_fin                    date,
  p_fecha_corte                    date,
  p_generated_by                   uuid,
  p_allow_missing_apr_for_draft    boolean,
  p_mark_statement_generated       boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case                        public.cargo_vuelta_cases%rowtype;
  v_caller_org                  uuid;
  v_caller_rol                  text;
  v_resumen_id                  uuid;
  v_fecha_corte                 date;
  v_monto_original              numeric(12,2);
  v_monto_source                text;
  v_requires_reconciliation     boolean := false;

  v_pagos_before                numeric(12,2) := 0;
  v_pagos_periodo               numeric(12,2) := 0;
  v_pagos_acumulados            numeric(12,2) := 0;
  v_fee_before                  numeric(12,2) := 0;
  v_fee_periodo                 numeric(12,2) := 0;
  v_fee_acumulado               numeric(12,2) := 0;

  v_creditos_before             numeric(12,2) := 0;
  v_creditos_periodo            numeric(12,2) := 0;
  v_creditos_acumulados         numeric(12,2) := 0;
  v_ajustes_before              numeric(12,2) := 0;
  v_ajustes_periodo             numeric(12,2) := 0;
  v_ajustes_acumulados          numeric(12,2) := 0;

  v_saldo_apertura              numeric(12,2) := 0;
  v_saldo_cierre                numeric(12,2) := 0;
  v_running_balance             numeric(12,2) := 0;
  v_line_number                 integer := 0;

  v_proximo_pago_esperado       numeric(12,2) := null;
  v_fecha_proximo_pago          date := null;
  v_fuente_proximo_pago         text := null;

  v_schedule                    record;
  v_interest                    record;
  v_interest_amount_periodo     numeric(12,2) := 0;
  v_interest_amount_acumulado   numeric(12,2) := 0;
  v_balance_proyectado_due      numeric(12,2) := 0;

  v_missing_apr_review_mode     boolean := false;
  v_status                      text := 'draft';

  v_row                         record;
begin
  if p_case_id is null then
    raise exception 'CV_CASE_REQUIRED: p_case_id es obligatorio';
  end if;

  if p_periodo_inicio is null or p_periodo_fin is null then
    raise exception 'CV_PERIOD_REQUIRED: periodo_inicio y periodo_fin son obligatorios';
  end if;

  if p_periodo_fin < p_periodo_inicio then
    raise exception 'CV_INVALID_PERIOD: periodo_fin no puede ser menor a periodo_inicio';
  end if;

  select u.org_id into v_caller_org
  from public.usuarios u
  where u.id = coalesce(auth.uid(), p_generated_by)
  limit 1;

  if v_caller_org is null then
    raise exception 'CV_UNAUTHORIZED: usuario sin org_id';
  end if;

  select rol::text into v_caller_rol
  from public.usuarios
  where id = coalesce(auth.uid(), p_generated_by);

  if v_caller_rol is null or v_caller_rol not in ('admin', 'distribuidor', 'supervisor_telemercadeo') then
    raise exception 'CV_UNAUTHORIZED: el rol "%" no tiene permiso para generar resúmenes de cargo de vuelta',
      coalesce(v_caller_rol, 'no_identificado')
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_case_id::text));

  select *
    into v_case
  from public.cargo_vuelta_cases
  where id = p_case_id
    and org_id = v_caller_org
  for update;

  if not found then
    raise exception 'CV_CASE_NOT_FOUND: caso no existe o pertenece a otra organización';
  end if;

  if v_case.tipo_caso <> 'cargo_vuelta' then
    raise exception 'CV_INVALID_CASE_TYPE: este generador solo acepta casos cargo_vuelta';
  end if;

  if exists (
    select 1
    from public.cob_revolving_accounts ra
    where ra.case_id = v_case.id
      and ra.org_id = v_case.org_id
      and ra.estado in ('activo', 'moroso', 'en_plan', 'reestructurado')
  ) then
    raise exception 'CV_HYBRID_OR_DFP_CASE: el caso tiene cuenta revolving activa; no debe usar resumen de cargo de vuelta';
  end if;

  select r.id
    into v_resumen_id
  from public.cob_cv_resumenes r
  where r.case_id = p_case_id
    and r.periodo_inicio = p_periodo_inicio
    and r.periodo_fin = p_periodo_fin
  limit 1;

  if v_resumen_id is not null then
    return v_resumen_id;
  end if;

  if v_case.cv_approval_date is not null then
    select *
      into v_schedule
    from public.fn_cv_calcular_statement_schedule(v_case.cv_approval_date);
  end if;

  if v_case.cv_interest_apr is null then
    if p_allow_missing_apr_for_draft then
      v_missing_apr_review_mode := true;
      v_requires_reconciliation := true;
      v_status := 'draft';
    else
      raise exception 'CV_INTEREST_APR_REQUIRED: el caso no tiene cv_interest_apr definido para generación oficial';
    end if;
  end if;

  if p_fecha_corte is not null then
    v_fecha_corte := p_fecha_corte;
  elsif v_case.cv_statement_date is not null then
    v_fecha_corte := v_case.cv_statement_date;
  else
    v_fecha_corte := least(p_periodo_fin, current_date);
  end if;

  if v_fecha_corte < p_periodo_inicio or v_fecha_corte > p_periodo_fin then
    raise exception 'CV_INVALID_CUTOFF: fecha_corte (%) debe estar entre periodo_inicio (%) y periodo_fin (%)',
      v_fecha_corte, p_periodo_inicio, p_periodo_fin;
  end if;

  if v_case.monto_devuelto is not null and v_case.monto_devuelto > 0 then
    v_monto_original := round(v_case.monto_devuelto, 2);
    v_monto_source := 'monto_devuelto';
  elsif v_case.monto_total is not null and v_case.monto_total > 0 then
    v_monto_original := round(v_case.monto_total, 2);
    v_monto_source := 'monto_total_legacy';
    v_requires_reconciliation := true;
  else
    raise exception 'CV_BASE_AMOUNT_MISSING: el caso no tiene monto_devuelto ni monto_total utilizables';
  end if;

  if v_case.requiere_reconciliacion then
    v_requires_reconciliation := true;
  end if;

  if v_case.monto_devuelto is not null
     and v_case.monto_total is not null
     and abs(v_case.monto_devuelto - v_case.monto_total) > 0.01 then
    v_requires_reconciliation := true;
  end if;

  select
    coalesce(sum(coalesce(p.monto_aplicado_balance, p.monto)), 0)::numeric(12,2),
    coalesce(sum(p.fee_plataforma), 0)::numeric(12,2)
    into v_pagos_before, v_fee_before
  from public.cob_pagos p
  where p.cargo_vuelta_case_id = p_case_id
    and coalesce(p.estado, 'registrado') not in ('anulado', 'rechazado')
    and p.fecha_pago < p_periodo_inicio;

  select
    coalesce(sum(coalesce(p.monto_aplicado_balance, p.monto)), 0)::numeric(12,2),
    coalesce(sum(p.fee_plataforma), 0)::numeric(12,2)
    into v_pagos_periodo, v_fee_periodo
  from public.cob_pagos p
  where p.cargo_vuelta_case_id = p_case_id
    and coalesce(p.estado, 'registrado') not in ('anulado', 'rechazado')
    and p.fecha_pago >= p_periodo_inicio
    and p.fecha_pago <= v_fecha_corte;

  v_pagos_acumulados := round(v_pagos_before + v_pagos_periodo, 2);
  v_fee_acumulado := round(v_fee_before + v_fee_periodo, 2);

  select
    coalesce(sum(case when a.clase = 'credito' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when a.clase = 'ajuste' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2)
    into v_creditos_before, v_ajustes_before
  from public.cob_cv_balance_adjustments a
  where a.case_id = p_case_id
    and a.status = 'activo'
    and a.fecha_ajuste < p_periodo_inicio;

  select
    coalesce(sum(case when a.clase = 'credito' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when a.clase = 'ajuste' then a.monto_aplicado_balance else 0 end), 0)::numeric(12,2)
    into v_creditos_periodo, v_ajustes_periodo
  from public.cob_cv_balance_adjustments a
  where a.case_id = p_case_id
    and a.status = 'activo'
    and a.fecha_ajuste >= p_periodo_inicio
    and a.fecha_ajuste <= v_fecha_corte;

  v_creditos_acumulados := round(v_creditos_before + v_creditos_periodo, 2);
  v_ajustes_acumulados := round(v_ajustes_before + v_ajustes_periodo, 2);

  v_saldo_apertura := greatest(
    round(v_monto_original - v_pagos_before - v_creditos_before - v_ajustes_before, 2),
    0
  );

  v_saldo_cierre := greatest(
    round(v_monto_original - v_pagos_acumulados - v_creditos_acumulados - v_ajustes_acumulados, 2),
    0
  );

  if v_case.cv_due_date is not null then
    select *
      into v_interest
    from public.fn_cv_calcular_interes_proyectado(
      v_saldo_cierre,
      v_case.cv_interest_apr,
      v_case.cv_interest_period_start,
      v_case.cv_interest_period_end
    );

    v_interest_amount_periodo := coalesce(v_interest.interest_amount, 0);
    v_interest_amount_acumulado := v_interest_amount_periodo;
  else
    v_interest_amount_periodo := 0;
    v_interest_amount_acumulado := 0;
  end if;

  v_balance_proyectado_due := round(v_saldo_cierre + v_interest_amount_periodo, 2);

  select
    pp.monto_cuota,
    min(pc.fecha_vencimiento)
  into
    v_proximo_pago_esperado,
    v_fecha_proximo_pago
  from public.cob_plan_pagos pp
  join public.cob_plan_cuotas pc on pc.plan_pago_id = pp.id
  where pp.cargo_vuelta_case_id = p_case_id
    and pp.estado in ('activo', 'vigente')
    and pc.estado not in ('pagado', 'cancelado')
    and pc.fecha_vencimiento >= current_date
  group by pp.monto_cuota
  order by min(pc.fecha_vencimiento) asc
  limit 1;

  if v_fecha_proximo_pago is not null then
    v_fuente_proximo_pago := 'cob_plan_cuotas';
  else
    select
      a.monto_total_cobro,
      a.fecha_proximo_cobro
    into
      v_proximo_pago_esperado,
      v_fecha_proximo_pago
    from public.cob_acuerdos_pago_automatico a
    where a.cargo_vuelta_case_id = p_case_id
      and a.estado = 'activo'
    order by a.created_at desc
    limit 1;

    if v_fecha_proximo_pago is not null then
      v_fuente_proximo_pago := 'cob_acuerdos_pago_automatico';
    end if;
  end if;

  insert into public.cob_cv_resumenes (
    org_id,
    case_id,
    cliente_id,
    periodo_inicio,
    periodo_fin,
    fecha_corte,
    monto_devuelto_snapshot,
    monto_total_legacy_snapshot,
    monto_original,
    monto_base_source,
    requiere_reconciliacion_snapshot,
    saldo_apertura_periodo,
    pagos_periodo,
    pagos_acumulados,
    fee_plataforma_periodo,
    fee_plataforma_acumulado,
    monto_total_cobrado_periodo,
    monto_total_cobrado_acumulado,
    creditos_periodo,
    creditos_acumulados,
    ajustes_periodo,
    ajustes_acumulados,
    saldo_pendiente_corte,
    approval_date_snapshot,
    statement_date_snapshot,
    due_date_snapshot,
    interest_period_start_snapshot,
    interest_period_end_snapshot,
    interest_days_snapshot,
    interest_apr_snapshot,
    interest_method_snapshot,
    interest_amount_periodo,
    interest_amount_acumulado,
    balance_proyectado_due_date,
    proximo_pago_esperado,
    fecha_proximo_pago,
    fuente_proximo_pago,
    status,
    generated_by
  ) values (
    v_case.org_id,
    v_case.id,
    v_case.cliente_id,
    p_periodo_inicio,
    p_periodo_fin,
    v_fecha_corte,
    v_case.monto_devuelto,
    v_case.monto_total,
    v_monto_original,
    v_monto_source,
    v_requires_reconciliation,
    v_saldo_apertura,
    v_pagos_periodo,
    v_pagos_acumulados,
    v_fee_periodo,
    v_fee_acumulado,
    round(v_pagos_periodo + v_fee_periodo, 2),
    round(v_pagos_acumulados + v_fee_acumulado, 2),
    v_creditos_periodo,
    v_creditos_acumulados,
    v_ajustes_periodo,
    v_ajustes_acumulados,
    v_saldo_cierre,
    v_case.cv_approval_date,
    v_case.cv_statement_date,
    v_case.cv_due_date,
    v_case.cv_interest_period_start,
    v_case.cv_interest_period_end,
    coalesce(v_interest.interest_days, 0),
    case when v_missing_apr_review_mode then null else v_case.cv_interest_apr end,
    v_case.cv_interest_method,
    v_interest_amount_periodo,
    v_interest_amount_acumulado,
    v_balance_proyectado_due,
    v_proximo_pago_esperado,
    v_fecha_proximo_pago,
    v_fuente_proximo_pago,
    v_status,
    coalesce(p_generated_by, auth.uid())
  )
  returning id into v_resumen_id;

  v_running_balance := v_saldo_apertura;
  v_line_number := v_line_number + 1;

  insert into public.cob_cv_resumen_lines (
    org_id,
    resumen_id,
    case_id,
    cliente_id,
    line_number,
    line_type,
    event_date,
    description,
    running_balance_after,
    metadata
  ) values (
    v_case.org_id,
    v_resumen_id,
    v_case.id,
    v_case.cliente_id,
    v_line_number,
    'saldo_apertura',
    p_periodo_inicio,
    'Saldo de apertura del período',
    v_running_balance,
    jsonb_build_object(
      'monto_original', v_monto_original,
      'monto_base_source', v_monto_source,
      'pagos_antes_periodo', v_pagos_before,
      'creditos_antes_periodo', v_creditos_before,
      'ajustes_antes_periodo', v_ajustes_before
    )
  );

  for v_row in
    (
      select
        p.fecha_pago as event_date,
        'pago'::text as line_type,
        'cob_pagos'::text as source_table,
        p.id as source_id,
        'Pago recibido'::text as description,
        coalesce(p.monto_aplicado_balance, p.monto)::numeric(12,2) as monto_aplicado_balance,
        coalesce(p.fee_plataforma, 0)::numeric(12,2) as fee_plataforma
      from public.cob_pagos p
      where p.cargo_vuelta_case_id = p_case_id
        and coalesce(p.estado, 'registrado') not in ('anulado', 'rechazado')
        and p.fecha_pago >= p_periodo_inicio
        and p.fecha_pago <= v_fecha_corte

      union all

      select
        a.fecha_ajuste as event_date,
        case when a.clase = 'credito' then 'credito' else 'ajuste' end as line_type,
        'cob_cv_balance_adjustments'::text as source_table,
        a.id as source_id,
        coalesce(a.descripcion, initcap(a.clase) || ' aplicado al balance') as description,
        a.monto_aplicado_balance::numeric(12,2) as monto_aplicado_balance,
        0::numeric(12,2) as fee_plataforma
      from public.cob_cv_balance_adjustments a
      where a.case_id = p_case_id
        and a.status = 'activo'
        and a.fecha_ajuste >= p_periodo_inicio
        and a.fecha_ajuste <= v_fecha_corte
    )
    order by event_date, source_table, source_id
  loop
    if v_row.line_type in ('pago', 'credito', 'ajuste') then
      v_running_balance := greatest(round(v_running_balance - v_row.monto_aplicado_balance, 2), 0);
    end if;

    v_line_number := v_line_number + 1;

    insert into public.cob_cv_resumen_lines (
      org_id,
      resumen_id,
      case_id,
      cliente_id,
      line_number,
      line_type,
      source_table,
      source_id,
      event_date,
      description,
      monto_aplicado_balance,
      fee_plataforma,
      monto_total_cobrado_cliente,
      running_balance_after,
      metadata
    ) values (
      v_case.org_id,
      v_resumen_id,
      v_case.id,
      v_case.cliente_id,
      v_line_number,
      v_row.line_type,
      v_row.source_table,
      v_row.source_id,
      v_row.event_date,
      v_row.description,
      v_row.monto_aplicado_balance,
      v_row.fee_plataforma,
      round(v_row.monto_aplicado_balance + v_row.fee_plataforma, 2),
      v_running_balance,
      jsonb_build_object('generated_by', coalesce(p_generated_by, auth.uid()))
    );
  end loop;

  if v_interest_amount_periodo > 0 or v_missing_apr_review_mode then
    v_line_number := v_line_number + 1;

    insert into public.cob_cv_resumen_lines (
      org_id,
      resumen_id,
      case_id,
      cliente_id,
      line_number,
      line_type,
      event_date,
      description,
      monto_aplicado_balance,
      monto_total_cobrado_cliente,
      running_balance_after,
      metadata
    ) values (
      v_case.org_id,
      v_resumen_id,
      v_case.id,
      v_case.cliente_id,
      v_line_number,
      'cargo_interes',
      v_case.cv_due_date,
      case
        when v_missing_apr_review_mode then 'Interés en revisión manual (APR faltante)'
        else 'Interés proyectado al vencimiento'
      end,
      v_interest_amount_periodo,
      v_interest_amount_periodo,
      v_balance_proyectado_due,
      jsonb_build_object(
        'interest_days', coalesce(v_interest.interest_days, 0),
        'interest_apr', case when v_missing_apr_review_mode then null else v_case.cv_interest_apr end,
        'interest_period_start', v_case.cv_interest_period_start,
        'interest_period_end', v_case.cv_interest_period_end,
        'manual_review', v_missing_apr_review_mode
      )
    );
  end if;

  v_line_number := v_line_number + 1;
  insert into public.cob_cv_resumen_lines (
    org_id,
    resumen_id,
    case_id,
    cliente_id,
    line_number,
    line_type,
    event_date,
    description,
    running_balance_after,
    metadata
  ) values (
    v_case.org_id,
    v_resumen_id,
    v_case.id,
    v_case.cliente_id,
    v_line_number,
    'saldo_cierre',
    v_fecha_corte,
    'Saldo pendiente al statement_date',
    v_saldo_cierre,
    jsonb_build_object(
      'pagos_acumulados', v_pagos_acumulados,
      'creditos_acumulados', v_creditos_acumulados,
      'ajustes_acumulados', v_ajustes_acumulados,
      'balance_proyectado_due_date', v_balance_proyectado_due
    )
  );

  if v_proximo_pago_esperado is not null or v_fecha_proximo_pago is not null then
    v_line_number := v_line_number + 1;
    insert into public.cob_cv_resumen_lines (
      org_id,
      resumen_id,
      case_id,
      cliente_id,
      line_number,
      line_type,
      event_date,
      description,
      monto_aplicado_balance,
      running_balance_after,
      metadata
    ) values (
      v_case.org_id,
      v_resumen_id,
      v_case.id,
      v_case.cliente_id,
      v_line_number,
      'proximo_pago',
      v_fecha_proximo_pago,
      'Próximo pago esperado',
      coalesce(v_proximo_pago_esperado, 0),
      v_saldo_cierre,
      jsonb_build_object('fuente_proximo_pago', v_fuente_proximo_pago)
    );
  end if;

  if p_mark_statement_generated
     and not v_missing_apr_review_mode then
    update public.cargo_vuelta_cases
       set cv_statement_generated_at = now(),
           cv_statement_last_resumen_id = v_resumen_id,
           updated_at = now()
     where id = v_case.id;
  end if;

  return v_resumen_id;
end;
$$;

revoke all on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid, boolean, boolean) from public, anon;
grant execute on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid, boolean, boolean) to authenticated;

comment on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid, boolean, boolean) is
  'v3: soporta calendario CV por caso, APR por caso y proyección de interés hasta due_date. '
  'Modo oficial: APR requerido. Modo manual draft: APR opcional solo con p_allow_missing_apr_for_draft=true. '
  'La firma nueva requiere explícitamente flags de modo y marcado documental para evitar ambigüedad con el wrapper legacy.';

-- ── 7. Wrapper legacy de compatibilidad (5 parámetros) ──────────────────────

create or replace function public.fn_cv_resumen_generar(
  p_case_id         uuid,
  p_periodo_inicio  date,
  p_periodo_fin     date,
  p_fecha_corte     date default null,
  p_generated_by    uuid default null
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.fn_cv_resumen_generar(
    p_case_id,
    p_periodo_inicio,
    p_periodo_fin,
    p_fecha_corte,
    p_generated_by,
    false,
    false
  );
$$;

revoke all on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid) from public, anon;
grant execute on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid) to authenticated;

comment on function public.fn_cv_resumen_generar(uuid, date, date, date, uuid) is
  'Wrapper legacy compatible de 5 parámetros. Llama a la versión v3 con p_allow_missing_apr_for_draft=false y p_mark_statement_generated=false.';

commit;
