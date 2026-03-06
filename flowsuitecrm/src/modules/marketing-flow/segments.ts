import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { SEGMENTS, type SegmentKey, fetchLeadsForSegment, type LeadScope } from './leadSegments'

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

export const LEAD_SEGMENTS: SegmentDefinition[] = SEGMENTS.map((segment) => ({
  key: segment.key,
  label: segment.label,
  hint: segment.hint,
  fuente: 'leads',
}))

export const CLIENTE_SEGMENTS: SegmentDefinition[] = [
  { key: 'clientes_activos', label: 'Clientes activos', fuente: 'clientes', hint: 'Con teléfono disponible' },
  { key: 'cumpleanos_clientes', label: 'Cumpleaños del mes', fuente: 'clientes', hint: 'Cumplen años en el mes elegido' },
  { key: 'clientes_miami', label: 'Clientes Miami', fuente: 'clientes' },
  { key: 'clientes_la', label: 'Clientes Los Ángeles', fuente: 'clientes' },
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

type SegmentParams = {
  month?: number
}

const parseMonth = (value: string | null) => {
  if (!value) return null
  const parts = value.split('-')
  if (parts.length < 2) return null
  const month = Number(parts[1])
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return month
}

export const fetchSegmentTargets = async (params: {
  fuente: Fuente
  segmentKey: string
  scope: LeadScope
  segmentParams?: SegmentParams
}): Promise<SegmentTarget[]> => {
  if (!isSupabaseConfigured) return []
  const { fuente, segmentKey, scope } = params

  if (fuente === 'leads') {
    const rows = await fetchLeadsForSegment(segmentKey as SegmentKey, scope)
    return mapLeadTargets(rows)
  }

  let query = supabase
    .from('clientes')
    .select('id, nombre, apellido, telefono, ciudad, fecha_nacimiento')
    .not('telefono', 'is', null)
    .neq('telefono', '')

  if (segmentKey === 'clientes_miami') {
    query = query.ilike('ciudad', '%miami%')
  }
  if (segmentKey === 'clientes_la') {
    query = query.ilike('ciudad', '%los angeles%')
  }

  if (segmentKey === 'cumpleanos_clientes') {
    query = query.not('fecha_nacimiento', 'is', null)
  }

  const { data } = await query.order('created_at', { ascending: false })
  const rows = (data as { id: string; nombre: string | null; apellido: string | null; telefono: string | null; ciudad: string | null; fecha_nacimiento: string | null }[] | null) ?? []
  if (segmentKey === 'cumpleanos_clientes') {
    const monthParam = params.segmentParams?.month
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
