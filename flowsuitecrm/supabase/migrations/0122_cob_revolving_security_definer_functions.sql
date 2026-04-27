-- ============================================================
-- 0122: RPCs SECURITY DEFINER — Motor DFP Revolving (fase 1)
--
-- Objetivo:
--   Primeras funciones financieras controladas del módulo DFP.
--   Todo acceso al ledger pasa por estas funciones; ningún INSERT
--   directo de usuario autenticado es posible (bloqueado en 0120).
--
-- Funciones incluidas:
--   1) fn_crear_revolving_account_cargo_vuelta — abre cuenta + ledger inicial
--   2) fn_devengar_interes_revolving — devenga interés y escribe ledger accrual
--
-- Política APR:
--   - apr_anual es obligatorio. NULL rechazado.
--   - apr_anual se guarda como decimal anual: 0.10 = 10%, 0.24 = 24%.
--   - Debe cumplir el constraint de 0118: check (apr_anual between 0.10 and 0.24).
--   - APR 0, < 0.10 o > 0.24 se rechaza. No existen cuentas "sin devengo".
--
-- Fuera de alcance de 0122:
--   - pagos waterfall
--   - reversos de ledger
--   - writeoffs
--   - ajustes manuales
--   - cierres automáticos
--
-- Correcciones vs diseño propuesto:
--   - cob_revolving_accounts: apr_anual, saldo_principal_actual/inicial,
--     saldo_interes_actual, saldo_fees_actual; sin updated_by; sin payment_frequency;
--     sin first_due_date; saldo_total_actual es GENERATED (no se inserta)
--   - cob_financial_ledger: revolving_account_id (no account_id),
--     entry_type (no movement_type), component_type+debit_credit+amount
--     (no deltas); effective_date requerido; accrual_from/accrual_to requeridos
--     para finance_charge_accrual; balance_*_after (no balance_after_*)
--   - usuarios: org_id uuid (no organizacion::uuid)
--   - APR: decimal obligatorio entre 0.10 y 0.24 (constraint de 0118);
--     sin división /100; null, 0, < 0.10 y > 0.24 rechazados
--
-- ROLLBACK:
--   drop function if exists public.fn_crear_revolving_account_cargo_vuelta(uuid,numeric,text);
--   drop function if exists public.fn_devengar_interes_revolving(uuid,date,text);
-- ============================================================

begin;

-- ══════════════════════════════════════════════════════════════
-- 1. fn_crear_revolving_account_cargo_vuelta
--
-- Parámetros:
--   p_case_id  — caso Cargo de Vuelta existente en la org del usuario
--   p_apr      — APR anual en decimal. Obligatorio. Rango: 0.10 a 0.24.
--                0.10 = 10% anual, 0.24 = 24% anual.
--                Alineado con constraint de 0118 (apr_anual between 0.10 and 0.24).
--                Null, 0, < 0.10 o > 0.24 se rechaza.
--   p_notes    — descripción libre para el ledger inicial (opcional)
--
-- Retorna:
--   UUID de la nueva cob_revolving_accounts
--
-- Errores (SQLSTATE P0001):
--   AUTH_REQUIRED               — sin sesión autenticada
--   ORG_REQUIRED                — usuario sin org_id
--   INVALID_APR                 — null, 0, < 0.10 o > 0.24
--   CASE_NOT_FOUND_OR_FORBIDDEN — caso no existe o no pertenece a la org
--   INVALID_MONTO_DEVUELTO      — monto_devuelto nulo o <= 0
--   REVOLVING_ACCOUNT_EXISTS    — ya existe cuenta revolving para el caso
-- ══════════════════════════════════════════════════════════════

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
  v_now             timestamptz := now();
