begin;

alter table public.statement_delivery_logs
  drop constraint if exists statement_delivery_logs_email_status_check;

alter table public.statement_delivery_logs
  add constraint statement_delivery_logs_email_status_check
  check (
    email_status in (
      'pending',
      'pdf_generated',
      'queued',
      'sent',
      'test_sent',
      'failed',
      'skipped',
      'blocked_policy'
    )
  );

comment on column public.statement_delivery_logs.email_status is
  'Estado operativo del ciclo de entrega por email. test_sent indica envio QA con override y no debe marcar el statement como enviado real.';

commit;
