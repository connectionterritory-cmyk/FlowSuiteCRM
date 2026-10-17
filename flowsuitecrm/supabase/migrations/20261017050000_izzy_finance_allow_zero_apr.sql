-- ============================================================
-- IZZY Finance: permitir APR negociado de 0% a 24%
--
-- Contexto:
--   0118/0122/0170 limitaban apr_anual a 0.10-0.24. IZZY Finance negocia el APR
--   manualmente (0%, 5%, 10%... hasta el tope corporativo de 24%).
--
-- Cambios (solo reglas de rango; no toca filas existentes):
--   1. cob_revolving_accounts.apr_anual: CHECK 0.10-0.24  ->  0-0.24
--   2. fn_crear_revolving_account_cargo_vuelta: validacion 0-0.24
--      (cuerpo identico a 0170 salvo el rango de APR)
--   3. cob_statements.tasa_diaria: CHECK > 0  ->  >= 0
--      (el generador inserta apr/365; con APR 0 el statement fallaria)
--   4. v_dfp_caso_resumen.puede_devengar_interes: apr > 0 y <= 0.24
--      (APR 0 no devenga; antes el filtro 0.10-0.24 ocultaba cuentas < 10%)
--
-- fn_devengar_interes_revolving NO cambia: ya retorna null si APR <= 0.
--
-- ROLLBACK (solo si no existen cuentas con APR < 0.10 ni statements con tasa_diaria = 0):
--   restaurar los CHECK 0.10-0.24 / > 0, y re-aplicar fn_crear (0170) y la vista (0123).
-- ============================================================

begin;

-- 1. apr_anual: reemplazar cualquier CHECK de rango existente sobre apr_anual
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.cob_revolving_accounts'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%apr_anual%'
      and pg_get_constraintdef(c.oid) not ilike '%late_fee%'
  loop
    execute format('alter table public.cob_revolving_accounts drop constraint %I', r.conname);
  end loop;
end
$$;

alter table public.cob_revolving_accounts
  add constraint cob_revolving_accounts_apr_anual_range_chk
  check (apr_anual >= 0 and apr_anual <= 0.24);

comment on column public.cob_revolving_accounts.apr_anual is
  'Tasa de interés anual en decimal, negociada manualmente. Rango permitido: 0 (0%) a 0.24 (24%, tope corporativo). 0 = sin devengo de interés.';