begin
  -- ── Identidad ─────────────────────────────────────────────
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

  -- ── Validar APR ───────────────────────────────────────────
  -- Alineado con constraint de 0118: apr_anual between 0.10 and 0.24.
  -- 0.10 = 10% anual, 0.24 = 24% anual. Null, 0 y fuera de rango rechazados.
  if p_apr is null then
    raise exception 'INVALID_APR: apr_anual es obligatorio y debe estar entre 0.10 y 0.24';
  end if;

  v_apr := round(p_apr::numeric, 5);

  if v_apr < 0.10 or v_apr > 0.24 then
    raise exception 'INVALID_APR: apr_anual debe estar entre 0.10 y 0.24 (0.10 = 10%%, 0.24 = 24%%). Recibido: %', v_apr;
  end if;

  -- ── Lock transaccional por case_id ────────────────────────
  -- Evita creación concurrente de dos cuentas para el mismo caso.
  perform pg_advisory_xact_lock(hashtext(p_case_id::text));

  -- ── Leer caso validando org_id ────────────────────────────
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

  -- ── Proteger unicidad: una sola cuenta por caso ───────────
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

  -- ── Crear cuenta revolving ────────────────────────────────
  -- saldo_total_actual es columna GENERATED: no se incluye en INSERT.
  insert into public.cob_revolving_accounts (
    org_id,
    case_id,
    cliente_id,
    apr_anual,
    metodo_calculo_interes,
    fecha_inicio,
    fecha_ultimo_devengo,
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
    current_date,          -- devengo parte desde hoy
    v_principal,           -- saldo_principal_inicial: inmutable
    v_principal,           -- saldo_principal_actual: comienza igual
    0,
    0,
    'activo',
    v_actor_id,
    v_now,
    v_now
  )
  returning id into v_account_id;

  -- ── Ledger: entrada principal_initial ─────────────────────
  -- Un entry por componente. El principal inicial es component_type='principal', debit.
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
    v_principal,   -- balance_principal_after
    0,
    0,
    v_principal,   -- balance_total_after
    jsonb_build_object(
      'case_id',    p_case_id,
      'apr_anual',  v_apr,
      'monto_devuelto', v_principal
    ),
    v_actor_id,
    v_now
  );

  return v_account_id;
end;
$$;

comment on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text) is
  'Abre una cuenta revolving DFP desde un caso Cargo de Vuelta. '
  'Usa monto_devuelto como principal inicial. Crea ledger principal_initial. '
  'Valida org_id dentro de la función. '
  'apr_anual es obligatorio: decimal entre 0.10 (10%%) y 0.24 (24%%), alineado con constraint de 0118. '
  'Null, 0 y valores fuera de rango se rechazan.';


-- ══════════════════════════════════════════════════════════════
-- 2. fn_devengar_interes_revolving
--
-- Parámetros:
--   p_account_id   — cuenta revolving DFP
--   p_accrual_date — fecha hasta la que devengar (inclusive). Default: hoy.
--   p_notes        — descripción libre para el ledger (opcional)
--
-- Retorna:
--   UUID del ledger creado, o NULL si no hay devengo aplicable:
--     - principal_actual <= 0
--     - apr_anual <= 0 (guard defensivo; no debería ocurrir con cuentas creadas por 0122)
--     - ya devengado hasta esa fecha o posterior
--     - interés calculado redondea a 0.00
--
-- Fórmula:
--   interés = round(saldo_principal_actual * apr_anual / 365 * días, 2)
--   APR en decimal: 0.18 = 18%. Sin división adicional por 100.
--
-- Prevención doble devengo:
--   - Lock advisory por account_id
--   - Guard sobre fecha_ultimo_devengo >= p_accrual_date
--   - Unique parcial en ledger (revolving_account_id, accrual_from, accrual_to)
--     para entry_type=finance_charge_accrual
--
-- Errores (SQLSTATE P0001):
--   AUTH_REQUIRED                  — sin sesión autenticada
--   ORG_REQUIRED                   — usuario sin org_id
--   INVALID_ACCRUAL_DATE           — fecha nula
--   ACCOUNT_NOT_FOUND_OR_FORBIDDEN — cuenta no existe o no pertenece a la org
-- ══════════════════════════════════════════════════════════════

