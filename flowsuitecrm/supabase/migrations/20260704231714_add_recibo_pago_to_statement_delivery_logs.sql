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
        'recibo_pago'::text
      ]
    )
  );

commit;
