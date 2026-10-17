begin;

alter table public.cob_revolving_accounts
  add column if not exists jurisdiction_state text;

alter table public.cob_revolving_accounts
  drop constraint if exists cob_revolving_accounts_jurisdiction_state_chk;

alter table public.cob_revolving_accounts
  add constraint cob_revolving_accounts_jurisdiction_state_chk
  check (jurisdiction_state is null or jurisdiction_state ~ '^[A-Z]{2}$');

create or replace function public.fn_abrir_izzy_finance_cargo_vuelta(
  p_cliente_id uuid,
  p_monto numeric,
  p_jurisdiction_state text,
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
  v_case_id uuid;
  v_account_id uuid;
  v_existing_apr numeric(6,5);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED: usuario no autenticado';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'INVALID_AMOUNT: el principal inicial debe ser mayor a 0';
  end if;

  v_state := upper(trim(coalesce(p_jurisdiction_state, '')));
  if v_state = '' then
    raise exception 'STATE_REQUIRED: seleccione el estado contractual';
  end if;

  v_apr := case v_state
    when 'FL' then 0.18000
    when 'CA' then 0.24000
    else null
  end;

  if v_apr is null then
    raise exception 'STATE_NOT_ENABLED: IZZY Finance todavía no está habilitado para %', v_state;
  end if;

  if v_apr > 0.24000 then
    raise exception 'APR_CAP_EXCEEDED: el APR corporativo de IZZY Finance no puede superar 24%%';
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

  select a.id, a.apr_anual
    into v_account_id, v_existing_apr
  from public.cob_revolving_accounts a
  where a.case_id = v_case_id
  limit 1;

  if v_account_id is null then
    v_account_id := public.fn_crear_revolving_account(
      v_case_id,
      v_apr,
      coalesce(p_notas, 'Cuenta IZZY Finance abierta desde Cargo de Vuelta')
    );

    update public.cob_revolving_accounts
       set jurisdiction_state = v_state,
           updated_at = now()
     where id = v_account_id;
  else
    if abs(coalesce(v_existing_apr, 0) - v_apr) > 0.00001 then
      raise exception
        'EXISTING_ACCOUNT_APR_MISMATCH: la cuenta existente tiene APR % y el programa de % requiere %',
        v_existing_apr, v_state, v_apr;
    end if;

    update public.cob_revolving_accounts
       set jurisdiction_state = coalesce(jurisdiction_state, v_state),
           updated_at = now()
     where id = v_account_id;
  end if;

  return jsonb_build_object(
    'case_id', v_case_id,
    'account_id', v_account_id,
    'jurisdiction_state', v_state,
    'apr_anual', v_apr,
    'daily_rate', round(v_apr / 365, 10),
    'status', 'ok'
  );
end;
$$;

revoke all on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,date,integer,text,text,text) from public;
revoke execute on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,date,integer,text,text,text) from anon;
grant execute on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,date,integer,text,text,text) to authenticated;

comment on function public.fn_abrir_izzy_finance_cargo_vuelta(uuid,numeric,text,date,integer,text,text,text) is
  'Alta atomica de Cargo de Vuelta en IZZY Finance. Crea/actualiza el caso, completa la cuenta revolving y registra principal inicial mediante fn_crear_revolving_account. FL=18%, CA=24%, tope corporativo 24%.';

commit;
