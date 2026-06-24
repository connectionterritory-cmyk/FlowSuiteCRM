begin;

create table if not exists public.statement_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_type text not null
    check (document_type in ('dfp_statement', 'cv_resumen')),
  document_id uuid not null,
  case_id uuid,
  cliente_id uuid,
  pdf_storage_path text,
  pdf_generated_at timestamptz,
  pdf_hash text,
  pdf_version integer not null default 1
    check (pdf_version > 0),
  email_to text,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'pdf_generated', 'queued', 'sent', 'failed', 'skipped', 'blocked_policy')),
  email_sent_at timestamptz,
  email_error text,
  delivery_attempt_count integer not null default 0
    check (delivery_attempt_count >= 0),
  last_delivery_attempt_at timestamptz,
  outbox_message_id uuid references public.outbox_messages(id) on delete set null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint statement_delivery_logs_document_version_uidx
    unique (document_type, document_id, pdf_version)
);

comment on table public.statement_delivery_logs is
  'Ledger documental unificado para PDFs persistentes y futuros envíos manuales/automáticos de statements CV y DFP.';

comment on column public.statement_delivery_logs.pdf_storage_path is
  'Ruta privada en Supabase Storage del PDF persistido. Nunca exponer como public URL permanente.';

comment on column public.statement_delivery_logs.pdf_hash is
  'SHA-256 del PDF renderizado para deduplicación e idempotencia documental.';

comment on column public.statement_delivery_logs.email_status is
  'Estado operativo del ciclo de entrega por email. En Fase A1 solo se usa pending/pdf_generated.';

create unique index if not exists statement_delivery_logs_idempotency_key_uidx
  on public.statement_delivery_logs (idempotency_key)
  where idempotency_key is not null;

create index if not exists statement_delivery_logs_org_document_created_idx
  on public.statement_delivery_logs (org_id, document_type, created_at desc);

create index if not exists statement_delivery_logs_case_created_idx
  on public.statement_delivery_logs (case_id, created_at desc);

create index if not exists statement_delivery_logs_cliente_created_idx
  on public.statement_delivery_logs (cliente_id, created_at desc);

create index if not exists statement_delivery_logs_email_status_attempt_idx
  on public.statement_delivery_logs (email_status, last_delivery_attempt_at desc);

create index if not exists statement_delivery_logs_outbox_message_idx
  on public.statement_delivery_logs (outbox_message_id);

create index if not exists statement_delivery_logs_pdf_generated_idx
  on public.statement_delivery_logs (pdf_generated_at desc)
  where pdf_generated_at is not null;

create trigger trg_statement_delivery_logs_updated_at
  before update on public.statement_delivery_logs
  for each row execute function public.fn_set_updated_at();

alter table public.statement_delivery_logs enable row level security;

drop policy if exists statement_delivery_logs_cartera_select on public.statement_delivery_logs;
create policy statement_delivery_logs_cartera_select
  on public.statement_delivery_logs
  for select to authenticated
  using (
    org_id = (
      select u.org_id from public.usuarios u
      where u.id = auth.uid() limit 1
    )
    and (
      public.is_admin_or_distribuidor()
      or public.is_supervisor_tele()
      or security.current_user_role() = 'telemercadeo'
    )
  );

revoke all on table public.statement_delivery_logs from anon;
revoke all on table public.statement_delivery_logs from public;
grant select on table public.statement_delivery_logs to authenticated;

insert into storage.buckets (id, name, public)
values ('statement_pdfs', 'statement_pdfs', false)
on conflict (id) do update
set public = excluded.public;

comment on table public.statement_delivery_logs is
  'Ledger documental unificado para PDFs persistentes y futuros envíos manuales/automáticos de statements CV y DFP. '
  'Las escrituras deben ocurrir desde backend/service role; la app autenticada solo lee.';

commit;
