import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'

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
  const [configured] = useState(isSupabaseConfigured)

  const monthStart = useMemo(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  }, [])

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }

    const fetchMetrics = async () => {
      setLoading(true)
      const today = new Date()
      const todayString = toDateString(today)
      const monthStartString = toDateString(monthStart)

      const closedList = `(${closedStages.map((stage) => `"${stage}"`).join(',')})`

      const leadsCountPromise = supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart.toISOString())

      const opportunitiesCountPromise = supabase
        .from('oportunidades')
        .select('id', { count: 'exact', head: true })
        .not('etapa', 'in', closedList)

      const demosCountPromise = supabase
        .from('programa_4en14_referidos')
        .select('id', { count: 'exact', head: true })
        .eq('estado_presentacion', 'demo_calificada')

      const ventasPromise = supabase
        .from('ventas')
        .select('monto')
        .gte('fecha_venta', monthStartString)
        .lte('fecha_venta', todayString)

      const cyclesPromise = supabase
        .from('programa_4en14')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'activo')

      const overduePromise = supabase
        .from('componentes_equipo')
        .select('id', { count: 'exact', head: true })
        .lt('fecha_proximo_cambio', todayString)
        .eq('activo', true)

      const dueSoonPromise = supabase
        .from('componentes_equipo')
        .select('id', { count: 'exact', head: true })
        .gte('fecha_proximo_cambio', todayString)
        .lte('fecha_proximo_cambio', toDateString(new Date(today.getTime() + 30 * 86400000)))
        .eq('activo', true)

      const [
        leadsCount,
        opportunitiesCount,
        demosCount,
        ventas,
        cyclesCount,
        overdueCount,
        dueSoonCount,
      ] = await Promise.all([
        leadsCountPromise,
        opportunitiesCountPromise,
        demosCountPromise,
        ventasPromise,
        cyclesPromise,
        overduePromise,
        dueSoonPromise,
      ])

      const ventasTotal = (ventas.data ?? []).reduce(
        (acc, row) => acc + (row.monto ?? 0),
        0,
      )

      const { data: activePeriod } = await supabase
        .from('periodos_programa')
        .select('id')
        .eq('activo', true)
        .maybeSingle()

      let ambassadorsSilver = 0
      let ambassadorsGold = 0
      let ambassadorsVolumeAnnual = 0

      if (activePeriod?.id) {
        const [silverData, goldData, volumeData] = await Promise.all([
          supabase
            .from('embajador_programas')
            .select('id', { count: 'exact', head: true })
            .eq('periodo_id', activePeriod.id)
            .eq('nivel', 'silver'),
          supabase
            .from('embajador_programas')
            .select('id', { count: 'exact', head: true })
            .eq('periodo_id', activePeriod.id)
            .eq('nivel', 'gold'),
          supabase
            .from('embajador_programas')
            .select('total_ventas_generadas_anual')
            .eq('periodo_id', activePeriod.id),
        ])

        ambassadorsSilver = silverData.count ?? 0
        ambassadorsGold = goldData.count ?? 0
        ambassadorsVolumeAnnual = (volumeData.data ?? []).reduce(
          (acc, row) => acc + (row.total_ventas_generadas_anual ?? 0),
          0,
        )
      }

      const [clientesBirthdays, embajadoresBirthdays] = await Promise.all([
        supabase
          .from('clientes')
          .select('fecha_nacimiento')
          .not('fecha_nacimiento', 'is', null),
        supabase
          .from('embajadores')
          .select('fecha_nacimiento')
          .not('fecha_nacimiento', 'is', null),
      ])

      const upcomingBirthdays = [...(clientesBirthdays.data ?? []), ...(embajadoresBirthdays.data ?? [])]
        .map((row) => row.fecha_nacimiento as string)
        .filter((date) => Boolean(date))
        .filter((date) => isWithinNextDays(date, 7)).length

      setMetrics({
        leadsNew: leadsCount.count ?? 0,
        opportunitiesActive: opportunitiesCount.count ?? 0,
        demos: demosCount.count ?? 0,
        salesMonth: ventasTotal,
        ambassadorsSilver,
        ambassadorsGold,
        ambassadorsVolumeAnnual,
        cyclesActive: cyclesCount.count ?? 0,
        servicesOverdue: overdueCount.count ?? 0,
        servicesDueSoon: dueSoonCount.count ?? 0,
        birthdaysUpcoming: upcomingBirthdays,
      })
      setLoading(false)
    }

    fetchMetrics()
  }, [configured, monthStart])

  return { metrics, loading, configured }
}