-- 2. fn_crear_revolving_account_cargo_vuelta
create or replace function public.fn_crear_revolving_account_cargo_vuelta(
  p_case_id  uuid,
  p_apr      numeric,
  p_notes    text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id        uuid;
  v_actor_org_id    uuid;
  v_case            record;
  v_existing_id     uuid;
  v_account_id      uuid;
  v_apr             numeric(6,5);
  v_principal       numeric(12,2);
  v_agreement_date  date;
  v_now             timestamptz := now();
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id
    into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  if p_apr is null then
    raise exception 'INVALID_APR: apr_anual es obligatorio y debe estar entre 0 y 0.24';
  end if;

  v_apr := round(p_apr::numeric, 5);

  if v_apr < 0 or v_apr > 0.24 then
    raise exception 'INVALID_APR: apr_anual debe estar entre 0 y 0.24 (0 = 0%%, 0.24 = 24%%). Recibido: %', v_apr;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_case_id::text));

  select c.*
    into v_case
  from public.cargo_vuelta_cases c
  where c.id = p_case_id
    and c.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'CASE_NOT_FOUND_OR_FORBIDDEN: caso % no existe o no pertenece a la organización', p_case_id;
  end if;

  if coalesce(v_case.monto_devuelto, 0) <= 0 then
    raise exception 'INVALID_MONTO_DEVUELTO: monto_devuelto debe ser mayor a 0 (caso: %)', p_case_id;
  end if;

  v_principal := round(v_case.monto_devuelto::numeric, 2);
  v_agreement_date := coalesce(v_case.cv_approval_date, current_date);

  select a.id
    into v_existing_id
  from public.cob_revolving_accounts a
  where a.case_id = p_case_id
    and a.org_id  = v_actor_org_id
  limit 1;

  if v_existing_id is not null then
    raise exception 'REVOLVING_ACCOUNT_EXISTS: ya existe cuenta revolving % para el caso %',
      v_existing_id, p_case_id;
  end if;

  insert into public.cob_revolving_accounts (
    org_id,
    case_id,
    cliente_id,
    apr_anual,
    metodo_calculo_interes,
    fecha_inicio,
    fecha_ultimo_devengo,
    agreement_date,
    saldo_principal_inicial,
    saldo_principal_actual,
    saldo_interes_actual,
    saldo_fees_actual,
    estado,
    created_by,
    created_at,
    updated_at
  )
  values (
    v_actor_org_id,
    p_case_id,
    v_case.cliente_id,
    v_apr,
    'daily_simple_365',
    current_date,
    current_date,
    v_agreement_date,
    v_principal,
    v_principal,
    0,
    0,
    'activo',
    v_actor_id,
    v_now,
    v_now
  )
  returning id into v_account_id;

  insert into public.cob_financial_ledger (
    org_id,
    revolving_account_id,
    case_id,
    cliente_id,
    entry_date,
    effective_date,
    entry_type,
    component_type,
    debit_credit,
    amount,
    description,
    balance_principal_after,
    balance_interest_after,
    balance_fees_after,
    balance_total_after,
    metadata,
    created_by,
    created_at
  )
  values (
    v_actor_org_id,
    v_account_id,
    p_case_id,
    v_case.cliente_id,
    current_date,
    current_date,
    'principal_initial',
    'principal',
    'debit',
    v_principal,
    coalesce(p_notes, 'Cuenta DFP Revolving abierta desde Cargo de Vuelta'),
    v_principal,
    0,
    0,
    v_principal,
    jsonb_build_object(
      'case_id',        p_case_id,
      'apr_anual',      v_apr,
      'monto_devuelto', v_principal,
      'agreement_date', v_agreement_date
    ),
    v_actor_id,
    v_now
  );

  return v_account_id;
end;
$$;

comment on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text) is
  'Abre una cuenta revolving DFP desde un caso Cargo de Vuelta. Usa monto_devuelto como principal inicial y guarda agreement_date = cv_approval_date cuando exista para poder alinear el primer statement aprobado. APR negociado: 0 a 0.24 (0% permitido).';

revoke all on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  from public;

revoke execute on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  from anon;

grant execute on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  to authenticated;

-- 3. cob_statements.tasa_diaria
-- Drop the known legacy positive-only constraint explicitly. The previous
-- pg_get_constraintdef text matcher was not reliable across PostgreSQL's
-- normalized constraint rendering and left this constraint behind in staging.
alter table public.cob_statements
  drop constraint if exists cob_statements_tasa_diaria_check;

-- Keep the migration idempotent if the non-negative constraint already exists.
alter table public.cob_statements
  drop constraint if exists cob_statements_tasa_diaria_nonneg_chk;

alter table public.cob_statements
  add constraint cob_statements_tasa_diaria_nonneg_chk
  check (tasa_diaria is null or tasa_diaria >= 0);

-- 4. v_dfp_caso_resumen (definicion 0123, solo cambia el predicado de APR)
create or replace view public.v_dfp_caso_resumen
  with (security_invoker = true)
as

with

ultimo_ledger as (
  select distinct on (revolving_account_id)
    revolving_account_id,
    id             as ultimo_ledger_id,
    entry_type     as ultimo_entry_type,
    component_type as ultimo_component_type,
    amount         as ultimo_amount,
    effective_date as ultimo_ledger_fecha
  from public.cob_financial_ledger
  order by revolving_account_id, effective_date desc, created_at desc
),

