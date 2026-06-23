begin;

-- ============================================================
-- 0170: alinear primer statement CV/DFP con approval_date
--
-- Objetivo:
--   - Cambiar el calendario inicial aprobado:
--       approval_date + 10 días = statement_date
--       statement_date + 10 días = due_date
--   - Dejar due_date como fecha límite de pago, no como fin del
--     período de interés del primer statement.
--   - Reutilizar la misma lógica conceptual para DFP cuando exista
--     agreement_date y el primer statement se genere desde esa fecha.
-- ============================================================

-- ── 1. Helper genérico para primer statement por acuerdo aprobado ───────────

drop function if exists public.fn_financing_first_statement_schedule(date);

create or replace function public.fn_financing_first_statement_schedule(
  p_approval_date date
)
returns table (
  approval_date          date,
  statement_date         date,
  due_date               date,
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
  statement_date := p_approval_date + 10;
  due_date := statement_date + 10;
  interest_period_start := p_approval_date;
  interest_period_end := statement_date;
  interest_days := greatest(statement_date - p_approval_date, 0);

  return next;
end;
$$;

comment on function public.fn_financing_first_statement_schedule(date) is
  'Calendario aprobado para el primer statement de un financiamiento/refinanciamiento: statement_date = approval_date + 10, due_date = statement_date + 10, interés del primer statement = approval_date → statement_date.';

revoke all on function public.fn_financing_first_statement_schedule(date) from public, anon;
grant execute on function public.fn_financing_first_statement_schedule(date) to authenticated;

-- ── 2. CV: comentarios, constraints y helper alineados ──────────────────────

comment on column public.cargo_vuelta_cases.cv_approval_date is
  'Fecha oficial de aprobación del financiamiento CV. Dispara statement_date, due_date y el período de interés del primer statement.';

comment on column public.cargo_vuelta_cases.cv_statement_date is
  'Fecha oficial del primer statement CV. Regla aprobada: cv_approval_date + 10 días.';

comment on column public.cargo_vuelta_cases.cv_due_date is
  'Fecha límite de pago del primer statement CV. Regla aprobada: cv_statement_date + 10 días. No es el fin del período de interés.';

comment on column public.cargo_vuelta_cases.cv_interest_period_start is
  'Inicio del período de interés del primer statement CV. Regla aprobada: cv_approval_date.';

comment on column public.cargo_vuelta_cases.cv_interest_period_end is
  'Fin del período de interés del primer statement CV. Regla aprobada: cv_statement_date. due_date es solo la fecha límite de pago.';

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
      and cv_statement_date = cv_approval_date + 10
      and cv_due_date = cv_statement_date + 10
      and cv_interest_period_end = cv_statement_date
      and cv_statement_date <= cv_due_date
    )
    or
    (
      cv_statement_schedule_status = 'void'
    )
  );

comment on column public.cob_cv_resumenes.statement_date_snapshot is
  'Snapshot de la fecha oficial del primer statement CV usada para este documento.';

comment on column public.cob_cv_resumenes.due_date_snapshot is
  'Snapshot de la fecha límite de pago del statement CV usada para este documento. No define el fin del período de interés.';

comment on column public.cob_cv_resumenes.interest_period_end_snapshot is
  'Snapshot del fin del período de interés CV usado para este documento. En el primer statement coincide con statement_date.';

comment on column public.cob_cv_resumenes.interest_amount_periodo is
  'Interés del período del primer statement CV desde approval_date hasta statement_date, usando daily_simple_365.';

comment on column public.cob_cv_resumenes.interest_amount_acumulado is
  'Acumulado de interés reflejado en este documento. En esta fase coincide con el interés del primer statement.';

comment on column public.cob_cv_resumenes.balance_proyectado_due_date is
  'Monto estimado a pagar antes del due_date: saldo_pendiente_corte + interés del período approval_date → statement_date.';

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
declare
  v_schedule record;
begin
  if p_approval_date is null then
    return;
  end if;

  select *
    into v_schedule
  from public.fn_financing_first_statement_schedule(p_approval_date);

  approval_date := v_schedule.approval_date;
  due_date := v_schedule.due_date;
  statement_date := v_schedule.statement_date;
  interest_period_start := v_schedule.interest_period_start;
  interest_period_end := v_schedule.interest_period_end;
  interest_days := v_schedule.interest_days;

  return next;
end;
$$;

comment on function public.fn_cv_calcular_statement_schedule(date) is
  'Calcula el calendario oficial CV desde la aprobación: statement_date = approval + 10, due_date = statement + 10, interest_period = approval → statement_date.';

