import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useViewMode } from '../data/ViewModeProvider'
import { useAuth } from '../auth/AuthProvider'
import { useUsers } from '../data/UsersProvider'

type DashboardMetrics = {
  leadsNew: number
  opportunitiesActive: number
  demos: number
  salesMonth: number
  ambassadorsSilver: number
  ambassadorsGold: number
  ambassadorsVolumeAnnual: number
  cyclesActive: number
  servicesOverdue: number
  servicesDueSoon: number
  birthdaysUpcoming: number
}

type DashboardScope = {
  pending: boolean
  kind: 'none' | 'global' | 'self' | 'distribution'
  userId: string | null
  userIds: string[]
}

type ScopedProgram = {
  id: string
  propietario_tipo: string | null
  propietario_id: string | null
}

type ScopedEquipmentRow = {
  id: string
}

type ScopedEquipmentResult = {
  ids: string[]
  error: Error | null
}

type ComponentCountResult = {
  count: number
  error: Error | null
}

const defaultMetrics: DashboardMetrics = {
  leadsNew: 0,
  opportunitiesActive: 0,
  demos: 0,
  salesMonth: 0,
  ambassadorsSilver: 0,
  ambassadorsGold: 0,
  ambassadorsVolumeAnnual: 0,
  cyclesActive: 0,
  servicesOverdue: 0,
  servicesDueSoon: 0,
  birthdaysUpcoming: 0,
}

const closedStages = ['cerrado_ganado', 'cerrado_perdido', 'cerrado']

const IN_CHUNK_SIZE = 200

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const loadScopedEquipmentIds = async (scope: DashboardScope): Promise<ScopedEquipmentResult> => {
  if (scope.kind !== 'self' && scope.kind !== 'distribution') {
    return { ids: [], error: null }
  }

  let query = supabase
    .from('equipos_instalados')
    .select('id, cliente:clientes!inner(vendedor_id)')

  if (scope.kind === 'self' && scope.userId) {
    query = query.eq('cliente.vendedor_id', scope.userId)
  } else if (scope.kind === 'distribution') {
    query = query.in('cliente.vendedor_id', scope.userIds)
  }

  const { data, error } = await query
  if (error) {
    return { ids: [], error: new Error(error.message) }
  }

  const ids = Array.from(
    new Set(
      ((data as ScopedEquipmentRow[] | null) ?? [])
        .map((row) => row.id)
        .filter((value): value is string => Boolean(value)),
    ),
  )

  return { ids, error: null }
}

