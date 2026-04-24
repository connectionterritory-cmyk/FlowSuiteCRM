-- 0103: support media attachments in conversation history

alter table public.messages
  add column if not exists attachment_urls text[] not null default '{}'::text[];

comment on column public.messages.attachment_urls is
  'Public URLs of media/doc attachments associated to this message.';