revoke all on function public.fn_cv_calcular_statement_schedule(date) from public, anon;
grant execute on function public.fn_cv_calcular_statement_schedule(date) to authenticated;

comment on function public.fn_cv_calcular_interes_proyectado(numeric, numeric, date, date) is
  'Calcula interés CV con método daily_simple_365. Para el primer statement aprobado, el período correcto es approval_date → statement_date. Fórmula: balance_base * apr / 365 * días.';

-- ── 3. DFP: agreement_date y primer statement desde acuerdo aprobado ────────

comment on column public.cob_revolving_accounts.agreement_date is
  'Fecha del acuerdo aprobado de financiamiento/refinanciamiento. Si el primer statement se genera desde esta fecha, debe usar statement_date = agreement_date + 10 y due_date = statement_date + 10.';

comment on function public.fn_calcular_due_date(date, smallint, smallint) is
  'Calcula fecha_vencimiento para ciclos DFP recurrentes desde fecha_corte. Si existe agreement_date y el primer statement se genera con período approval/agreement → approval/agreement + 10, fn_cob_statement_generar aplica la regla aprobada due_date = statement_date + 10 en lugar de este helper.';

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
    raise exception 'INVALID_APR: apr_anual es obligatorio y debe estar entre 0.10 y 0.24';
  end if;

  v_apr := round(p_apr::numeric, 5);

  if v_apr < 0.10 or v_apr > 0.24 then
    raise exception 'INVALID_APR: apr_anual debe estar entre 0.10 y 0.24 (0.10 = 10%%, 0.24 = 24%%). Recibido: %', v_apr;
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
  'Abre una cuenta revolving DFP desde un caso Cargo de Vuelta. Usa monto_devuelto como principal inicial y guarda agreement_date = cv_approval_date cuando exista para poder alinear el primer statement aprobado.';

revoke all on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  from public;

grant execute on function public.fn_crear_revolving_account_cargo_vuelta(uuid, numeric, text)
  to authenticated;

