import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { SEGMENTS, type SegmentKey, fetchLeadsForSegment, countLeadsForSegment, type LeadScope, type LeadSegmentParams } from './leadSegments'

export type Fuente = 'leads' | 'clientes'

export type SegmentDefinition = {
  key: string
  label: string
  fuente: Fuente
  hint?: string
}

export type SegmentTarget = {
  id: string
  nombre: string | null
  telefono: string | null
  ciudad?: string | null
}

export type CampaignSegmentParams = {
  contacto_tipo: 'lead' | 'cliente'
  fuente?: string
  segmento_key?: string
  estado_pipeline?: string | null
  filter_type?: string | null
  programa_id?: string | null
  owner_id?: string | null
  vendedor_id?: string | null
  distribuidor_id?: string | null
  month?: number
}

export const LEAD_SEGMENTS: SegmentDefinition[] = SEGMENTS.map((segment) => ({
  key: segment.key,
  label: segment.label,
  hint: segment.hint,
  fuente: 'leads',
}))

export const CLIENTE_SEGMENTS: SegmentDefinition[] = [
  { key: 'clientes_activos', label: 'Clientes activos', fuente: 'clientes', hint: 'Activo = true' },
  { key: 'clientes_accion_vencida', label: 'Clientes con próxima acción vencida', fuente: 'clientes', hint: 'next_action_date <= hoy' },
  { key: 'clientes_sin_contacto', label: 'Clientes sin contacto reciente', fuente: 'clientes', hint: 'ultimo_contacto_at nulo o > 30 días' },
  { key: 'cumpleanos_clientes', label: 'Cumpleaños del mes', fuente: 'clientes', hint: 'Mes actual' },
]

export const ALL_SEGMENTS: SegmentDefinition[] = [...LEAD_SEGMENTS, ...CLIENTE_SEGMENTS]

export const getSegmentsByFuente = (fuente: Fuente) =>
  ALL_SEGMENTS.filter((segment) => segment.fuente === fuente)

const mapLeadTargets = (rows: { id: string; nombre: string | null; apellido: string | null; telefono: string | null }[]) =>
  rows.map((row) => ({
    id: row.id,
    nombre: [row.nombre, row.apellido].filter(Boolean).join(' ') || row.nombre || null,
    telefono: row.telefono ?? null,
  }))

const parseMonth = (value: string | null) => {
  if (!value) return null
  const parts = value.split('-')
  if (parts.length >= 2) {
    const month = Number(parts[1])
    if (Number.isFinite(month) && month >= 1 && month <= 12) return month
  } else {
    const slashParts = value.split('/')
    if (slashParts.length >= 2) {
      if (parseInt(slashParts[0], 10) > 12) {
        return parseInt(slashParts[1], 10)
      } else {
        return parseInt(slashParts[0], 10)
      }
    }
  }
  return null
}

