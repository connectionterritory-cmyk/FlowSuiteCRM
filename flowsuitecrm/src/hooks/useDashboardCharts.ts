import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useViewMode } from '../data/ViewModeProvider'
import { useAuth } from '../auth/AuthProvider'
import { useUsers } from '../data/UsersProvider'

type SalesPoint = {
  label: string
  key: string
  value: number
}

type PipelineSlice = {
  key: string
  label: string
  value: number
  color: string
}

type DashboardScope = {
  pending: boolean
  kind: 'none' | 'global' | 'self' | 'distribution'
  userId: string | null
  userIds: string[]
}

const stageColors: Record<string, string> = {
  nuevo: '#60a5fa',
  contactado: '#3b82f6',
  cita: '#2563eb',
  demo: '#1d4ed8',
  cierre: '#1e40af',
  descartado: '#9ca3af',
}

const resolveDashboardScope = ({
  configured,
  authLoading,
  userId,
  usersLoading,
  currentRole,
  hasDistribuidorScope,
  viewMode,
  distributionLoading,
  distributionUserIds,
}: {
  configured: boolean
  authLoading: boolean
  userId: string | null
  usersLoading: boolean
  currentRole: string | null
  hasDistribuidorScope: boolean
  viewMode: 'seller' | 'distributor'
  distributionLoading: boolean
  distributionUserIds: string[]
}): DashboardScope => {
  if (!configured) {
    return { pending: false, kind: 'none', userId: null, userIds: [] }
  }

  if (authLoading) {
    return { pending: true, kind: 'none', userId: null, userIds: [] }
  }

  if (!userId) {
    return { pending: false, kind: 'none', userId: null, userIds: [] }
  }

  if (usersLoading) {
    return { pending: true, kind: 'none', userId, userIds: [] }
  }

  if (currentRole === 'vendedor' || (hasDistribuidorScope && viewMode === 'seller')) {
    return { pending: false, kind: 'self', userId, userIds: [userId] }
  }

  if (hasDistribuidorScope && viewMode === 'distributor') {
    if (distributionLoading || distributionUserIds.length === 0) {
      return { pending: true, kind: 'distribution', userId, userIds: [] }
    }

    return {
      pending: false,
      kind: 'distribution',
      userId,
      userIds: distributionUserIds,
    }
  }

  if (!currentRole) {
    return { pending: false, kind: 'self', userId, userIds: [userId] }
  }

  return { pending: false, kind: 'global', userId: userId, userIds: [] }
}

