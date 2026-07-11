begin;

alter table public.statement_delivery_logs
  drop constraint if exists statement_delivery_logs_document_version_uidx;

alter table public.statement_delivery_logs
  add constraint statement_delivery_logs_document_version_status_uidx
  unique (document_type, document_id, pdf_version, email_status);

comment on constraint statement_delivery_logs_document_version_status_uidx on public.statement_delivery_logs is
  'Permite que test_sent y sent (u otros estados) coexistan como filas de auditoria distintas para el mismo documento/version. La proteccion real contra un segundo envio real duplicado vive en send-cv-statement (chequeo de email_status=sent antes de llamar a Resend), no en este constraint.';

commit;
