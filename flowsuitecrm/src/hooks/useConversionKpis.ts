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

export function useConversionKpis(range: ConversionRange) {
  const [data, setData] = useState<ConversionKpis>(emptyKpis)
  const [loading, setLoading] = useState(true)
  const [configured] = useState(isSupabaseConfigured)
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const { session } = useAuth()
  const { currentRole } = useUsers()

  const scopedUserIds = useMemo(() => {
    const userId = session?.user.id
    if (!userId) return null

    const sellerScope = currentRole === 'vendedor' || (hasDistribuidorScope && viewMode === 'seller')
    if (sellerScope) return [userId]

    if (hasDistribuidorScope && viewMode === 'distributor') {
      return distributionUserIds.length > 0 ? distributionUserIds : null
    }

    if (currentRole === 'admin' || currentRole === 'distribuidor') return null

    return [userId]
  }, [currentRole, distributionUserIds, hasDistribuidorScope, session?.user.id, viewMode])

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }

    if (hasDistribuidorScope && viewMode === 'distributor' && distributionUserIds.length === 0) {
      setData(emptyKpis)
      setLoading(false)
      return
    }

    const run = async () => {
      setLoading(true)
      const { data: response, error } = await supabase.rpc('get_conversion_kpis', {
        p_user_ids: scopedUserIds,
        p_range: range,
      })

      if (error) {
        setData(emptyKpis)
      } else {
        setData((response as ConversionKpis) ?? emptyKpis)
      }
      setLoading(false)
    }

    run()
  }, [configured, distributionUserIds.length, hasDistribuidorScope, range, scopedUserIds, viewMode])

  return { data, loading, configured }
}
