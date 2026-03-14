import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useViewMode } from '../data/ViewModeProvider'
import { useAuth } from '../auth/AuthProvider'
import { useUsers } from '../data/UsersProvider'

export type ConversionRange = 'hoy' | 'semana' | 'mes'

type ConversionKpis = {
  period: { start: string; end: string }
  previous: { start: string; end: string }
  citas: {
    programadas: number
    completadas: number
    no_show: number
    tasa_asistencia: number
  }
  conversion: {
    ventas: number
    realizadas: number
    tasa_conversion: number
    demo_venta: number
  }
  ventas: {
    monto: number
    count: number
    ticket_promedio: number
  }
  prev: {
    citas_programadas: number
    citas_completadas: number
    citas_no_show: number
    conversion_ventas: number
    conversion_realizadas: number
    conversion_demo_venta: number
    ventas_monto: number
    ventas_count: number
  }
}

type DashboardScope = {
  pending: boolean
  kind: 'none' | 'global' | 'self' | 'distribution'
  userId: string | null
  userIds: string[]
}

const emptyKpis: ConversionKpis = {
  period: { start: '', end: '' },
  previous: { start: '', end: '' },
  citas: { programadas: 0, completadas: 0, no_show: 0, tasa_asistencia: 0 },
  conversion: { ventas: 0, realizadas: 0, tasa_conversion: 0, demo_venta: 0 },
  ventas: { monto: 0, count: 0, ticket_promedio: 0 },
  prev: {
    citas_programadas: 0,
    citas_completadas: 0,
    citas_no_show: 0,
    conversion_ventas: 0,
    conversion_realizadas: 0,
    conversion_demo_venta: 0,
    ventas_monto: 0,
    ventas_count: 0,
  },
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

  return { pending: false, kind: 'global', userId, userIds: [] }
}

export function useConversionKpis(range: ConversionRange) {
  const [data, setData] = useState<ConversionKpis>(emptyKpis)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const configured = isSupabaseConfigured
  const { viewMode, hasDistribuidorScope, distributionUserIds, distributionLoading } = useViewMode()
  const { session, loading: authLoading } = useAuth()
  const { currentRole, loading: usersLoading } = useUsers()

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

  const scopedUserIds = useMemo(() => {
    if (scope.kind === 'self' || scope.kind === 'distribution') {
      return scope.userIds
    }
    if (scope.kind === 'global') {
      return null
    }
    return []
  }, [scope.kind, scope.userIds])

  useEffect(() => {
    if (!configured) {
      setError(null)
      setData(emptyKpis)
      setLoading(false)
      return
    }

    if (scope.pending) {
      setLoading(true)
      return
    }

    if (scope.kind === 'none') {
      setError(null)
      setData(emptyKpis)
      setLoading(false)
      return
    }

    let active = true

    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        const { data: response, error: rpcError } = await supabase.rpc('get_conversion_kpis', {
          p_user_ids: scope.kind === 'global' ? null : scopedUserIds,
          p_range: range,
        })

        if (rpcError) {
          throw new Error(rpcError.message)
        }

        if (!active) return
        setData((response as ConversionKpis) ?? emptyKpis)
      } catch (nextError) {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : 'Error loading conversion KPIs')
        setData(emptyKpis)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void run()

    return () => {
      active = false
    }
  }, [configured, range, scope, scopedUserIds])

  return { data, loading, configured, error, scopePending: scope.pending }
}