create or replace function public.fn_cob_statement_generar(
  p_revolving_account_id  uuid,
  p_periodo_inicio        date,
  p_periodo_fin           date,
  p_fecha_corte           date    default null,
  p_notas                 text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id                    uuid;
  v_actor_org_id                uuid;
  v_account                     record;
  v_fecha_corte                 date;
  v_fecha_vencimiento           date;
  v_ytd_inicio                  date;
  v_dias_ciclo                  integer;
  v_first_statement_schedule    record;
  v_use_approved_first_schedule boolean := false;

  v_balance_previo             numeric(12,2);
  v_balance_sujeto_int         numeric(12,2);
  v_pagos_periodo              numeric(12,2);
  v_otros_creditos             numeric(12,2);
  v_compras_periodo            numeric(12,2);
  v_cargos_interes             numeric(12,2);
  v_cargos_fees                numeric(12,2);
  v_nuevo_balance              numeric(12,2);
  v_ytd_fees                   numeric(12,2);
  v_ytd_interes                numeric(12,2);
  v_tasa_diaria                numeric(12,10);

  v_existing_id                uuid;
  v_statement_id               uuid;
  v_now                        timestamptz := now();
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  select u.org_id into v_actor_org_id
  from public.usuarios u
  where u.id = v_actor_id
  limit 1;

  if v_actor_org_id is null then
    raise exception 'ORG_REQUIRED: no se encontró org_id para el usuario autenticado';
  end if;

  if p_revolving_account_id is null then
    raise exception 'INVALID_PARAM: p_revolving_account_id es requerido';
  end if;
  if p_periodo_inicio is null or p_periodo_fin is null then
    raise exception 'INVALID_PARAM: p_periodo_inicio y p_periodo_fin son requeridos';
  end if;
  if p_periodo_inicio > p_periodo_fin then
    raise exception 'INVALID_PARAM: p_periodo_inicio (%) no puede ser posterior a p_periodo_fin (%)',
      p_periodo_inicio, p_periodo_fin;
  end if;

  v_fecha_corte := coalesce(p_fecha_corte, p_periodo_fin);

  if v_fecha_corte < p_periodo_inicio or v_fecha_corte > p_periodo_fin then
    raise exception 'INVALID_FECHA_CORTE: fecha_corte (%) debe estar entre % y %',
      v_fecha_corte, p_periodo_inicio, p_periodo_fin;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(
      p_revolving_account_id::text
      || '|' || p_periodo_inicio::text
      || '|' || p_periodo_fin::text
    )
  );

  select a.* into v_account
  from public.cob_revolving_accounts a
  where a.id     = p_revolving_account_id
    and a.org_id = v_actor_org_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND_OR_FORBIDDEN: cuenta % no existe o no pertenece a la organización',
      p_revolving_account_id;
  end if;

  select s.id into v_existing_id
  from public.cob_statements s
  where s.revolving_account_id = p_revolving_account_id
    and s.org_id               = v_actor_org_id
    and s.periodo_inicio       = p_periodo_inicio
    and s.periodo_fin          = p_periodo_fin
  limit 1;

  if v_existing_id is not null then
    raise exception 'STATEMENT_EXISTS: ya existe statement % para el período % → %',
      v_existing_id, p_periodo_inicio, p_periodo_fin;
  end if;

  v_dias_ciclo  := (p_periodo_fin - p_periodo_inicio + 1)::integer;
  v_ytd_inicio  := make_date(extract(year from p_periodo_fin)::integer, 1, 1);
  v_tasa_diaria := round(v_account.apr_anual / 365.0, 10);

  if v_account.agreement_date is not null
     and p_periodo_inicio = v_account.agreement_date then
    select *
      into v_first_statement_schedule
    from public.fn_financing_first_statement_schedule(v_account.agreement_date);

    v_use_approved_first_schedule := (
      v_first_statement_schedule.statement_date = p_periodo_fin
      and v_fecha_corte = v_first_statement_schedule.statement_date
    );
  end if;

  if v_use_approved_first_schedule then
    v_fecha_vencimiento := v_first_statement_schedule.due_date;
  else
    v_fecha_vencimiento := public.fn_calcular_due_date(
      v_fecha_corte,
      v_account.min_days_statement_to_due,
      v_account.customer_preferred_payment_day
    );
  end if;

  select coalesce(sum(
    case when debit_credit = 'debit' then amount else -amount end
  ), 0)::numeric(12,2)
  into v_balance_previo
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date < p_periodo_inicio;

  v_balance_previo := greatest(v_balance_previo, 0);

  select coalesce(sum(
    case
      when component_type = 'principal' and debit_credit = 'debit'  then  amount
      when component_type = 'principal' and debit_credit = 'credit' then -amount
      else 0
    end
  ), 0)::numeric(12,2)
  into v_balance_sujeto_int
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date < p_periodo_inicio;

  v_balance_sujeto_int := greatest(v_balance_sujeto_int, 0);

  select
    coalesce(sum(case
      when entry_type = 'payment_applied' and debit_credit = 'credit'
      then amount else 0 end), 0)::numeric(12,2),
    coalesce(sum(case
      when entry_type in ('adjustment', 'reversal') and debit_credit = 'credit'
      then amount else 0 end), 0)::numeric(12,2),
    coalesce(sum(case
      when component_type = 'principal'
        and debit_credit = 'debit'
      then amount else 0 end), 0)::numeric(12,2),
    coalesce(sum(case
      when component_type = 'interest' and debit_credit = 'debit'
      then amount else 0 end), 0)::numeric(12,2),
    coalesce(sum(case
      when component_type = 'fee' and debit_credit = 'debit'
      then amount else 0 end), 0)::numeric(12,2)
  into
    v_pagos_periodo,
    v_otros_creditos,
    v_compras_periodo,
    v_cargos_interes,
    v_cargos_fees
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date >= p_periodo_inicio
    and l.effective_date <= p_periodo_fin;

  select
    coalesce(sum(case
      when component_type = 'fee'      and debit_credit = 'debit' then amount else 0 end), 0)::numeric(12,2),
    coalesce(sum(case
      when component_type = 'interest' and debit_credit = 'debit' then amount else 0 end), 0)::numeric(12,2)
  into
    v_ytd_fees,
    v_ytd_interes
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date >= v_ytd_inicio
    and l.effective_date <= p_periodo_fin;

  v_nuevo_balance := round(
    v_balance_previo
    + v_compras_periodo
    + v_cargos_interes
    + v_cargos_fees
    - v_pagos_periodo
    - v_otros_creditos,
    2
  );
  v_nuevo_balance := greatest(v_nuevo_balance, 0);

  insert into public.cob_statements (
    org_id,
    cliente_id,
    case_id,
    revolving_account_id,
    periodo_inicio,
    periodo_fin,
    fecha_corte,
    fecha_vencimiento,
    dias_ciclo_facturacion,
    balance_previo,
    pagos_periodo,
    otros_creditos,
    compras_periodo,
    balance_atrasado,
    cargos_totales_periodo,
    apr_tae,
    tasa_diaria,
    balance_sujeto_interes,
    cargos_interes_periodo,
    nuevo_balance,
    pago_minimo,
    ytd_cargos_atraso,
    ytd_cargos_interes,
    mensaje_pago,
    status,
    generated_by,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_actor_org_id,
    v_account.cliente_id,
    v_account.case_id,
    p_revolving_account_id,
    p_periodo_inicio,
    p_periodo_fin,
    v_fecha_corte,
    v_fecha_vencimiento,
    v_dias_ciclo,
    v_balance_previo,
    v_pagos_periodo,
    v_otros_creditos,
    v_compras_periodo,
    v_balance_previo,
    v_cargos_fees,
    v_account.apr_anual,
    v_tasa_diaria,
    v_balance_sujeto_int,
    v_cargos_interes,
    v_nuevo_balance,
    v_nuevo_balance,
    v_ytd_fees,
    v_ytd_interes,
    coalesce(
      p_notas,
      'Por favor realice su pago antes del '
        || to_char(v_fecha_vencimiento, 'DD/MM/YYYY')
        || ' para evitar cargos adicionales.'
    ),
    'draft',
    v_actor_id,
    jsonb_build_object(
      'account_apr',                v_account.apr_anual,
      'account_estado',             v_account.estado,
      'dias_ciclo',                 v_dias_ciclo,
      'closing_day',                v_account.statement_closing_day,
      'preferred_payment_day',      v_account.customer_preferred_payment_day,
      'min_days_statement_to_due',  v_account.min_days_statement_to_due,
      'agreement_date',             v_account.agreement_date,
      'used_approved_first_schedule', v_use_approved_first_schedule,
      'fix_version',                '0170_approval_statement_due_alignment'
    ),
    v_now,
    v_now
  )
  returning id into v_statement_id;

  insert into public.cob_statement_lines (
    org_id,
    statement_id,
    revolving_account_id,
    ledger_entry_id,
    line_order,
    transaction_date,
    posting_date,
    entry_type,
    component_type,
    description,
    amount,
    metadata
  )
  select
    v_actor_org_id,
    v_statement_id,
    p_revolving_account_id,
    l.id,
    row_number() over (order by l.effective_date asc, l.created_at asc)::integer,
    l.effective_date,
    l.entry_date,
    l.entry_type,
    l.component_type,
    coalesce(l.description, l.entry_type),
    case when l.debit_credit = 'debit' then l.amount else -l.amount end,
    jsonb_build_object(
      'debit_credit',    l.debit_credit,
      'original_amount', l.amount
    )
  from public.cob_financial_ledger l
  where l.revolving_account_id = p_revolving_account_id
    and l.effective_date >= p_periodo_inicio
    and l.effective_date <= p_periodo_fin
  order by l.effective_date asc, l.created_at asc;

  return v_statement_id;
