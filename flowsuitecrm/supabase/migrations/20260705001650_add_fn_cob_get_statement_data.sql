create or replace function public.fn_cob_get_statement_data(p_statement_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_header jsonb;
  v_lines jsonb;
begin
  select jsonb_build_object(
    'statement_id', s.id,
    'org_id', s.org_id,
    'cliente_id', s.cliente_id,
    'cliente_nombre', trim(concat(cl.nombre, ' ', cl.apellido)),
    'cliente_email', cl.email,
    'case_id', s.case_id,
    'revolving_account_id', s.revolving_account_id,
    'periodo_inicio', s.periodo_inicio,
    'periodo_fin', s.periodo_fin,
    'fecha_corte', s.fecha_corte,
    'fecha_vencimiento', s.fecha_vencimiento,
    'balance_previo', s.balance_previo,
    'compras_periodo', s.compras_periodo,
    'pagos_periodo', s.pagos_periodo,
    'otros_creditos', s.otros_creditos,
    'cargos_interes_periodo', s.cargos_interes_periodo,
    'cargos_totales_periodo', s.cargos_totales_periodo,
    'apr_tae', s.apr_tae,
    'nuevo_balance', s.nuevo_balance,
    'pago_minimo', s.pago_minimo,
    'balance_atrasado', s.balance_atrasado,
    'mensaje_pago', s.mensaje_pago,
    'status', s.status
  )
  into v_header
  from public.cob_statements s
  join public.clientes cl on cl.id = s.cliente_id
  where s.id = p_statement_id;

  if v_header is null then
    raise exception 'Statement no encontrado: %', p_statement_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_date', l.transaction_date,
    'entry_type', l.entry_type,
    'component_type', l.component_type,
    'description', l.description,
    'amount', l.amount
  ) order by l.line_order), '[]'::jsonb)
  into v_lines
  from public.cob_statement_lines l
  where l.statement_id = p_statement_id;

  return v_header || jsonb_build_object('lines', v_lines);
end;
$function$;
