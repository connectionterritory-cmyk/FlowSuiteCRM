create or replace function public.fn_cob_registrar_pago_revolving_operativo(
  p_account_id uuid,
  p_monto numeric,
  p_fecha date default current_date,
  p_metodo_pago text default 'otro',
  p_referencia_externa text default null,
  p_comprobante_url text default null,
  p_notas text default null,
  p_ptp_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_account public.cob_revolving_accounts%rowtype;
  v_result jsonb;
  v_aplicado_total numeric(12,2);
  v_excedente numeric(12,2);
  v_pago_id uuid;
  v_gestion_id uuid;
  v_metodo_pago text := coalesce(nullif(trim(p_metodo_pago), ''), 'otro');
  v_notas_pago text;
  v_fee_plataforma numeric(12,2);
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select u.org_id
    into v_org_id
  from public.usuarios u
  where u.id = v_user_id
  limit 1;

  if v_org_id is null then
    raise exception 'Usuario sin org_id en public.usuarios';
  end if;

  if v_metodo_pago not in ('cash', 'check', 'zelle', 'ach', 'card', 'hycite', 'wire', 'otro') then
    raise exception 'Metodo de pago invalido';
  end if;

  v_fee_plataforma := case when v_metodo_pago = 'card' then round(p_monto * 0.04, 2) else 0.00 end;

  select *
    into v_account
  from public.cob_revolving_accounts cra
  where cra.id = p_account_id
    and cra.org_id = v_org_id;

  if not found then
    raise exception 'Cuenta revolving no encontrada o fuera de su organizacion';
  end if;

  if p_ptp_id is not null and not exists (
    select 1
    from public.cob_ptps ptp
    where ptp.id = p_ptp_id
      and ptp.org_id = v_org_id
      and ptp.cliente_id = v_account.cliente_id
      and ptp.case_id = v_account.case_id
      and ptp.estado in ('pendiente', 'vencido')
  ) then
    raise exception 'PTP invalido para el pago actual';
  end if;

  v_result := public.fn_registrar_pago_revolving(
    p_account_id,
    p_monto,
    p_fecha,
    p_referencia_externa,
    p_notas
  );

  v_aplicado_total := round(
    coalesce((v_result->>'aplicado_fees')::numeric, 0)
    + coalesce((v_result->>'aplicado_interes')::numeric, 0)
    + coalesce((v_result->>'aplicado_principal')::numeric, 0),
    2
  );
  v_excedente := round(coalesce((v_result->>'excedente')::numeric, 0), 2);

  v_notas_pago := nullif(trim(concat_ws(' | ',
    nullif(trim(p_notas), ''),
    case
      when v_excedente > 0 then 'Excedente no aplicado: $' || to_char(v_excedente, 'FM999999990.00')
      else null
    end,
    case
      when nullif(trim(p_referencia_externa), '') is not null
        then 'Ref: ' || trim(p_referencia_externa)
      else null
    end
  )), '');

  insert into public.cob_pagos (
    org_id,
    cliente_id,
    case_id,
    cargo_vuelta_case_id,
    revolving_account_id,
    ptp_id,
    monto,
    moneda,
    fecha_pago,
    metodo_pago,
    referencia_externa,
    comprobante_url,
    notas,
    estado,
    source,
    created_by,
    fee_plataforma
  ) values (
    v_org_id,
    v_account.cliente_id,
    v_account.case_id,
    v_account.case_id,
    v_account.id,
    p_ptp_id,
    v_aplicado_total,
    'USD',
    p_fecha,
    v_metodo_pago,
    nullif(trim(p_referencia_externa), ''),
    nullif(trim(p_comprobante_url), ''),
    v_notas_pago,
    'registrado',
    'manual',
    v_user_id,
    v_fee_plataforma
  )
  returning id into v_pago_id;

  if p_ptp_id is not null then
    update public.cob_ptps
    set
      estado = 'cumplido',
      fecha_cumplimiento = p_fecha,
      cumplido_at = coalesce(cumplido_at, now()),
      updated_by = v_user_id,
      updated_at = now()
    where id = p_ptp_id;
  end if;

  insert into public.cob_gestiones (
    org_id,
    cliente_id,
    case_id,
    tipo_gestion,
    resultado,
    monto_comprometido,
    notas,
    gestionado_por,
    ptp_id
  ) values (
    v_org_id,
    v_account.cliente_id,
    v_account.case_id,
    'Pago DFP',
    'pago_realizado',
    v_aplicado_total,
    v_notas_pago,
    v_user_id,
    p_ptp_id
  )
  returning id into v_gestion_id;

  perform public.fn_cob_insert_contacto_actividad(
    v_org_id,
    'cliente',
    v_account.cliente_id,
    'nota',
    'Pago DFP registrado',
    v_notas_pago,
    jsonb_build_object(
      'source', 'fn_cob_registrar_pago_revolving_operativo',
      'case_id', v_account.case_id,
      'revolving_account_id', v_account.id,
      'pago_id', v_pago_id,
      'gestion_id', v_gestion_id,
      'ptp_id', p_ptp_id,
      'monto_recibido', round(p_monto, 2),
      'monto_aplicado', v_aplicado_total,
      'excedente', v_excedente,
      'metodo_pago', v_metodo_pago,
      'fee_plataforma', v_fee_plataforma
    ),
    v_user_id,
    (p_fecha::timestamp at time zone 'UTC'),
    'pago_realizado'
  );

  return v_result
    || jsonb_build_object(
      'ok', true,
      'pago_id', v_pago_id,
      'gestion_id', v_gestion_id,
      'case_id', v_account.case_id,
      'cliente_id', v_account.cliente_id,
      'ptp_closed', p_ptp_id is not null,
      'fee_plataforma', v_fee_plataforma
    );
end;
$$;
