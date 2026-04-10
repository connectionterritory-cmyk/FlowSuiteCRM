import { supabase } from './supabase/client'
import type { MessagingChannel } from '../types/messaging'

export type TemplateScope = 'personal' | 'shared'
export type TemplateCanal = MessagingChannel | 'all'

export type MessageTemplate = {
  id: string
  owner_id: string
  org_id: string | null
  canal: TemplateCanal
  nombre: string
  asunto: string | null
  cuerpo: string
  category: string
  scope: TemplateScope
  is_system: boolean
  created_at: string
  updated_at: string
}

export type NewTemplateInput = {
  canal: TemplateCanal
  nombre: string
  asunto?: string | null
  cuerpo: string
  category: string
  scope?: TemplateScope
}

export type UpdateTemplateInput = Partial<Omit<NewTemplateInput, 'canal'>> & {
  canal?: TemplateCanal
}

// ── Fetch ──────────────────────────────────────────────────

export async function fetchTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as MessageTemplate[]
}

// ── Create ─────────────────────────────────────────────────

export async function createTemplate(
  userId: string,
  orgId: string | null,
  input: NewTemplateInput
): Promise<MessageTemplate> {
  const { data, error } = await supabase
    .from('message_templates')
    .insert({
      owner_id: userId,
      org_id: orgId,
      canal: input.canal,
      nombre: input.nombre.trim(),
      asunto: input.asunto?.trim() ?? null,
      cuerpo: input.cuerpo.trim(),
      category: input.category,
      scope: input.scope ?? 'personal',
    })
    .select()
    .single()

  if (error) throw error
  return data as MessageTemplate
}

// ── Update ─────────────────────────────────────────────────

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput
): Promise<MessageTemplate> {
  const patch: Record<string, unknown> = {}
  if (input.nombre !== undefined) patch.nombre = input.nombre.trim()
  if (input.asunto !== undefined) patch.asunto = input.asunto?.trim() ?? null
  if (input.cuerpo !== undefined) patch.cuerpo = input.cuerpo.trim()
  if (input.category !== undefined) patch.category = input.category
  if (input.scope !== undefined) patch.scope = input.scope
  if (input.canal !== undefined) patch.canal = input.canal

  const { data, error } = await supabase
    .from('message_templates')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as MessageTemplate
}

// ── Duplicate ──────────────────────────────────────────────

export async function duplicateTemplate(
  userId: string,
  orgId: string | null,
  source: MessageTemplate
): Promise<MessageTemplate> {
  return createTemplate(userId, orgId, {
    canal: source.canal,
    nombre: `${source.nombre} (copia)`,
    asunto: source.asunto,
    cuerpo: source.cuerpo,
    category: source.category,
    scope: 'personal',
  })
}

// ── Delete ─────────────────────────────────────────────────

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Save outbox entry ──────────────────────────────────────

export type OutboxStatus = 'borrador' | 'programado' | 'enviado' | 'fallido' | 'cancelado'

export type OutboxInput = {
  owner_id: string
  org_id?: string | null
  contact_tipo?: 'cliente' | 'lead' | 'embajador' | null
  contact_id?: string | null
  canal: MessagingChannel
  destinatario?: string | null
  asunto?: string | null
  mensaje: string
  mensaje_resuelto?: string | null
  template_id?: string | null
  status: OutboxStatus
  scheduled_for?: string | null
}

export async function saveOutboxMessage(input: OutboxInput): Promise<string> {
  const { data, error } = await supabase
    .from('outbox_messages')
    .insert({
      owner_id: input.owner_id,
      org_id: input.org_id ?? null,
      contact_tipo: input.contact_tipo ?? null,
      contact_id: input.contact_id ?? null,
      canal: input.canal,
      destinatario: input.destinatario ?? null,
      asunto: input.asunto ?? null,
      mensaje: input.mensaje,
      mensaje_resuelto: input.mensaje_resuelto ?? null,
      template_id: input.template_id ?? null,
      status: input.status,
      scheduled_for: input.scheduled_for ?? null,
      sent_at: input.status === 'enviado' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

export async function markOutboxSent(id: string): Promise<void> {
  const { error } = await supabase
    .from('outbox_messages')
    .update({ status: 'enviado', sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function markOutboxFailed(id: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('outbox_messages')
    .update({ status: 'fallido', failed_at: new Date().toISOString(), error_message: errorMessage })
    .eq('id', id)
  if (error) throw error
}