export function useDashboardCharts() {
  const { t, i18n } = useTranslation()
  const configured = isSupabaseConfigured
  const { viewMode, hasDistribuidorScope, distributionUserIds, distributionLoading } = useViewMode()
  const { session, loading: authLoading } = useAuth()
  const { currentRole, loading: usersLoading } = useUsers()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const scope = useMemo(
    () => resolveDashboardScope({
      configured,
      authLoading,
      userId: session?.user.id ?? null,
      usersLoading,
      currentRole,
      hasDistribuidorScope,
      viewMode,
      distributionLoading,
      distributionUserIds,
    }),
    [
      configured,
      authLoading,
      session?.user.id,
      usersLoading,
      currentRole,
      hasDistribuidorScope,
      viewMode,
      distributionLoading,
      distributionUserIds,
    ],
  )

  const months = useMemo(() => {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short' })
    const result: SalesPoint[] = []

    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const label = `${formatter.format(date)} ${String(date.getFullYear()).slice(-2)}`
      result.push({ key, label, value: 0 })
    }
    return result
  }, [i18n.language])

  const basePipelineSeries = useMemo<PipelineSlice[]>(
    () => ['nuevo', 'contactado', 'cita', 'demo', 'cierre', 'descartado'].map((stage) => ({
      key: stage,
      label: t(`pipeline.columns.${stage}`),
      value: 0,
      color: stageColors[stage],
    })),
    [t],
  )

  const [salesSeries, setSalesSeries] = useState<SalesPoint[]>(months)
  const [pipelineSeries, setPipelineSeries] = useState<PipelineSlice[]>(basePipelineSeries)

  useEffect(() => {
    setSalesSeries((current) => {
      const valuesByKey = new Map(current.map((point) => [point.key, point.value]))
      return months.map((month) => ({
        ...month,
        value: valuesByKey.get(month.key) ?? 0,
      }))
    })
  }, [months])

  useEffect(() => {
    setPipelineSeries((current) => {
      const valuesByKey = new Map(current.map((slice) => [slice.key, slice.value]))
      return basePipelineSeries.map((slice) => ({
        ...slice,
        value: valuesByKey.get(slice.key) ?? 0,
      }))
    })
  }, [basePipelineSeries])

  useEffect(() => {
    if (!configured) {
      setError(null)
      setSalesSeries(months)
      setPipelineSeries(basePipelineSeries)
      setLoading(false)
      return
    }

    if (scope.pending) {
      setLoading(true)
      return
    }

    if (scope.kind === 'none') {
      setError(null)
      setSalesSeries(months)
      setPipelineSeries(basePipelineSeries)
      setLoading(false)
      return
    }

    let active = true

    const fetchCharts = async () => {
      setLoading(true)
      setError(null)

      try {
        const startDate = new Date()
        startDate.setMonth(startDate.getMonth() - 11)
        startDate.setDate(1)

        let ventasQuery = supabase
          .from('ventas')
          .select('fecha_venta, monto, vendedor_id')
          .gte('fecha_venta', startDate.toISOString().slice(0, 10))

        let leadsQuery = supabase.from('leads').select('estado_pipeline, owner_id, vendedor_id')

        if (scope.kind === 'self' && scope.userId) {
          ventasQuery = ventasQuery.eq('vendedor_id', scope.userId)
          leadsQuery = leadsQuery.or(`owner_id.eq.${scope.userId},vendedor_id.eq.${scope.userId}`)
        } else if (scope.kind === 'distribution') {
          const ids = scope.userIds.join(',')
          ventasQuery = ventasQuery.in('vendedor_id', scope.userIds)
          leadsQuery = leadsQuery.or(`owner_id.in.(${ids}),vendedor_id.in.(${ids})`)
        }

        const [ventasResult, leadsResult] = await Promise.all([ventasQuery, leadsQuery])
        const fetchError = ventasResult.error || leadsResult.error
        if (fetchError) {
          throw new Error(fetchError.message ?? 'Error loading dashboard charts')
        }

        const totals = new Map<string, number>()
        ;(((ventasResult.data as { fecha_venta: string | null; monto: number | null }[] | null) ?? [])).forEach((row) => {
          const fecha = row.fecha_venta
          if (!fecha) return
          const key = fecha.slice(0, 7)
          const current = totals.get(key) ?? 0
          totals.set(key, current + (row.monto ?? 0))
        })

        const stageTotals: Record<string, number> = {
          nuevo: 0,
          contactado: 0,
          cita: 0,
          demo: 0,
          cierre: 0,
          descartado: 0,
        }

        ;(((leadsResult.data as { estado_pipeline?: string | null }[] | null) ?? [])).forEach((row) => {
          let stage = row.estado_pipeline ?? 'nuevo'
          if (stage === 'calificado') stage = 'cita'
          if (stage === 'demostracion') stage = 'demo'
          if (stageTotals[stage] === undefined) return
          stageTotals[stage] += 1
        })

        if (!active) return

        setSalesSeries(
          months.map((month) => ({
            ...month,
            value: totals.get(month.key) ?? 0,
          })),
        )

        setPipelineSeries(
          basePipelineSeries.map((slice) => ({
            ...slice,
            value: stageTotals[slice.key] ?? 0,
          })),
        )
      } catch (nextError) {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : 'Error loading dashboard charts')
        setSalesSeries(months)
        setPipelineSeries(basePipelineSeries)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void fetchCharts()

    return () => {
      active = false
    }
  }, [basePipelineSeries, configured, months, scope])

  return { salesSeries, pipelineSeries, loading, configured, error, scopePending: scope.pending }
}
