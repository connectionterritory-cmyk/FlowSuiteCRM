-- ============================================================
-- 0141: cob_ptps hardening + ptp_id en cob_gestiones
--
-- Contexto:
--   cob_ptps fue creada en 0106 con un modelo base funcional.
--   Esta migración lo completa para operación real:
--     - Agrega canal (por dónde se comprometió el pago)
--     - Agrega cumplido_at / incumplido_at (timestamptz, más precisos que fecha_cumplimiento date)
--     - Expande el estado check para incluir 'renegociada'
--     - Actualiza el trigger para auto-poblar los timestamps de resolución
--     - Agrega ptp_id en cob_gestiones como FK inversa de conveniencia
--
-- Lo que NO cambia:
--   - Nombre de columnas existentes (monto, fecha_compromiso, fecha_cumplimiento)
--     porque hay 3 filas vivas y lógica de aplicación que las referencia.
--   - Estados en masculino (cumplido, incumplido) — 1 fila 'cumplido' en prod.
--   - RLS de cob_ptps — ya correcta desde 0106.
--   - Trigger trg_cob_ptps_auto_vencido — se reemplaza la función, no el trigger.
--   - cob_financial_ledger, cob_revolving_accounts — no se tocan.
--
-- Rollback:
--   alter table public.cob_gestiones drop column if exists ptp_id;
--   alter table public.cob_ptps drop column if exists canal;
--   alter table public.cob_ptps drop column if exists cumplido_at;
--   alter table public.cob_ptps drop column if exists incumplido_at;
--   alter table public.cob_ptps drop constraint if exists cob_ptps_estado_check;
--   alter table public.cob_ptps add constraint cob_ptps_estado_check
--     check (estado in ('pendiente','cumplido','incumplido','vencido','cancelado'));
--   -- restaurar trigger a versión 0106 si es necesario
--
-- Validación previa (ejecutar antes de aplicar):
--   select count(*) from public.cob_ptps;                         -- debe ser 3
--   select count(*) from public.cob_gestiones where ptp_id is not null; -- debe ser 0 (col no existe)
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='cob_ptps'
--       and column_name in ('canal','cumplido_at','incumplido_at'); -- debe retornar 0 filas
--
-- Validación posterior (ejecutar después de aplicar):
--   select count(*) from public.cob_ptps;                         -- sigue siendo 3
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='cob_ptps'
--       and column_name in ('canal','cumplido_at','incumplido_at'); -- debe retornar 3 filas
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='cob_gestiones'
--       and column_name = 'ptp_id';                               -- debe retornar 1 fila
--   -- Verificar que 'renegociada' sea válido:
--   -- (prueba en staging; no actualizar filas en prod durante validación)
-- ============================================================

begin;

-- ── 1. Nuevas columnas en cob_ptps ──────────────────────────

alter table public.cob_ptps
  add column if not exists canal         text,
  add column if not exists cumplido_at   timestamptz,
  add column if not exists incumplido_at timestamptz;

comment on column public.cob_ptps.canal is
  'Canal por el que se recibió el compromiso de pago: llamada, whatsapp, email, presencial.';

comment on column public.cob_ptps.cumplido_at is
  'Timestamp exacto en que se registró el cumplimiento. '
  'Complementa fecha_cumplimiento (date legacy) con precisión de hora.';

comment on column public.cob_ptps.incumplido_at is
  'Timestamp exacto en que se registró el incumplimiento o vencimiento del PTP.';

-- ── 2. Expandir estado: agregar renegociada ──────────────────
-- Postgres no permite modificar un check inline; hay que drop + recreate.
-- Los 3 registros existentes tienen estados válidos: vencido, pendiente, cumplido.

alter table public.cob_ptps
  drop constraint if exists cob_ptps_estado_check;

alter table public.cob_ptps
  add constraint cob_ptps_estado_check
  check (estado in (
    'pendiente',
    'cumplido',
    'incumplido',
    'vencido',
    'cancelado',
    'renegociada'
  ));

-- ── 3. Actualizar función del trigger para auto-poblar timestamps ──
-- El trigger trg_cob_ptps_auto_vencido sigue activo; solo se reemplaza la función.
-- Los estados ya cerrados (cumplido/incumplido/vencido/cancelado) no se re-evalúan
-- a menos que se haga UPDATE explícito.

create or replace function public.fn_cob_ptps_auto_vencido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auto-vencido: pendiente cuya fecha de compromiso ya pasó
  if new.estado = 'pendiente'
     and new.fecha_compromiso < current_date then
    new.estado := 'vencido';
  end if;

  -- Auto-timestamp de cumplimiento (solo si transiciona a cumplido)
  if new.estado = 'cumplido'
     and new.cumplido_at is null then
    new.cumplido_at := now();
    -- Mantener fecha_cumplimiento (date legacy) sincronizada
    if new.fecha_cumplimiento is null then
      new.fecha_cumplimiento := current_date;
    end if;
  end if;

  -- Auto-timestamp de incumplimiento (incumplido o vencido)
  if new.estado in ('incumplido', 'vencido')
     and new.incumplido_at is null then
    new.incumplido_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ── 4. ptp_id en cob_gestiones ──────────────────────────────
-- FK inversa de conveniencia: permite navegar gestión → PTP sin join adicional.
-- La relación canónica sigue siendo cob_ptps.gestion_id → cob_gestiones(id).
-- Ambas FKs son nullable, por lo que no hay problema de inserción circular.

alter table public.cob_gestiones
  add column if not exists ptp_id uuid
    references public.cob_ptps(id) on delete set null;

create index if not exists cob_gestiones_ptp_id_idx
  on public.cob_gestiones (ptp_id)
  where ptp_id is not null;

comment on column public.cob_gestiones.ptp_id is
  'PTP formal originado por esta gestión. FK inversa a cob_ptps(id). '
  'La relación canónica es cob_ptps.gestion_id; este campo es conveniencia de lectura.';

commit;
