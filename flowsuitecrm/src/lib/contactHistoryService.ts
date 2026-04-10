import { supabase } from './supabase/client'
import type { MessagingChannel } from '../types/messaging'

export type HistoryEntry = {
  id: string
  canal: MessagingChannel | string
  tipo_mensaje: string | null
  mensaje: string | null
  contenido: string | null   // notasrp summary
  enviado_en: string | null
  created_at: string
  source: 'cliente' | 'lead'
}

const HISTORY_LIMIT = 8

// Fetch from notasrp (cliente)
async function fetchClienteHistory(clienteId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from('notasrp')
    .select('id, canal, tipo_mensaje, mensaje, contenido, enviado_en, created_at')
    .eq('cliente_id', clienteId)
    .not('canal', 'is', null)
    .order('enviado_en', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (error) return []
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    canal: (row.canal as string) ?? 'whatsapp',
    tipo_mensaje: (row.tipo_mensaje as string | null) ?? null,
    mensaje: (row.mensaje as string | null) ?? null,
    contenido: (row.contenido as string | null) ?? null,
    enviado_en: (row.enviado_en as string | null) ?? null,
    created_at: row.created_at as string,
    source: 'cliente' as const,
  }))
}

// Fetch from lead_notas (lead)
async function fetchLeadHistory(leadId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from('lead_notas')
    .select('id, canal, tipo_mensaje, mensaje, nota, created_at')
    .eq('lead_id', leadId)
    .not('canal', 'is', null)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (error) return []
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    canal: (row.canal as string) ?? 'whatsapp',
    tipo_mensaje: (row.tipo_mensaje as string | null) ?? null,
    mensaje: (row.mensaje as string | null) ?? null,
    contenido: (row.nota as string | null) ?? null,
    enviado_en: null,
    created_at: row.created_at as string,
    source: 'lead' as const,
  }))
}

export async function fetchContactHistory(
  clienteId: string | null | undefined,
  leadId: string | null | undefined
): Promise<HistoryEntry[]> {
  if (clienteId) {
    return fetchClienteHistory(clienteId)
  }
  if (leadId) {
    return fetchLeadHistory(leadId)
  }
  return []
}

// Helpers for display
export const CANAL_ICON: Record<string, string> = {
  whatsapp: '💬',
  sms: '📱',
  email: '✉️',
  telegram: '📩',
}

export function formatHistoryDate(isoDate: string | null): string {
  if (!isoDate) return ''
  const d = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'Hoy'
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) return `Hace ${diffDays}d`
  if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)}sem`
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}
