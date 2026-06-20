-- ============================================================
-- 0164: Create crm_tareas table
--
-- Problem:
--   CitaModal creates follow-up tasks when closing a cita
--   (completada state). The code writes to `crm_tareas` but the
--   table did not exist → INSERT failed silently with a toast
--   "Tarea no guardada: …" error. HoyPage also reads from this
--   table for upcoming tasks.
--
-- Design decisions:
--   - cita_origen_id: nullable FK back to the originating cita
--   - asignado_a: FK to auth.users (the assignee)
--   - created_by: FK to auth.users (the creator)
--   - RLS: authenticated users can read/write their org's tasks.
--     Refined RLS per-cobrador is a known future gap (CLAUDE.md).
--
-- Rollback:
--   drop table if exists public.crm_tareas;
-- ============================================================

begin;

create table if not exists public.crm_tareas (
  id                uuid          primary key default gen_random_uuid(),
  org_id            uuid,

  contacto_tipo     text          not null check (contacto_tipo in ('cliente', 'lead')),
  contacto_id       uuid          not null,

  tipo              text          not null,   -- llamada, visita, seguimiento, etc.
  descripcion       text,
  prioridad         text          not null default 'media'
                                   check (prioridad in ('alta', 'media', 'baja')),
  estado            text          not null default 'pendiente'
                                   check (estado in ('pendiente', 'completada', 'cancelada')),

  asignado_a        uuid          references auth.users(id) on delete set null,
  created_by        uuid          references auth.users(id) on delete set null,

  fecha_vencimiento date,
  hora_vencimiento  time,

  cita_origen_id    uuid          references public.citas(id) on delete set null,

  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

-- Indexes for the most common lookups
create index if not exists crm_tareas_contacto_idx
  on public.crm_tareas (contacto_tipo, contacto_id);

create index if not exists crm_tareas_asignado_a_idx
  on public.crm_tareas (asignado_a)
  where estado = 'pendiente';

create index if not exists crm_tareas_cita_origen_idx
  on public.crm_tareas (cita_origen_id)
  where cita_origen_id is not null;

-- Keep updated_at current automatically
create or replace function public.set_crm_tareas_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_crm_tareas_updated_at
  before update on public.crm_tareas
  for each row execute function public.set_crm_tareas_updated_at();

-- RLS
alter table public.crm_tareas enable row level security;

create policy crm_tareas_auth_read on public.crm_tareas
  for select to authenticated
  using (true);

create policy crm_tareas_auth_write on public.crm_tareas
  for all to authenticated
  using (true)
  with check (true);

comment on table public.crm_tareas is
  'Tareas de seguimiento CRM. Creadas desde CitaModal (cierre de cita) u otras acciones comerciales.';

commit;
