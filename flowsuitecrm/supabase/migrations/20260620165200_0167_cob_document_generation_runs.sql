-- ============================================================
-- 0167: auditoría para job diario de generación documental
--
-- Objetivo:
--   Preparar trazabilidad del job diario sin activar cron todavía.
--   Esta fase NO agenda pg_cron ni ejecuta envíos automáticos.
-- ============================================================

begin;

create table if not exists public.cob_document_generation_runs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid,
  job_name            text not null,
  run_date            date not null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null default 'running'
                        check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  dfp_generated       integer not null default 0,
  dfp_skipped         integer not null default 0,
  cv_generated        integer not null default 0,
  cv_skipped          integer not null default 0,
  errors_count        integer not null default 0,
  error_summary       text,
  metadata            jsonb not null default '{}'::jsonb,
  created_by          uuid references public.usuarios(id) on delete set null,
  created_at          timestamptz not null default now()
);

comment on table public.cob_document_generation_runs is
  'Auditoría de corridas del job diario de generación de statements/resúmenes. Preparado para futura orquestación automática sin activar cron en esta fase.';

create index if not exists cob_document_generation_runs_job_date_idx
  on public.cob_document_generation_runs (job_name, run_date desc, created_at desc);

create table if not exists public.cob_document_generation_run_items (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.cob_document_generation_runs(id) on delete cascade,
  org_id              uuid,
  case_id             uuid references public.cargo_vuelta_cases(id) on delete set null,
  cliente_id          uuid references public.clientes(id) on delete set null,
  document_type       text not null check (document_type in ('dfp_statement', 'cv_resumen')),
  period_start        date,
  period_end          date,
  result              text not null check (result in ('generated', 'skipped_duplicate', 'skipped_not_eligible', 'error')),
  document_id         uuid,
  error_message       text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

comment on table public.cob_document_generation_run_items is
  'Detalle por caso de una corrida del job documental. Permite auditar duplicados evitados, no elegibles y errores sin enviar mensajes todavía.';

create index if not exists cob_document_generation_run_items_run_idx
  on public.cob_document_generation_run_items (run_id, created_at);

alter table public.cob_document_generation_runs enable row level security;
alter table public.cob_document_generation_run_items enable row level security;

drop policy if exists cob_document_generation_runs_cartera_role on public.cob_document_generation_runs;
create policy cob_document_generation_runs_cartera_role
  on public.cob_document_generation_runs
  for all to authenticated
  using (
    org_id is null
    or (
      org_id = (
        select u.org_id from public.usuarios u
        where u.id = auth.uid() limit 1
      )
      and (
        public.is_admin_or_distribuidor()
        or public.is_supervisor_tele()
        or security.current_user_role() = 'telemercadeo'
      )
    )
  )
  with check (
    org_id is null
    or (
      org_id = (
        select u.org_id from public.usuarios u
        where u.id = auth.uid() limit 1
      )
      and (
        public.is_admin_or_distribuidor()
        or public.is_supervisor_tele()
      )
    )
  );

drop policy if exists cob_document_generation_run_items_cartera_role on public.cob_document_generation_run_items;
create policy cob_document_generation_run_items_cartera_role
  on public.cob_document_generation_run_items
  for all to authenticated
  using (
    org_id is null
    or (
      org_id = (
        select u.org_id from public.usuarios u
        where u.id = auth.uid() limit 1
      )
      and (
        public.is_admin_or_distribuidor()
        or public.is_supervisor_tele()
        or security.current_user_role() = 'telemercadeo'
      )
    )
  )
  with check (
    org_id is null
    or (
      org_id = (
        select u.org_id from public.usuarios u
        where u.id = auth.uid() limit 1
      )
      and (
        public.is_admin_or_distribuidor()
        or public.is_supervisor_tele()
      )
    )
  );

commit;
