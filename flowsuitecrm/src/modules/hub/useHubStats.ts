import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useViewMode } from '../../data/useViewMode'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'

type HubMetrics = {
  leadsNew: number
  citasToday: number
  tareasPending: number
}

type HubScope = {
  pending: boolean
  kind: 'none' | 'global' | 'self' | 'distribution'
  userId: string | null
  userIds: string[]
}

const defaultMetrics: HubMetrics = {
  leadsNew: 0,
  citasToday: 0,
  tareasPending: 0,
}

const resolveHubScope = ({
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
}): HubScope => {
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

  return { pending: false, kind: 'global', userId, userIds: [] }
}

export function useHubStats() {
  const [metrics, setMetrics] = useState(defaultMetrics)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const configured = isSupabaseConfigured
  const { viewMode, hasDistribuidorScope, distributionUserIds, distributionLoading } = useViewMode()
  const { session, loading: authLoading } = useAuth()
  const { currentRole, loading: usersLoading } = useUsers()

  const scope = useMemo(
    () => resolveHubScope({
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

  useEffect(() => {
    if (!configured) {
      setMetrics(defaultMetrics)
      setError(null)
      setLoading(false)
      return
    }

    if (scope.pending) {
      setLoading(true)
      return
    }

    if (scope.kind === 'none') {
      setMetrics(defaultMetrics)
      setError(null)
      setLoading(false)
      return
    }

    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const today = new Date()
        const start = new Date(today)
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(end.getDate() + 1)

        const startDate = start.toLocaleDateString('en-CA')
        const endDate = end.toLocaleDateString('en-CA')
        const startLocalDateTime = `${startDate}T00:00:00`
        const endLocalDateTime = `${endDate}T00:00:00`

        let leadsQuery = supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('estado_pipeline', 'nuevo')
          .is('deleted_at', null)

        let citasQuery = supabase
          .from('citas')
          .select('id', { count: 'exact', head: true })
          .gte('start_at', startLocalDateTime)
          .lt('start_at', endLocalDateTime)

        let tareasQuery = supabase
          .from('crm_tareas')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente')
          .lte('fecha_vencimiento', endDate)

        if (scope.kind === 'self' && scope.userId) {
          leadsQuery = leadsQuery.or(`vendedor_id.eq.${scope.userId},and(vendedor_id.is.null,owner_id.eq.${scope.userId})`)
          citasQuery = citasQuery.or(`owner_id.eq.${scope.userId},assigned_to.eq.${scope.userId}`)
          tareasQuery = tareasQuery.eq('asignado_a', scope.userId)
        } else if (scope.kind === 'distribution') {
          const ids = scope.userIds.join(',')
          leadsQuery = leadsQuery.or(`owner_id.in.(${ids}),vendedor_id.in.(${ids})`)
          citasQuery = citasQuery.or(`owner_id.in.(${ids}),assigned_to.in.(${ids})`)
          tareasQuery = tareasQuery.in('asignado_a', scope.userIds)
        }

        const [leadsRes, citasRes, tareasRes] = await Promise.all([
          leadsQuery,
          citasQuery,
          tareasQuery,
        ])

        const firstError = leadsRes.error || citasRes.error || tareasRes.error
        if (firstError) {
          throw new Error(firstError.message ?? 'Error loading hub stats')
        }

        if (!active) return

        setMetrics({
          leadsNew: leadsRes.count ?? 0,
          citasToday: citasRes.count ?? 0,
          tareasPending: tareasRes.count ?? 0,
        })
      } catch (nextError) {
        if (!active) return
        setMetrics(defaultMetrics)
        setError(nextError instanceof Error ? nextError.message : 'Error loading hub stats')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [configured, scope])

  return {
    metrics,
    loading,
    error,
    configured,
    scopePending: scope.pending,
  }
}