export const fetchSegmentTargets = async (params: {
  fuente: Fuente
  segmentKey: string
  scope: LeadScope
  segmentParams?: CampaignSegmentParams
}): Promise<SegmentTarget[]> => {
  if (!isSupabaseConfigured) return []
  const { fuente, segmentKey, scope, segmentParams } = params

  if (fuente === 'leads') {
    const leadParams = segmentParams as LeadSegmentParams | undefined
    const rows = await fetchLeadsForSegment(segmentKey as SegmentKey, scope, leadParams)
    return mapLeadTargets(rows)
  }

  const todayKey = new Date().toISOString().split('T')[0]
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffKey = cutoff.toISOString().split('T')[0]

  let query: any = supabase
    .from('clientes')
    .select('id, nombre, apellido, telefono, ciudad, fecha_nacimiento, ultimo_contacto_at, next_action_date, activo, vendedor_id, distribuidor_id')
    .not('telefono', 'is', null)
    .neq('telefono', '')

  if (segmentParams?.vendedor_id) {
    query = query.eq('vendedor_id', segmentParams.vendedor_id)
  }
  if (segmentParams?.distribuidor_id) {
    query = query.eq('distribuidor_id', segmentParams.distribuidor_id)
  }

  if (segmentKey === 'clientes_activos') {
    query = query.eq('activo', true)
  }
  if (segmentKey === 'clientes_accion_vencida') {
    query = query.not('next_action_date', 'is', null).lte('next_action_date', todayKey)
  }
  if (segmentKey === 'clientes_sin_contacto') {
    query = query.or(`ultimo_contacto_at.is.null,ultimo_contacto_at.lte.${cutoffKey}`)
  }
  if (segmentKey === 'cumpleanos_clientes') {
    query = query.not('fecha_nacimiento', 'is', null)
  }

  const { data } = await query.order('created_at', { ascending: false })
  const rows = (data as { id: string; nombre: string | null; apellido: string | null; telefono: string | null; ciudad: string | null; fecha_nacimiento: string | null }[] | null) ?? []
  if (segmentKey === 'cumpleanos_clientes') {
    const monthParam = segmentParams?.month
    const nowMonth = new Date().getUTCMonth() + 1
    const month = monthParam && monthParam >= 1 && monthParam <= 12 ? monthParam : nowMonth
    return rows
      .filter((row) => parseMonth(row.fecha_nacimiento) === month)
      .map((row) => ({
        id: row.id,
        nombre: [row.nombre, row.apellido].filter(Boolean).join(' ') || row.nombre || null,
        telefono: row.telefono ?? null,
        ciudad: row.ciudad ?? null,
      }))
  }
  return rows.map((row) => ({
    id: row.id,
    nombre: [row.nombre, row.apellido].filter(Boolean).join(' ') || row.nombre || null,
    telefono: row.telefono ?? null,
    ciudad: row.ciudad ?? null,
  }))
}

export const estimateSegmentTargets = async (params: {
  fuente: Fuente
  segmentKey: string
  scope: LeadScope
  segmentParams?: CampaignSegmentParams
}) => {
  if (!isSupabaseConfigured) return { count: 0, isEstimate: false }
  const { fuente, segmentKey, scope, segmentParams } = params
  if (fuente === 'leads') {
    const leadParams = segmentParams as LeadSegmentParams | undefined
    return await countLeadsForSegment(segmentKey as SegmentKey, scope, leadParams)
  }

  const todayKey = new Date().toISOString().split('T')[0]
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffKey = cutoff.toISOString().split('T')[0]
  let query: any = supabase
    .from('clientes')
    .select('id, fecha_nacimiento, ultimo_contacto_at, next_action_date, activo, vendedor_id, distribuidor_id', { count: 'exact' })
    .not('telefono', 'is', null)
    .neq('telefono', '')

  if (segmentParams?.vendedor_id) {
    query = query.eq('vendedor_id', segmentParams.vendedor_id)
  }
  if (segmentParams?.distribuidor_id) {
    query = query.eq('distribuidor_id', segmentParams.distribuidor_id)
  }

  if (segmentKey === 'clientes_activos') {
    query = query.eq('activo', true)
  }
  if (segmentKey === 'clientes_accion_vencida') {
    query = query.not('next_action_date', 'is', null).lte('next_action_date', todayKey)
  }
  if (segmentKey === 'clientes_sin_contacto') {
    query = query.or(`ultimo_contacto_at.is.null,ultimo_contacto_at.lte.${cutoffKey}`)
  }

  const MAX_SAMPLE = 2000
  if (segmentKey !== 'cumpleanos_clientes') {
    const { count, error } = await query.select('id', { count: 'exact' }).limit(1)
    if (error) return { count: 0, isEstimate: false, error: error.message }
    return { count: count ?? 0, isEstimate: false }
  }

  const { data, count, error } = await query.limit(MAX_SAMPLE)
  if (error) return { count: 0, isEstimate: false, error: error.message }
  const rows = (data as { fecha_nacimiento: string | null }[] | null) ?? []
  const monthParam = segmentParams?.month
  const nowMonth = new Date().getUTCMonth() + 1
  const month = monthParam && monthParam >= 1 && monthParam <= 12 ? monthParam : nowMonth
  const filtered = rows.filter((row) => parseMonth(row.fecha_nacimiento) === month)
  const total = count ?? rows.length
  if (total > MAX_SAMPLE && rows.length > 0) {
    const ratio = filtered.length / rows.length
    return { count: Math.round(total * ratio), isEstimate: true }
  }
  return { count: filtered.length, isEstimate: false }
}
