import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'

export type LeadRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  estado_pipeline: string | null
  next_action: string | null
  next_action_date: string | null
  updated_at: string | null
  created_at: string | null
}

type LastActivityRow = {
  lead_id: string
  last_activity_at: string | null
}

export type SegmentKey = 'nuevos' | 'contactado' | 'vencidos' | 'cita' | 'sin_contacto' | 'descartados'

export const SEGMENTS: { key: SegmentKey; label: string; hint?: string }[] = [
  { key: 'nuevos', label: 'Nuevo' },
  { key: 'contactado', label: 'Contactado' },
  { key: 'cita', label: 'Con cita agendada' },
  { key: 'sin_contacto', label: 'Sin contacto reciente', hint: 'Sin actividad en 7 días' },
  { key: 'vencidos', label: 'Con acción vencida', hint: 'next_action_date <= hoy' },
  { key: 'descartados', label: 'Descartado' },
]

export const LEAD_SELECT =
  'id, nombre, apellido, telefono, estado_pipeline, next_action, next_action_date, updated_at, created_at'

export type LeadScope = {
  role: string | null
  viewMode: 'seller' | 'distributor'
  hasDistribuidorScope: boolean
  distributionUserIds: string[]
  userId: string | null
}

export type LeadSegmentParams = {
  fuente?: string
  segmento_key?: string
  estado_pipeline?: string | null
  filter_type?: string | null
  programa_id?: string | null
  owner_id?: string | null
  vendedor_id?: string | null
}

const normalizeFuenteValue = (value: string) => value.trim().toLowerCase()

const fetchLeadFuenteValues = async (fuente: string) => {
  if (!isSupabaseConfigured) return { values: [] as string[], error: null as string | null }
  const normalized = normalizeFuenteValue(fuente)
  if (!normalized) return { values: [] as string[], error: null as string | null }
  const { data, error } = await supabase
    .from('v_lead_fuentes')
    .select('fuente_raw')
    .eq('fuente_norm', normalized)
  if (error) return { values: [] as string[], error: error.message }
  const values = (data as { fuente_raw: string | null }[] | null)
    ?.map((row) => (row.fuente_raw ?? '').trim())
    .filter(Boolean) ?? []
  return { values: Array.from(new Set(values)), error: null as string | null }
}

const applyLeadScope = (query: any, scope: LeadScope) => {
  if (scope.role === 'telemercadeo') {
    return query.eq('estado_pipeline', 'nuevo')
  }
  if ((scope.role === 'vendedor' || (scope.hasDistribuidorScope && scope.viewMode === 'seller')) && scope.userId) {
    return query.or(`vendedor_id.eq.${scope.userId},and(vendedor_id.is.null,owner_id.eq.${scope.userId})`)
  }
  if (scope.hasDistribuidorScope && scope.viewMode === 'distributor' && scope.distributionUserIds.length > 0) {
    const ids = scope.distributionUserIds.join(',')
    return query.or(`owner_id.in.(${ids}),vendedor_id.in.(${ids})`)
  }
  return query
}

const fetchLastActivityMap = async (leadIds: string[]) => {
  if (!isSupabaseConfigured || leadIds.length === 0) return {}
  const { data } = await supabase
    .from('v_lead_last_activity')
    .select('lead_id, last_activity_at')
    .in('lead_id', leadIds)
  const map: Record<string, string | null> = {}
  ;(data as LastActivityRow[] | null)?.forEach((row) => {
    map[row.lead_id] = row.last_activity_at
  })
  return map
}

const filterNoContact = async (rows: LeadRow[]) => {
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - 7)
  const leadIds = rows.map((lead) => lead.id)
  const activityMap = await fetchLastActivityMap(leadIds)
  return rows.filter((lead) => {
    const last = activityMap[lead.id] || lead.updated_at || lead.created_at
    if (!last) return true
    return new Date(last).getTime() <= cutoff.getTime()
  })
}

const applyLeadParams = async (
  query: any,
  segmentParams?: LeadSegmentParams,
) => {
  let nextQuery: any = query
  if (segmentParams?.programa_id) {
    nextQuery = nextQuery.eq('programa_id', segmentParams.programa_id)
  }
  if (segmentParams?.owner_id) {
    nextQuery = nextQuery.eq('owner_id', segmentParams.owner_id)
  }
  if (segmentParams?.vendedor_id) {
    nextQuery = nextQuery.eq('vendedor_id', segmentParams.vendedor_id)
  }
  if (segmentParams?.fuente && segmentParams.fuente !== 'all') {
    const { values, error } = await fetchLeadFuenteValues(segmentParams.fuente)
    if (error) return { query: nextQuery, skip: false, error }
    if (values.length === 0) return { query: nextQuery, skip: true }
    nextQuery = nextQuery.in('fuente', values)
  }
  return { query: nextQuery, skip: false, error: null as string | null }
}