const countScopedComponents = async ({
  equipmentIds,
  applyDateFilter,
}: {
  equipmentIds: string[]
  applyDateFilter: (query: any) => any
}): Promise<ComponentCountResult> => {
  if (equipmentIds.length === 0) {
    return { count: 0, error: null }
  }

  let total = 0

  for (const chunk of chunkArray(equipmentIds, IN_CHUNK_SIZE)) {
    let query = supabase
      .from('componentes_equipo')
      .select('id', { count: 'exact', head: true })
      .eq('activo', true)
      .in('equipo_instalado_id', chunk)

    query = applyDateFilter(query)

    const { count, error } = await query
    if (error) {
      return { count: 0, error: new Error(error.message) }
    }

    total += count ?? 0
  }

  return { count: total, error: null }
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

const toDateString = (date: Date) => date.toISOString().slice(0, 10)

const isWithinNextDays = (dateString: string, days: number) => {
  const today = new Date()
  const [, month, day] = dateString.split('-').map(Number)
  if (!month || !day) return false

  const base = new Date(today.getFullYear(), month - 1, day)
  if (base < today) {
    base.setFullYear(today.getFullYear() + 1)
  }
  const diffMs = base.getTime() - today.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= days
}

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState(defaultMetrics)
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

  const monthStart = useMemo(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  }, [])

  useEffect(() => {
    if (!configured) {
      setError(null)
      setMetrics(defaultMetrics)
      setLoading(false)
      return
    }

    if (scope.pending) {
      setLoading(true)
      return
    }

    if (scope.kind === 'none') {
      setError(null)
      setMetrics(defaultMetrics)
      setLoading(false)
      return
    }

    let active = true

    const fetchMetrics = async () => {
      setLoading(true)
      setError(null)

      try {
        const today = new Date()
        const todayString = toDateString(today)
        const monthStartString = toDateString(monthStart)
        const closedList = `(${closedStages.map((stage) => `"${stage}"`).join(',')})`

        let leadsCountPromise = supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', monthStart.toISOString())

        let opportunitiesCountPromise = supabase
          .from('oportunidades')
          .select('id', { count: 'exact', head: true })
          .not('etapa', 'in', closedList)

        let ventasPromise = supabase
          .from('ventas')
          .select('monto')
          .gte('fecha_venta', monthStartString)
          .lte('fecha_venta', todayString)

        let cyclesPromise = supabase
          .from('programa_4en14')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'activo')

        const dueSoonEnd = toDateString(new Date(today.getTime() + 30 * 86400000))

        let overduePromise = supabase
          .from('componentes_equipo')
          .select('id', { count: 'exact', head: true })
          .lt('fecha_proximo_cambio', todayString)
          .eq('activo', true)

        let dueSoonPromise = supabase
          .from('componentes_equipo')
          .select('id', { count: 'exact', head: true })
          .gte('fecha_proximo_cambio', todayString)
          .lte('fecha_proximo_cambio', dueSoonEnd)
          .eq('activo', true)

        const clientesQuery = supabase
          .from('clientes')
          .select('fecha_nacimiento, vendedor_id')
          .not('fecha_nacimiento', 'is', null)

        let scopedProgramsPromise: PromiseLike<{ data: ScopedProgram[] | null; error: { message?: string } | null }> = Promise.resolve({
          data: [],
          error: null,
        })

        let scopedEquipmentIdsPromise: Promise<ScopedEquipmentResult> = Promise.resolve({
          ids: [],
          error: null,
        })

        if (scope.kind === 'self' && scope.userId) {
          leadsCountPromise = leadsCountPromise.or(`owner_id.eq.${scope.userId},vendedor_id.eq.${scope.userId}`)
          opportunitiesCountPromise = opportunitiesCountPromise.eq('owner_id', scope.userId)
          ventasPromise = ventasPromise.eq('vendedor_id', scope.userId)
          cyclesPromise = cyclesPromise.eq('vendedor_id', scope.userId)
          clientesQuery.eq('vendedor_id', scope.userId)
          scopedProgramsPromise = supabase
            .from('programa_4en14')
            .select('id, propietario_tipo, propietario_id')
            .eq('vendedor_id', scope.userId)
          scopedEquipmentIdsPromise = loadScopedEquipmentIds(scope)
        } else if (scope.kind === 'distribution') {
          const ids = scope.userIds.join(',')
          leadsCountPromise = leadsCountPromise.or(`owner_id.in.(${ids}),vendedor_id.in.(${ids})`)
          opportunitiesCountPromise = opportunitiesCountPromise.in('owner_id', scope.userIds)
          ventasPromise = ventasPromise.in('vendedor_id', scope.userIds)
          cyclesPromise = cyclesPromise.in('vendedor_id', scope.userIds)
          clientesQuery.in('vendedor_id', scope.userIds)
          scopedProgramsPromise = supabase
            .from('programa_4en14')
            .select('id, propietario_tipo, propietario_id')
            .in('vendedor_id', scope.userIds)
          scopedEquipmentIdsPromise = loadScopedEquipmentIds(scope)
        }

        const [
          leadsCount,
          opportunitiesCount,
          ventas,
          cyclesCount,
          overdueCount,
          dueSoonCount,
          activePeriodResult,
          scopedProgramsResult,
          scopedEquipmentIdsResult,
          clientesBirthdays,
        ] = await Promise.all([
          leadsCountPromise,
          opportunitiesCountPromise,
          ventasPromise,
          cyclesPromise,
          overduePromise,
          dueSoonPromise,
          supabase.from('periodos_programa').select('id').eq('activo', true).maybeSingle(),
          scopedProgramsPromise,
          scopedEquipmentIdsPromise,
          clientesQuery,
        ])

        const baseError =
          leadsCount.error ||
          opportunitiesCount.error ||
          ventas.error ||
          cyclesCount.error ||
          overdueCount.error ||
          dueSoonCount.error ||
          activePeriodResult.error ||
          scopedProgramsResult.error ||
          scopedEquipmentIdsResult.error ||
          clientesBirthdays.error

        if (baseError) {
          throw new Error(baseError.message ?? 'Error loading dashboard metrics')
        }

        const scopedPrograms = (scopedProgramsResult.data as ScopedProgram[] | null) ?? []
        const scopedProgramIds = scopedPrograms.map((program) => program.id)
        const scopedEquipmentIds = scopedEquipmentIdsResult.ids
        const scopedEmbajadorIds = Array.from(
          new Set(
            scopedPrograms
              .filter((program) => program.propietario_tipo === 'embajador')
              .map((program) => program.propietario_id)
              .filter((value): value is string => Boolean(value)),
          ),
        )

        let demosResult: { count?: number | null; error: { message?: string } | null }
        if (scope.kind !== 'global' && scopedProgramIds.length === 0) {
          demosResult = { count: 0, error: null }
        } else {
          let demosQuery = supabase
            .from('programa_4en14_referidos')
            .select('id', { count: 'exact', head: true })
            .eq('estado_presentacion', 'demo_calificada')

          if (scope.kind !== 'global') {
            demosQuery = demosQuery.in('programa_id', scopedProgramIds)
          }

          demosResult = await demosQuery
        }

        if (demosResult.error) {
          throw new Error(demosResult.error.message ?? 'Error loading dashboard metrics')
        }

        const scopedOverdueResult =
          scope.kind === 'global'
            ? { count: overdueCount.count ?? 0, error: null }
            : await countScopedComponents({
              equipmentIds: scopedEquipmentIds,
              applyDateFilter: (query) => query.lt('fecha_proximo_cambio', todayString),
            })

        const scopedDueSoonResult =
          scope.kind === 'global'
            ? { count: dueSoonCount.count ?? 0, error: null }
            : await countScopedComponents({
              equipmentIds: scopedEquipmentIds,
              applyDateFilter: (query) => query.gte('fecha_proximo_cambio', todayString).lte('fecha_proximo_cambio', dueSoonEnd),
            })

        if (scopedOverdueResult.error || scopedDueSoonResult.error) {
          throw scopedOverdueResult.error ?? scopedDueSoonResult.error
        }

        let ambassadorsSilver = 0
        let ambassadorsGold = 0
        let ambassadorsVolumeAnnual = 0

        if (activePeriodResult.data?.id) {
          const ambassadorScopedOut = scope.kind !== 'global' && scopedEmbajadorIds.length === 0

          if (!ambassadorScopedOut) {
            let silverQuery = supabase
              .from('embajador_programas')
              .select('id', { count: 'exact', head: true })
              .eq('periodo_id', activePeriodResult.data.id)
              .eq('nivel', 'silver')

            let goldQuery = supabase
              .from('embajador_programas')
              .select('id', { count: 'exact', head: true })
              .eq('periodo_id', activePeriodResult.data.id)
              .eq('nivel', 'gold')

            let volumeQuery = supabase
              .from('embajador_programas')
              .select('total_ventas_generadas_anual')
              .eq('periodo_id', activePeriodResult.data.id)

            if (scope.kind !== 'global') {
              silverQuery = silverQuery.in('embajador_id', scopedEmbajadorIds)
              goldQuery = goldQuery.in('embajador_id', scopedEmbajadorIds)
              volumeQuery = volumeQuery.in('embajador_id', scopedEmbajadorIds)
            }

            const [silverData, goldData, volumeData] = await Promise.all([
              silverQuery,
              goldQuery,
              volumeQuery,
            ])

            const ambassadorError = silverData.error || goldData.error || volumeData.error
            if (ambassadorError) {
              throw new Error(ambassadorError.message ?? 'Error loading dashboard metrics')
            }

            ambassadorsSilver = silverData.count ?? 0
            ambassadorsGold = goldData.count ?? 0
            ambassadorsVolumeAnnual = ((volumeData.data as { total_ventas_generadas_anual: number | null }[] | null) ?? []).reduce(
              (acc, row) => acc + (row.total_ventas_generadas_anual ?? 0),
              0,
            )
          }
        }

        let embajadoresBirthdaysResult: { data?: { fecha_nacimiento: string | null }[] | null; error: { message?: string } | null }
        if (scope.kind !== 'global' && scopedEmbajadorIds.length === 0) {
          embajadoresBirthdaysResult = { data: [], error: null }
        } else {
          let embajadoresQuery = supabase
            .from('embajadores')
            .select('fecha_nacimiento')
            .not('fecha_nacimiento', 'is', null)

          if (scope.kind !== 'global') {
            embajadoresQuery = embajadoresQuery.in('id', scopedEmbajadorIds)
          }

          embajadoresBirthdaysResult = await embajadoresQuery
        }

        if (embajadoresBirthdaysResult.error) {
          throw new Error(embajadoresBirthdaysResult.error.message ?? 'Error loading dashboard metrics')
        }

        const ventasTotal = ((ventas.data as { monto: number | null }[] | null) ?? []).reduce(
          (acc, row) => acc + (row.monto ?? 0),
          0,
        )

        const upcomingBirthdays = [
          ...(((clientesBirthdays.data as { fecha_nacimiento: string | null }[] | null) ?? [])),
          ...(((embajadoresBirthdaysResult.data as { fecha_nacimiento: string | null }[] | null) ?? [])),
        ]
          .map((row) => row.fecha_nacimiento as string)
          .filter((date) => Boolean(date))
          .filter((date) => isWithinNextDays(date, 7)).length

        if (!active) return

        setMetrics({
          leadsNew: leadsCount.count ?? 0,
          opportunitiesActive: opportunitiesCount.count ?? 0,
          demos: demosResult.count ?? 0,
          salesMonth: ventasTotal,
          ambassadorsSilver,
          ambassadorsGold,
          ambassadorsVolumeAnnual,
          cyclesActive: cyclesCount.count ?? 0,
          servicesOverdue: scopedOverdueResult.count,
          servicesDueSoon: scopedDueSoonResult.count,
          birthdaysUpcoming: upcomingBirthdays,
        })
      } catch (nextError) {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : 'Error loading dashboard metrics')
        setMetrics(defaultMetrics)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void fetchMetrics()

    return () => {
      active = false
    }
  }, [configured, monthStart, scope])

  return { metrics, loading, configured, error, scopePending: scope.pending }
}
