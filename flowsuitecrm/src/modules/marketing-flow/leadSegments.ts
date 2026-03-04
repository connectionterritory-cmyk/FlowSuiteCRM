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

export type SegmentKey = 'nuevos' | 'vencidos' | 'cita' | 'sin_contacto' | 'descartados'

export const SEGMENTS: { key: SegmentKey; label: string; hint?: string }[] = [
  { key: 'nuevos', label: 'Leads nuevos' },
  { key: 'vencidos', label: 'Leads vencidos', hint: 'next_action_date <= hoy' },
  { key: 'cita', label: 'Leads con cita' },
  { key: 'sin_contacto', label: 'Leads sin contacto 7 dias' },
  { key: 'descartados', label: 'Leads descartados' },
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

export const fetchLeadsForSegment = async (segment: SegmentKey, scope: LeadScope) => {
  if (!isSupabaseConfigured) return [] as LeadRow[]
  const todayKey = new Date().toISOString().split('T')[0]
  let query = supabase.from('leads').select(LEAD_SELECT).is('deleted_at', null)
  query = applyLeadScope(query, scope)

  if (segment === 'nuevos') {
    query = query.eq('estado_pipeline', 'nuevo')
  }
  if (segment === 'vencidos') {
    query = query.not('next_action_date', 'is', null).lte('next_action_date', todayKey)
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