export const fetchLeadsForSegment = async (segment: SegmentKey, scope: LeadScope, segmentParams?: LeadSegmentParams) => {
  if (!isSupabaseConfigured) return [] as LeadRow[]
  const todayKey = new Date().toISOString().split('T')[0]
  let query: any = supabase
    .from('leads')
    .select(LEAD_SELECT)
    .is('deleted_at', null)
    .not('telefono', 'is', null)
    .neq('telefono', '')
  query = applyLeadScope(query, scope)

  const paramResult = await applyLeadParams(query, segmentParams)
  if (paramResult.error) {
    console.error('Lead segment params error', { error: paramResult.error, segment, segmentParams })
    return []
  }
  if (paramResult.skip) return []
  query = paramResult.query

  if (segment === 'nuevos') {
    query = query.eq('estado_pipeline', 'nuevo')
  }
  if (segment === 'vencidos') {
    query = query.not('next_action_date', 'is', null).lte('next_action_date', todayKey)
  }
  if (segment === 'contactado') {
    query = query.eq('estado_pipeline', 'contactado')
  }
  if (segment === 'cita') {
    query = query.eq('estado_pipeline', 'cita')
  }
  if (segment === 'descartados') {
    query = query.eq('estado_pipeline', 'descartado')
  }

  const { data } = await query.order('created_at', { ascending: false })
  const rows = (data as LeadRow[] | null) ?? []
  if (segment === 'sin_contacto') {
    return await filterNoContact(rows)
  }
  return rows
}

export const countLeadsForSegment = async (
  segment: SegmentKey,
  scope: LeadScope,
  segmentParams?: LeadSegmentParams,
) => {
  if (!isSupabaseConfigured) return { count: 0, isEstimate: false }
  const todayKey = new Date().toISOString().split('T')[0]
  if (segment !== 'sin_contacto') {
    let countQuery: any = supabase
      .from('leads')
      .select('id', { count: 'exact' })
      .is('deleted_at', null)
      .not('telefono', 'is', null)
      .neq('telefono', '')
    countQuery = applyLeadScope(countQuery, scope)
    const paramResult = await applyLeadParams(countQuery, segmentParams)
    if (paramResult.error) return { count: 0, isEstimate: false, error: paramResult.error }
    if (paramResult.skip) return { count: 0, isEstimate: false }
    countQuery = paramResult.query.limit(1)
    if (segment === 'nuevos') {
      countQuery = countQuery.eq('estado_pipeline', 'nuevo')
    }
    if (segment === 'vencidos') {
      countQuery = countQuery.not('next_action_date', 'is', null).lte('next_action_date', todayKey)
    }
    if (segment === 'contactado') {
      countQuery = countQuery.eq('estado_pipeline', 'contactado')
    }
    if (segment === 'cita') {
      countQuery = countQuery.eq('estado_pipeline', 'cita')
    }
    if (segment === 'descartados') {
      countQuery = countQuery.eq('estado_pipeline', 'descartado')
    }
    const { count, error } = await countQuery
    if (error) return { count: 0, isEstimate: false, error: error.message }
    return { count: count ?? 0, isEstimate: false }
  }

  const MAX_SAMPLE = 2000
  let sampleQuery: any = supabase
    .from('leads')
    .select('id, updated_at, created_at', { count: 'exact' })
    .is('deleted_at', null)
    .not('telefono', 'is', null)
    .neq('telefono', '')
  sampleQuery = applyLeadScope(sampleQuery, scope)
  const sampleParams = await applyLeadParams(sampleQuery, segmentParams)
  if (sampleParams.error) return { count: 0, isEstimate: false, error: sampleParams.error }
  if (sampleParams.skip) return { count: 0, isEstimate: false }
  sampleQuery = sampleParams.query
  const { data, count, error } = await sampleQuery.limit(MAX_SAMPLE)
  if (error) return { count: 0, isEstimate: false, error: error.message }
  const rows = (data as LeadRow[] | null) ?? []
  const filtered = await filterNoContact(rows)
  const total = count ?? rows.length
  if (total > MAX_SAMPLE && rows.length > 0) {
    const ratio = filtered.length / rows.length
    return { count: Math.round(total * ratio), isEstimate: true }
  }
  return { count: filtered.length, isEstimate: false }
}