ledger_tiene_inicial as (
  select
    revolving_account_id,
    true as tiene_principal_initial
  from public.cob_financial_ledger
  where entry_type = 'principal_initial'
  group by revolving_account_id
)

select

  c.id            as case_id,
  c.org_id,
  c.cliente_id,

  c.tipo_caso,
  c.alias_operativo,
  c.estado                                as estado_caso,
  c.fecha_apertura,
  c.fecha_cierre,
  c.fecha_cargo_vuelta,
  c.monto_devuelto,
  c.requiere_reconciliacion,
  c.numero_cuenta_hycite,
  c.numero_orden_hycite,
  c.origen_cargo_vuelta,

  a.id                                    as account_id,
  a.apr_anual,
  a.metodo_calculo_interes,
  a.fecha_inicio,
  a.fecha_ultimo_devengo,
  a.saldo_principal_inicial,
  a.saldo_principal_actual,
  a.saldo_interes_actual,
  a.saldo_fees_actual,
  a.saldo_total_actual                    as saldo_operativo_interno,
  a.estado                                as estado_cuenta,

  ul.ultimo_entry_type,
  ul.ultimo_component_type,
  ul.ultimo_ledger_fecha,
  ul.ultimo_amount                        as ultimo_ledger_monto,

  lr.saldo_principal_reconstruido,
  lr.saldo_interes_reconstruido,
  lr.saldo_fees_reconstruido,
  lr.saldo_total_reconstruido,
  lr.total_entries                        as ledger_total_entries,

  case
    when a.id is not null and lr.revolving_account_id is not null
    then round(
      coalesce(a.saldo_total_actual, 0) - coalesce(lr.saldo_total_reconstruido, 0),
      2
    )
    else null
  end                                     as drift_saldo_total,

  case
    when a.id is not null
     and coalesce(li.tiene_principal_initial, false) = false
    then true
    else false
  end                                     as requiere_configuracion,

  case
    when a.id is not null
     and lr.revolving_account_id is not null
     and abs(
       coalesce(a.saldo_total_actual, 0) - coalesce(lr.saldo_total_reconstruido, 0)
     ) > 0.01
    then true
    else false
  end                                     as requiere_revision_saldos,

  case
    when a.id is null
     and coalesce(c.monto_devuelto, 0) > 0
     and c.tipo_caso = 'cargo_vuelta'
     and c.estado not in ('Cerrado', 'Cancelado')
    then true
    else false
  end                                     as puede_crear_cuenta_revolving,

  case
    when a.id is not null
     and a.apr_anual > 0
     and a.apr_anual <= 0.24
     and coalesce(a.saldo_principal_actual, 0) > 0
     and a.fecha_ultimo_devengo < current_date
     and a.estado in ('activo', 'moroso', 'en_plan')
    then true
    else false
  end                                     as puede_devengar_interes

from public.cargo_vuelta_cases c

left join public.cob_revolving_accounts a
  on  a.case_id = c.id
  and a.org_id  = c.org_id

left join ultimo_ledger ul
  on ul.revolving_account_id = a.id

left join public.v_ledger_saldos_reconstruidos lr
  on  lr.revolving_account_id = a.id
  and lr.org_id               = a.org_id

left join ledger_tiene_inicial li
  on li.revolving_account_id = a.id

where c.tipo_caso = 'cargo_vuelta';


comment on view public.v_dfp_caso_resumen is
  'Vista read-only de soporte UI para casos Cargo de Vuelta / DFP. '
  'Unifica cargo_vuelta_cases, cob_revolving_accounts, cob_financial_ledger '
  'y v_ledger_saldos_reconstruidos. '
  'SECURITY INVOKER: RLS de las tablas base se aplica al llamador. '
  'Sin auth.uid(): siempre filtrar por org_id desde el frontend o un RPC. '
  'Solo muestra tipo_caso=cargo_vuelta. '
  'Las banderas puede_* son informativas para UI; la autorización real vive en las RPCs.';

commit;
