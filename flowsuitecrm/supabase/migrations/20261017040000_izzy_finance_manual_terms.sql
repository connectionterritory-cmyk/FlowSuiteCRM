begin;

drop function if exists public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,date,integer,text,text,text);

create or replace function public.fn_abrir_izzy_finance_cargo_vuelta(
  p_cliente_id uuid,
  p_monto numeric,
  p_jurisdiction_state text,
  p_apr numeric,
  p_late_fee_fijo numeric default 0,
  p_fecha_cargo_vuelta date default null,
  p_dias_vencido integer default null,
  p_numero_cuenta_hycite text default null,
  p_numero_orden_hycite text default null,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
  v_apr numeric(6,5);
  v_late_fee numeric(12,2);
  v_case_id uuid;
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'INVALID_AMOUNT: el principal inicial debe ser mayor a 0';
  end if;

  v_state := upper(trim(coalesce(p_jurisdiction_state, '')));
  if v_state !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_STATE: use la abreviatura postal de 2 letras';
  end if;

  if p_apr is null then
    raise exception 'APR_REQUIRED: indique el APR negociado con el cliente';
  end if;

  v_apr := round(p_apr::numeric, 5);
  if v_apr < 0 or v_apr > 0.24000 then
    raise exception 'INVALID_APR: el APR debe estar entre 0%% y 24%%';
  end if;

  v_late_fee := round(coalesce(p_late_fee_fijo, 0)::numeric, 2);
  if v_late_fee < 0 then
    raise exception 'INVALID_LATE_FEE: el late fee no puede ser negativo';
  end if;

  v_case_id := public.fn_abrir_o_actualizar_cargo_vuelta_case(
    p_cliente_id,
    p_monto,
    p_fecha_cargo_vuelta,
    p_dias_vencido,
    p_numero_cuenta_hycite,
    p_numero_orden_hycite,
    p_notas,
    'cargo_vuelta'
  );

  select a.id
    into v_account_id
  from public.cob_revolving_accounts a
  where a.case_id = v_case_id
  limit 1;

  if v_account_id is not null then
    raise exception 'IZZY_FINANCE_ACCOUNT_EXISTS: ya existe una cuenta financiera para este caso (%)', v_account_id;
  end if;

  v_account_id := public.fn_crear_revolving_account_cargo_vuelta(
    v_case_id,
    v_apr,
    coalesce(p_notas, 'Cuenta IZZY Finance abierta desde Cargo de Vuelta')
  );

  update public.cob_revolving_accounts
     set jurisdiction_state = v_state,
         late_fee_fijo = v_late_fee,
         updated_at = now()
   where id = v_account_id;

  return jsonb_build_object(
    'case_id', v_case_id,
    'account_id', v_account_id,
    'jurisdiction_state', v_state,
    'apr_anual', v_apr,
    'late_fee_fijo', v_late_fee,
    'daily_rate', round(v_apr / 365, 10),
    'status', 'ok'
  );
end;
$$;

revoke all on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,numeric,numeric,date,integer,text,text,text) from public;
revoke execute on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,numeric,numeric,date,integer,text,text,text) from anon;
grant execute on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,numeric,numeric,date,integer,text,text,text) to authenticated;

comment on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,numeric,numeric,date,integer,text,text,text) is
  'Alta atomica de Cargo de Vuelta en IZZY Finance con APR negociado manualmente entre 0% y 24% y late fee fijo configurable. El estado contractual se conserva para futuros guardrails regulatorios.';

commit;