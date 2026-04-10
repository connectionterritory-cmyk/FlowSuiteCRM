-- ============================================================
-- 0074: message_templates — plantillas de mensajes en la nube
-- ============================================================
-- Reemplaza el almacenamiento en localStorage con una tabla por usuario.
-- Soporta scope personal y shared (equipo).
-- ============================================================

create table if not exists message_templates (
  id           uuid        primary key default gen_random_uuid(),
  owner_id     uuid        references usuarios(id) on delete cascade,
  org_id       text,                          -- organizacion del owner (desnormalizado para filtros)
  canal        text        not null check (canal in ('whatsapp', 'sms', 'email', 'telegram', 'all')),
  nombre       text        not null,
  asunto       text,                          -- solo email
  cuerpo       text        not null,
  category     text        not null default 'general',
  scope        text        not null default 'personal' check (scope in ('personal', 'shared')),
  is_system    boolean     not null default false,   -- reservado para plantillas del sistema
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists message_templates_owner_idx
  on message_templates (owner_id);

create index if not exists message_templates_org_shared_idx
  on message_templates (org_id, scope)
  where scope = 'shared';

-- Trigger updated_at
create or replace function set_message_templates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_message_templates_updated_at on message_templates;
create trigger trg_message_templates_updated_at
  before update on message_templates
  for each row execute function set_message_templates_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table message_templates enable row level security;

-- SELECT: dueño ve las suyas; cualquier miembro de la org ve las shared
create policy "message_templates_select"
  on message_templates for select
  using (
    owner_id = auth.uid()
    or (
      scope = 'shared'
      and org_id = (
        select organizacion from usuarios where id = auth.uid() limit 1
      )
    )
  );

-- INSERT: cualquier usuario autenticado puede crear sus propias plantillas
create policy "message_templates_insert"
  on message_templates for insert
  with check (owner_id = auth.uid());

-- UPDATE: solo el dueño puede editar
create policy "message_templates_update"
  on message_templates for update
  using (owner_id = auth.uid());

-- DELETE: solo el dueño puede eliminar
create policy "message_templates_delete"
  on message_templates for delete
  using (owner_id = auth.uid());
