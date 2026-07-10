begin;

alter table public.statement_delivery_logs
  drop constraint if exists statement_delivery_logs_document_type_check;

alter table public.statement_delivery_logs
  add constraint statement_delivery_logs_document_type_check
  check (
    document_type = any (
      array[
        'dfp_statement'::text,
        'cv_resumen'::text,
        'recibo_pago'::text,
        'invitacion_acuerdo'::text
      ]
    )
  );

create or replace function public.fn_cob_get_invitacion_data(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
    'case_id', cv.id,
    'cliente_id', cv.cliente_id,
    'cliente_nombre', trim(concat(cl.nombre, ' ', cl.apellido)),
    'cliente_email', cl.email,
    'monto_devuelto', cv.monto_devuelto,
    'org_id', cv.org_id
  )
  into v_payload
  from public.cargo_vuelta_cases cv
  join public.clientes cl on cl.id = cv.cliente_id
  where cv.id = p_case_id
    and cv.monto_devuelto > 0
    and cv.estado <> 'Cerrado'
    and not exists (
      select 1
      from public.cob_revolving_accounts ra
      where ra.case_id = cv.id
    );

  if v_payload is null then
    raise exception 'Caso no elegible para invitacion de acuerdo: %', p_case_id;
  end if;

  return v_payload;
end;
$function$;

revoke all on function public.fn_cob_get_invitacion_data(uuid) from public;
grant execute on function public.fn_cob_get_invitacion_data(uuid) to service_role;

commit;