create or replace function public.fn_devengar_interes_revolving(
  p_account_id   uuid,
  p_accrual_date date    default current_date,
  p_notes        text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id              uuid;
  v_actor_org_id          uuid;
  v_account               record;
  v_accrual_from          date;
  v_days                  integer;
  v_interest              numeric(12,2);
  v_new_saldo_interes     numeric(12,2);
  v_new_saldo_total       numeric(12,2);
  v_ledger_id             uuid;
  v_now                   timestamptz := now();
begin
  -- ── Identidad ─────────────────────────────────────────────
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

  if p_accrual_date is null then
    raise exception 'INVALID_ACCRUAL_DATE: p_accrual_date no puede ser null';
  end if;

  -- ── Lock transaccional por account_id ─────────────────────
  perform pg_advisory_xact_lock(hashtext(p_account_id::text));

  -- ── Leer cuenta validando org_id ─────────────────────────
  select a.*
    into v_account
  from public.cob_revolving_accounts a
  where a.id     = p_account_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND_OR_FORBIDDEN: cuenta % no existe o no pertenece a la organización', p_account_id;
  end if;

  -- ── Guards de no-devengo (retorno silencioso) ─────────────
  if coalesce(v_account.saldo_principal_actual, 0) <= 0 then
    return null;   -- sin principal pendiente
  end if;

  if coalesce(v_account.apr_anual, 0) <= 0 then
    return null;   -- guard defensivo: APR <= 0 no debería existir (fn_crear exige 0.10–0.24)
  end if;

  -- fecha_ultimo_devengo es NOT NULL en schema — no necesita coalesce
  if v_account.fecha_ultimo_devengo >= p_accrual_date then
    return null;   -- ya devengado hasta esta fecha o posterior
  end if;

  -- ── Calcular días y ventana de devengo ────────────────────
  v_accrual_from := v_account.fecha_ultimo_devengo;  -- día siguiente al último devengo
  v_days         := p_accrual_date - v_accrual_from;

  if v_days <= 0 then
    return null;
  end if;

  -- ── Calcular interés ──────────────────────────────────────
  -- APR en decimal: apr_anual = 0.18 significa 18% anual.
  -- Fórmula: principal × APR / 365 × días
  v_interest := round(
    (v_account.saldo_principal_actual::numeric
     * v_account.apr_anual::numeric
     / 365
     * v_days)::numeric,
    2
  );

  -- Si el interés redondea a 0, avanzar fecha y salir sin ledger.
  if v_interest <= 0 then
    update public.cob_revolving_accounts
       set fecha_ultimo_devengo = p_accrual_date,
           updated_at           = v_now
     where id     = p_account_id
       and org_id = v_actor_org_id;
    return null;
  end if;

  -- ── Calcular saldos resultantes ───────────────────────────
  v_new_saldo_interes := round(v_account.saldo_interes_actual::numeric + v_interest, 2);

  -- saldo_total_actual es GENERATED; calculamos para el snapshot del ledger
  v_new_saldo_total := round(
    v_account.saldo_principal_actual::numeric
    + v_new_saldo_interes
    + v_account.saldo_fees_actual::numeric,
    2
  );

  -- ── Insertar ledger finance_charge_accrual ────────────────
  -- La constraint cob_financial_ledger_accrual_fechas_chk exige
  -- accrual_from IS NOT NULL AND accrual_to IS NOT NULL AND accrual_to > accrual_from.
  -- La unique parcial cob_financial_ledger_accrual_uidx previene doble devengo
  -- para la misma ventana (revolving_account_id, accrual_from, accrual_to).
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
    accrual_from,
    accrual_to,
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
    p_account_id,
    v_account.case_id,
    v_account.cliente_id,
    current_date,
    p_accrual_date,
    'finance_charge_accrual',
    'interest',
    'debit',
    v_interest,
    coalesce(
      p_notes,
      'Devengo de interés DFP Revolving: '
        || v_accrual_from::text || ' → ' || p_accrual_date::text
        || ' (' || v_days::text || ' día(s))'
        || ' @ APR ' || (v_account.apr_anual * 100)::numeric(5,2)::text || '%'
    ),
    v_accrual_from,
    p_accrual_date,
    round(v_account.saldo_principal_actual::numeric, 2),
    v_new_saldo_interes,
    round(v_account.saldo_fees_actual::numeric, 2),
    v_new_saldo_total,
    jsonb_build_object(
      'apr_anual',       v_account.apr_anual,
      'dias_devengados', v_days,
      'accrual_from',    v_accrual_from,
      'accrual_to',      p_accrual_date,
      'principal_base',  v_account.saldo_principal_actual
    ),
    v_actor_id,
    v_now
  )
  returning id into v_ledger_id;

  -- ── Actualizar saldos de la cuenta ────────────────────────
  -- Solo los campos mutables: saldo_interes_actual, fecha_ultimo_devengo.
  -- saldo_total_actual se recalcula automáticamente (GENERATED).
  update public.cob_revolving_accounts
     set saldo_interes_actual  = v_new_saldo_interes,
         fecha_ultimo_devengo  = p_accrual_date,
         updated_at            = v_now
   where id     = p_account_id
     and org_id = v_actor_org_id;

  return v_ledger_id;
end;
$$;

comment on function public.fn_devengar_interes_revolving(uuid, date, text) is
  'Devenga interés interno de una cuenta revolving DFP. '
  'Calcula días desde fecha_ultimo_devengo hasta p_accrual_date. '
  'Fórmula: principal × apr_anual / 365 × días (APR en decimal, 0.18 = 18%). '
  'Persiste interés redondeado a 2 decimales en ledger finance_charge_accrual. '
  'Actualiza saldo_interes_actual y fecha_ultimo_devengo. '
  'Retorna null cuando no hay devengo aplicable (principal=0, APR=0, ya devengado, resultado=0).';


-- ══════════════════════════════════════════════════════════════
-- Permisos RPC
-- ══════════════════════════════════════════════════════════════

-- En Supabase, 'anon' mantiene un grant implícito propio que sobrevive
-- a REVOKE FROM PUBLIC. Se necesita REVOKE explícito sobre ambos roles.
revoke all on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  from public, anon;

revoke all on function public.fn_devengar_interes_revolving(uuid, date, text)
  from public, anon;

grant execute on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  to authenticated;

grant execute on function public.fn_devengar_interes_revolving(uuid, date, text)
  to authenticated;

commit;
