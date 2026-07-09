CREATE OR REPLACE FUNCTION public.fn_cob_statement_generar(p_revolving_account_id uuid, p_periodo_inicio date, p_periodo_fin date, p_fecha_corte date DEFAULT NULL::date, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor_id               uuid;
  v_actor_org_id           uuid;
  v_account                record;
  v_fecha_corte            date;
  v_fecha_vencimiento      date;
  v_ytd_inicio             date;
  v_dias_ciclo             integer;

  v_balance_previo         numeric(12,2);
  v_balance_sujeto_int     numeric(12,2);
  v_pagos_periodo          numeric(12,2);
  v_otros_creditos         numeric(12,2);
  v_compras_periodo        numeric(12,2);
  v_cargos_interes         numeric(12,2);
  v_cargos_fees            numeric(12,2);
  v_nuevo_balance          numeric(12,2);
  v_ytd_fees               numeric(12,2);
  v_ytd_interes            numeric(12,2);
  v_tasa_diaria            numeric(12,10);
  v_monto_base_acordado    numeric(12,2);
  v_pago_minimo            numeric(12,2);

  v_existing_id            uuid;
  v_statement_id           uuid;
  v_now                    timestamptz := now();
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

  v_fecha_vencimiento := public.fn_calcular_due_date(
    v_fecha_corte,
    v_account.min_days_statement_to_due,
    v_account.customer_preferred_payment_day
  );

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

  select a.monto_base_mensual
  into v_monto_base_acordado
  from public.cob_acuerdos_pago_automatico a
  where a.revolving_account_id = p_revolving_account_id
    and a.org_id = v_actor_org_id
    and a.estado in ('activo', 'borrador', 'pausado')
  order by a.created_at desc
  limit 1;

  v_pago_minimo := case
    when v_monto_base_acordado is not null then least(v_monto_base_acordado, v_nuevo_balance)
    else v_nuevo_balance
  end;

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
    v_pago_minimo,
    v_ytd_fees,
    v_ytd_interes,
    coalesce(
      p_notas,
      'Por favor realice su pago antes del '
        || to_char(v_fecha_vencimiento, 'MM/DD/YYYY')
        || ' para evitar cargos adicionales.'
    ),
    'draft',
    v_actor_id,
    jsonb_build_object(
      'account_apr',               v_account.apr_anual,
      'account_estado',            v_account.estado,
      'dias_ciclo',                v_dias_ciclo,
      'closing_day',               v_account.statement_closing_day,
      'preferred_payment_day',     v_account.customer_preferred_payment_day,
      'min_days_statement_to_due', v_account.min_days_statement_to_due,
      'monto_base_acordado',       v_monto_base_acordado,
      'fix_version',               '0157_pago_minimo_desde_acuerdo'
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_cob_acuerdo_crear(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor_id uuid;
  v_actor_org_id uuid;
  v_actor_can_operate boolean;

  v_case record;
  v_metodo record;
  v_existing uuid;

  v_cliente_id uuid;
  v_case_id uuid;
  v_revolving_id uuid;
  v_metodo_id uuid;

  v_monto_base numeric(12,2);
  v_pct numeric(5,2);
  v_monto_total numeric(12,2);
  v_frecuencia text;
  v_dia int;
  v_fecha_primer date;
  v_autorizado boolean;
  v_fecha_aut timestamptz;
  v_canal text;
  v_notas text;
  v_metadata jsonb;
  v_estado text;

  v_acuerdo_id uuid;
  v_gen_result jsonb := '{}'::jsonb;
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

  v_actor_can_operate := (
    public.is_admin_or_distribuidor()
    or public.is_supervisor_tele()
    or security.current_user_role() = 'telemercadeo'
  );

  if not v_actor_can_operate then
    raise exception 'FORBIDDEN: rol sin permiso para crear acuerdos';
  end if;

  if p_payload is null then
    raise exception 'INVALID_PARAM: p_payload es requerido';
  end if;

  v_cliente_id   := (p_payload->>'cliente_id')::uuid;
  v_case_id      := (p_payload->>'cargo_vuelta_case_id')::uuid;
  v_revolving_id := nullif(p_payload->>'revolving_account_id', '')::uuid;
  v_metodo_id    := nullif(p_payload->>'metodo_pago_id', '')::uuid;

  v_monto_base   := (p_payload->>'monto_base_mensual')::numeric(12,2);
  v_pct          := coalesce((p_payload->>'porcentaje_cargo_autorizado')::numeric(5,2), 0);
  v_monto_total  := (p_payload->>'monto_total_cobro')::numeric(12,2);

  v_frecuencia   := coalesce(p_payload->>'frecuencia', 'mensual');
  v_dia          := (p_payload->>'dia_cobro_preferido')::int;
  v_fecha_primer := (p_payload->>'fecha_primer_cobro')::date;

  v_autorizado   := coalesce((p_payload->>'autorizado_por_cliente')::boolean, false);
  v_fecha_aut    := nullif(p_payload->>'fecha_autorizacion', '')::timestamptz;
  v_canal        := nullif(p_payload->>'canal_autorizacion', '');
  v_notas        := nullif(p_payload->>'notas', '');
  v_metadata     := coalesce(p_payload->'metadata', '{}'::jsonb);

  if v_cliente_id is null or v_case_id is null then
    raise exception 'INVALID_PARAM: cliente_id y cargo_vuelta_case_id son requeridos';
  end if;

  if v_monto_base is null or v_monto_base <= 0 then
    raise exception 'INVALID_PARAM: monto_base_mensual debe ser > 0';
  end if;

  if v_pct < 0 or v_pct > 100 then
    raise exception 'INVALID_PARAM: porcentaje_cargo_autorizado debe estar entre 0 y 100';
  end if;

  if v_monto_total is null or v_monto_total <= 0 then
    raise exception 'INVALID_PARAM: monto_total_cobro debe ser > 0';
  end if;

  if v_frecuencia <> 'mensual' then
    raise exception 'INVALID_PARAM: frecuencia debe ser mensual';
  end if;

  if v_dia is null or v_dia < 1 or v_dia > 31 then
    raise exception 'INVALID_PARAM: dia_cobro_preferido debe estar entre 1 y 31';
  end if;

  if v_fecha_primer is null then
    raise exception 'INVALID_PARAM: fecha_primer_cobro es requerida';
  end if;

  if v_autorizado and v_fecha_aut is null then
    raise exception 'INVALID_PARAM: fecha_autorizacion es requerida cuando autorizado_por_cliente = true';
  end if;

  select c.id, c.org_id, c.cliente_id
  into v_case
  from public.cargo_vuelta_cases c
  where c.id = v_case_id
    and c.org_id = v_actor_org_id
  limit 1;

  if not found then
    raise exception 'CASE_NOT_FOUND_OR_FORBIDDEN: el caso no existe o no pertenece a la organización';
  end if;

  if v_case.cliente_id is distinct from v_cliente_id then
    raise exception 'INVALID_RELATION: cliente_id no corresponde al cliente del caso';
  end if;

  if v_metodo_id is not null then
    select m.id, m.org_id, m.cliente_id, m.cargo_vuelta_case_id
    into v_metodo
    from public.cob_metodos_pago m
    where m.id = v_metodo_id
      and m.org_id = v_actor_org_id
    limit 1;

    if not found then
      raise exception 'METODO_PAGO_NOT_FOUND_OR_FORBIDDEN: método de pago no existe o no pertenece a la organización';
    end if;

    if v_metodo.cliente_id is not null and v_metodo.cliente_id is distinct from v_cliente_id then
      raise exception 'INVALID_RELATION: metodo_pago_id no corresponde al cliente del acuerdo';
    end if;

    if v_metodo.cargo_vuelta_case_id is not null and v_metodo.cargo_vuelta_case_id is distinct from v_case_id then
      raise exception 'INVALID_RELATION: metodo_pago_id no corresponde al caso del acuerdo';
    end if;
  end if;

  if v_revolving_id is not null then
    perform 1
    from public.cob_revolving_accounts a
    where a.id = v_revolving_id
      and a.org_id = v_actor_org_id
      and a.case_id = v_case_id;

    if not found then
      raise exception 'REVOLVING_NOT_FOUND_OR_FORBIDDEN: revolving_account_id inválido para org/caso';
    end if;
  end if;

  select a.id into v_existing
  from public.cob_acuerdos_pago_automatico a
  where a.org_id = v_actor_org_id
    and a.cargo_vuelta_case_id = v_case_id
    and a.estado in ('activo', 'pausado')
  limit 1;

  if v_existing is not null then
    raise exception 'DUPLICATE_ACTIVE_AGREEMENT: ya existe acuerdo activo/pausado para este caso (%)', v_existing;
  end if;

  v_estado := case
    when v_autorizado then 'activo'
    else 'borrador'
  end;

  insert into public.cob_acuerdos_pago_automatico (
    org_id,
    cliente_id,
    cargo_vuelta_case_id,
    revolving_account_id,
    metodo_pago_id,
    monto_base_mensual,
    porcentaje_cargo_autorizado,
    monto_total_cobro,
    frecuencia,
    dia_cobro_preferido,
    fecha_primer_cobro,
    fecha_proximo_cobro,
    statement_automatico,
    recordatorio_automatico,
    estado,
    autorizado_por_cliente,
    fecha_autorizacion,
    canal_autorizacion,
    notas,
    metadata,
    created_by,
    updated_by
  )
  values (
    v_actor_org_id,
    v_cliente_id,
    v_case_id,
    v_revolving_id,
    v_metodo_id,
    v_monto_base,
    v_pct,
    v_monto_total,
    'mensual',
    v_dia,
    v_fecha_primer,
    v_fecha_primer,
    coalesce((p_payload->>'statement_automatico')::boolean, true),
    coalesce((p_payload->>'recordatorio_automatico')::boolean, true),
    v_estado,
    v_autorizado,
    v_fecha_aut,
    v_canal,
    v_notas,
    v_metadata,
    v_actor_id,
    v_actor_id
  )
  returning id into v_acuerdo_id;

  insert into public.cob_acuerdo_eventos (
    org_id,
    acuerdo_id,
    tipo_evento,
    actor_user_id,
    payload_after,
    metadata
  )
  values (
    v_actor_org_id,
    v_acuerdo_id,
    'acuerdo_creado',
    v_actor_id,
    jsonb_build_object(
      'estado', v_estado,
      'fecha_primer_cobro', v_fecha_primer,
      'monto_total_cobro', v_monto_total,
      'dia_cobro_preferido', v_dia
    ),
    jsonb_build_object('source', 'fn_cob_acuerdo_crear')
  );

  if v_estado = 'activo' then
    v_gen_result := public.fn_cob_acuerdo_generar_cobros(v_acuerdo_id, 3);
  end if;

  return jsonb_build_object(
    'acuerdo_id', v_acuerdo_id,
    'estado', v_estado,
    'fecha_proximo_cobro', v_fecha_primer,
    'cobros_generados', v_gen_result
  );
end;
$function$;
