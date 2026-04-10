-- ============================================================
-- 0075: outbox_messages — bandeja de salida 1:1
-- ============================================================
-- Registra mensajes enviados, programados, borradores y fallidos
-- para contactos individuales (no campañas — esas van en mk_messages).
-- Arquitectura lista para webhooks de entrega/lectura (fase 2).
-- ============================================================

create table if not exists outbox_messages (
  id               uuid        primary key default gen_random_uuid(),
  owner_id         uuid        references usuarios(id) on delete set null,
  org_id           text,

  -- Contacto relacionado
  contact_tipo     text        check (contact_tipo in ('cliente', 'lead', 'embajador')),
  contact_id       uuid,

  -- Canal y destinatario
  canal            text        not null check (canal in ('whatsapp', 'sms', 'email', 'telegram')),
  destinatario     text,                       -- teléfono o email

  -- Contenido
  asunto           text,                       -- solo email
  mensaje          text        not null,       -- mensaje con variables (raw)
  mensaje_resuelto text,                       -- mensaje final con variables resueltas
  template_id      uuid        references message_templates(id) on delete set null,

  -- Estado del ciclo de vida
  -- borrador → programado → enviado
  --          → fallido
  --          → cancelado
  status           text        not null default 'borrador'
                   check (status in ('borrador', 'programado', 'enviado', 'fallido', 'cancelado')),

  -- Timing
  scheduled_for    timestamptz,
  sent_at          timestamptz,
  failed_at        timestamptz,
  error_message    text,

  -- Preparado para webhooks (fase 2)
  -- delivered_at  timestamptz,
  -- read_at       timestamptz,
  -- webhook_payload jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists outbox_messages_owner_idx
  on outbox_messages (owner_id);

create index if not exists outbox_messages_contact_idx
  on outbox_messages (contact_tipo, contact_id);

create index if not exists outbox_messages_scheduled_idx
  on outbox_messages (scheduled_for)
  where status = 'programado';

-- Trigger updated_at
create or replace function set_outbox_messages_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_outbox_messages_updated_at on outbox_messages;
create trigger trg_outbox_messages_updated_at
  before update on outbox_messages
  for each row execute function set_outbox_messages_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table outbox_messages enable row level security;

-- SELECT: cada usuario ve solo sus mensajes
create policy "outbox_messages_select"
  on outbox_messages for select
  using (owner_id = auth.uid());

-- INSERT
create policy "outbox_messages_insert"
  on outbox_messages for insert
  with check (owner_id = auth.uid());

-- UPDATE: solo el dueño
create policy "outbox_messages_update"
  on outbox_messages for update
  using (owner_id = auth.uid());

-- DELETE: solo borradores y cancelados
create policy "outbox_messages_delete"
  on outbox_messages for delete
  using (owner_id = auth.uid() and status in ('borrador', 'cancelado'));
