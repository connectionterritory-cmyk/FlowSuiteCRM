-- ============================================================
-- 0136: cc_emails en outbox_messages
--
-- Permite enviar copia de emails a destinatarios adicionales.
-- Usado en cartas de cargo de vuelta para CC a Patricia Caicedo.
-- ROLLBACK: alter table public.outbox_messages drop column if exists cc_emails;
-- ============================================================

begin;

alter table public.outbox_messages
  add column if not exists cc_emails text[] default null;

comment on column public.outbox_messages.cc_emails is
  'Destinatarios en copia (CC) del email. Solo aplica cuando canal = email.';

commit;
