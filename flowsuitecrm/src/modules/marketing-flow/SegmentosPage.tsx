import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeader } from '../../components/SectionHeader'
import { StatCard } from '../../components/StatCard'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Badge } from '../../components/Badge'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { fetchLeadsForSegment, SEGMENTS, type LeadRow, type SegmentKey } from './leadSegments'

const SEGMENT_KEYS = SEGMENTS.map((segment) => segment.key)

export function SegmentosPage() {
  const { session } = useAuth()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<SegmentKey, number>>({
    nuevos: 0,
    vencidos: 0,
    cita: 0,
    sin_contacto: 0,
    descartados: 0,
  })
  const [selectedSegment, setSelectedSegment] = useState<SegmentKey>('nuevos')
  const [leads, setLeads] = useState<LeadRow[]>([])

  const loadRole = useCallback(async () => {
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    const { data } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .maybeSingle()
    setRole((data as { rol?: string } | null)?.rol ?? null)
  }, [configured, session?.user.id])

  const scope = useMemo(() => ({
    role,
    viewMode,
    hasDistribuidorScope,
    distributionUserIds,
    userId: session?.user.id ?? null,
  }), [distributionUserIds, hasDistribuidorScope, role, session?.user.id, viewMode])

  const loadCounts = useCallback(async () => {
    if (!configured) return
    const nextCounts: Record<SegmentKey, number> = {
      nuevos: 0,
      vencidos: 0,
      cita: 0,
      sin_contacto: 0,
      descartados: 0,
    }
    for (const segment of SEGMENT_KEYS) {
      const rows = await fetchLeadsForSegment(segment, scope)
      nextCounts[segment] = rows.length
    }
    setCounts(nextCounts)
  }, [configured, scope])

  const loadSelected = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const rows = await fetchLeadsForSegment(selectedSegment, scope)
    setLeads(rows)
    setLoading(false)
  }, [configured, scope, selectedSegment])

  useEffect(() => {
    if (configured) loadRole()
  }, [configured, loadRole])

  useEffect(() => {
    loadCounts()
  }, [loadCounts, role])

  useEffect(() => {
    loadSelected()
  }, [loadSelected, role])

  const rows = useMemo<DataTableRow[]>(() => {
    return leads.map((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
      const estado = lead.estado_pipeline ?? '-'
      return {
        id: lead.id,
        cells: [
          fullName,
          lead.telefono ?? '-',
          <Badge key={`${lead.id}-estado`} label={estado} />,
          lead.next_action ?? '-',
          lead.next_action_date ?? '-',
        ],
      }
    })
  }, [leads])

  return (
    <div className="page-stack">
      <SectionHeader title="Segmentos" subtitle="Leads (fase 1)" />

      <div className="stat-grid">
        {SEGMENTS.map((segment, index) => (
          <StatCard
            key={segment.key}
            label={segment.label}
            value={String(counts[segment.key] ?? 0)}
            hint={segment.hint}
            accent={index % 2 === 0 ? 'blue' : 'gold'}
            onClick={() => setSelectedSegment(segment.key)}
          />
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      <DataTable
        columns={['Nombre', 'Telefono', 'Estado', 'Proxima accion', 'Fecha']}
        rows={rows}
        emptyLabel={loading ? 'Cargando...' : 'Sin resultados'}
      />
    </div>
  )
}
