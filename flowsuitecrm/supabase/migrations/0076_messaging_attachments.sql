-- ============================================================
-- 0076: messaging_attachments — Soporte para archivos adjuntos
-- ============================================================

-- 1. Agregar columnas para URLs de adjuntos (Array de texto)
alter table public.message_templates
  add column if not exists attachment_urls text[] default '{}';

alter table public.outbox_messages
  add column if not exists attachment_urls text[] default '{}';

-- 2. Crear bucket de storage para adjuntos
insert into storage.buckets (id, name, public)
values ('messaging_attachments', 'messaging_attachments', true)
on conflict (id) do nothing;

-- 3. Políticas RLS para el bucket 'messaging_attachments'

-- Ver: Todos los autenticados (miembros de la organización) pueden ver adjuntos de mensajes enviados.
-- Lo hacemos público para evitar problemas con links dinámicos en WhatsApp/Email, 
-- pero el bucket tiene el flag 'public: true'.
create policy "Adjuntos de mensajeria son publicos para lectura"
on storage.objects for select
to public
using (bucket_id = 'messaging_attachments');

-- Subir: Cualquier usuario autenticado puede subir archivos para sus mensajes.
create policy "Usuarios pueden subir adjuntos de mensajeria"
on storage.objects for insert
to authenticated
with check (bucket_id = 'messaging_attachments');

-- Eliminar: Solo el dueño del objeto puede eliminarlo.
create policy "Usuarios pueden eliminar sus propios adjuntos"
on storage.objects for delete
to authenticated
using (bucket_id = 'messaging_attachments' and owner = auth.uid());

-- 4. Notas adicionales:
-- El limite de tamaño sugerido de 10MB se controlará preferiblemente en el Frontend antes de la subida,
-- aunque se puede configurar en el dashboard de Supabase posteriormente.
