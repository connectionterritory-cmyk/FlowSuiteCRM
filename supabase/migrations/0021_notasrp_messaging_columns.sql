-- Migration 0021: Add messaging columns to notasrp and lead_notas
-- These columns are written by MessageModal when a WhatsApp/SMS is sent,
-- and read by ClientesPage (tabs/notas) and Cliente360.
begin;

-- 1. Extend notasrp with message-log columns
alter table public.notasrp
  add column if not exists canal        text,
  add column if not exists tipo_mensaje text,
  add column if not exists enviado_por  uuid references public.usuarios(id) on delete set null,
  add column if not exists enviado_en   timestamptz,
  add column if not exists mensaje      text;

-- Index for efficient per-client message history queries
create index if not exists notasrp_cliente_id_enviado_en_idx
  on public.notasrp (cliente_id, enviado_en desc nulls last);

-- 2. Extend lead_notas with message-log columns
--    (same columns used by MessageModal when contact has a leadId)
alter table public.lead_notas
  add column if not exists canal        text,
  add column if not exists tipo_mensaje text,
  add column if not exists mensaje      text;

commit;
