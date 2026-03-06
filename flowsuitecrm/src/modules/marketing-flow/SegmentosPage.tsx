import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { StatCard } from '../../components/StatCard'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { fetchSegmentTargets, getSegmentsByFuente, type Fuente, type SegmentTarget } from './segments'

export function SegmentosPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [fuente, setFuente] = useState<Fuente>('leads')
  const [selectedSegment, setSelectedSegment] = useState<string>('nuevos')
  const [targets, setTargets] = useState<SegmentTarget[]>([])

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

  const segmentsForFuente = useMemo(
    () => getSegmentsByFuente(fuente),
    [fuente]
  )

  const loadCounts = useCallback(async () => {
    if (!configured) return
    const nextCounts: Record<string, number> = {}
    for (const segment of segmentsForFuente) {
      const rows = await fetchSegmentTargets({ fuente, segmentKey: segment.key, scope })
      nextCounts[segment.key] = rows.length
    }
    setCounts(nextCounts)
  }, [configured, fuente, scope, segmentsForFuente])

  const loadSelected = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const rows = await fetchSegmentTargets({ fuente, segmentKey: selectedSegment, scope })
    setTargets(rows)
    setLoading(false)
  }, [configured, fuente, scope, selectedSegment])

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
    return targets.map((row) => ({
      id: row.id,
      cells: [
        row.nombre ?? '-',
        row.telefono ?? '-',
        row.ciudad ?? '-',
      ],
    }))
  }, [targets])

  const hasResults = rows.length > 0

  const segmentCopy = useMemo(() => ({
    nuevos: {
      label: t('segmentos.cards.nuevos.label'),
      hint: t('segmentos.cards.nuevos.hint'),
      tooltip: t('segmentos.cards.nuevos.tooltip'),
    },
    vencidos: {
      label: t('segmentos.cards.vencidos.label'),
      hint: t('segmentos.cards.vencidos.hint'),
      tooltip: t('segmentos.cards.vencidos.tooltip'),
    },
    cita: {
      label: t('segmentos.cards.cita.label'),
      hint: t('segmentos.cards.cita.hint'),
      tooltip: t('segmentos.cards.cita.tooltip'),
    },
    sin_contacto: {
      label: t('segmentos.cards.sin_contacto.label'),
      hint: t('segmentos.cards.sin_contacto.hint'),
      tooltip: t('segmentos.cards.sin_contacto.tooltip'),
    },
    descartados: {
      label: t('segmentos.cards.descartados.label'),
      hint: t('segmentos.cards.descartados.hint'),
      tooltip: t('segmentos.cards.descartados.tooltip'),
    },
    clientes_activos: {
      label: t('segmentos.cards.clientes_activos.label'),
      hint: t('segmentos.cards.clientes_activos.hint'),
      tooltip: t('segmentos.cards.clientes_activos.tooltip'),
    },
    clientes_miami: {
      label: t('segmentos.cards.clientes_miami.label'),
      hint: t('segmentos.cards.clientes_miami.hint'),
      tooltip: t('segmentos.cards.clientes_miami.tooltip'),
    },
    clientes_la: {
      label: t('segmentos.cards.clientes_la.label'),
      hint: t('segmentos.cards.clientes_la.hint'),
      tooltip: t('segmentos.cards.clientes_la.tooltip'),
    },
  }), [t])

  const getSegmentUi = useCallback(
    (key: string, fallbackLabel: string, fallbackHint?: string) => {
      const entry = (segmentCopy as Record<string, { label: string; hint?: string; tooltip?: string }>)[key]
      return {
        label: entry?.label || fallbackLabel,
        hint: entry?.hint || fallbackHint,
        tooltip: entry?.tooltip,
      }
    },
    [segmentCopy]
  )

  return (
    <div className="page-stack">
      <SectionHeader title={t('segmentos.title')} subtitle={t('segmentos.subtitle')} />

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          type="button"
          variant={fuente === 'leads' ? 'primary' : 'ghost'}
          onClick={() => {
            setFuente('leads')
            setSelectedSegment(getSegmentsByFuente('leads')[0]?.key ?? 'nuevos')
          }}
        >
          {t('segmentos.tabs.prospectos')}
        </Button>
        <Button
          type="button"
          variant={fuente === 'clientes' ? 'primary' : 'ghost'}
          onClick={() => {
            setFuente('clientes')
            setSelectedSegment(getSegmentsByFuente('clientes')[0]?.key ?? 'clientes_activos')
          }}
        >
          {t('segmentos.tabs.clientes')}
        </Button>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>{fuente === 'leads' ? t('segmentos.sections.prospectos') : t('segmentos.sections.clientes')}</h3>
          <span style={{ opacity: 0.7, fontSize: '0.9rem' }}>
            {fuente === 'leads' ? t('segmentos.sections.prospectosHint') : t('segmentos.sections.clientesHint')}
          </span>
        </div>
        <div className="stat-grid" style={{ marginTop: '0.5rem' }}>
          {segmentsForFuente.map((segment, index) => {
            const ui = getSegmentUi(segment.key, segment.label, segment.hint)
            return (
              <StatCard
                key={segment.key}
                label={ui.label}
                value={String(counts[segment.key] ?? 0)}
                hint={ui.hint}
                tooltip={ui.tooltip}
                accent={index % 2 === 0 ? 'blue' : 'gold'}
                onClick={() => setSelectedSegment(segment.key)}
              />
            )
          })}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && <div className="card" style={{ padding: '1rem' }}>{t('segmentos.loading')}</div>}
      {!loading && !hasResults && (
        <EmptyState
          title={t('segmentos.empty.title')}
          description={t('segmentos.empty.description')}
        />
      )}
      {hasResults && (
        <DataTable
          columns={[t('segmentos.table.nombre'), t('segmentos.table.telefono'), t('segmentos.table.ciudad')]}
          rows={rows}
        />
      )}
    </div>
  )
}