end;
$$;

comment on function public.fn_cob_statement_generar(uuid, date, date, date, text) is
  'Genera snapshot DFP en cob_statements + cob_statement_lines. Para el primer statement con agreement_date y período agreement_date → agreement_date + 10, aplica la regla aprobada due_date = statement_date + 10. Los ciclos recurrentes siguen usando fn_calcular_due_date.';

revoke all on function public.fn_cob_statement_generar(uuid, date, date, date, text)
  from public, anon;

grant execute on function public.fn_cob_statement_generar(uuid, date, date, date, text)
  to authenticated;

-- ── 4. CV: regenerar resumen para reflejar período de interés correcto ──────

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
      coalesce(v_case.cv_statement_date, v_fecha_corte),
      case
        when v_missing_apr_review_mode then 'Interés en revisión manual (APR faltante)'
        else 'Interés del período del statement'
      end,
      v_interest_amount_periodo,
      v_interest_amount_periodo,
      v_balance_proyectado_due,
      jsonb_build_object(
        'interest_days', coalesce(v_interest.interest_days, 0),
        'interest_apr', case when v_missing_apr_review_mode then null else v_case.cv_interest_apr end,
        'interest_period_start', v_case.cv_interest_period_start,
        'interest_period_end', v_case.cv_interest_period_end,
        'manual_review', v_missing_apr_review_mode,
        'due_date_is_payment_deadline_only', true
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
  'v4: soporta calendario CV por caso con approval_date + 10 = statement_date y due_date = statement_date + 10. El interés del primer statement se calcula solo para approval_date → statement_date; due_date queda como fecha límite de pago.';

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
  'Wrapper legacy compatible de 5 parámetros. Aplica la versión alineada con approval_date + 10 = statement_date y due_date = statement_date + 10.';

commit;
