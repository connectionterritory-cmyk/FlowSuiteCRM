import { startTransition, useEffect, useMemo, useState } from 'react'
import { useUsers } from './useUsers'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useAuth } from '../auth/useAuth'
import { ViewModeContext, type ViewMode } from './ViewModeContext'
export { useViewMode } from './useViewMode'

const STORAGE_KEY = 'flowsuite.viewMode'

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useUsers()
  const { session } = useAuth()
  const sessionUserId = session?.user.id ?? null
  const isMasterAdmin = session?.user?.email === 'royalflorida@gmail.com'
  const hasDistribuidorScope =
    currentUser?.rol === 'admin' ||
    currentUser?.rol === 'distribuidor' ||
    Boolean(currentUser?.codigo_distribuidor) ||
    isMasterAdmin
  const [distributionUserIds, setDistributionUserIds] = useState<string[]>([])
  const [distributionLoading, setDistributionLoading] = useState(false)

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (isMasterAdmin) return 'distributor'
    if (typeof window === 'undefined') return 'seller'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'distributor' ? 'distributor' : 'seller'
  })

  useEffect(() => {
    if (isMasterAdmin) {
      startTransition(() => {
        setViewMode('distributor')
      })
      return
    }
    if (!hasDistribuidorScope) {
      startTransition(() => {
        setViewMode('seller')
      })
      return
    }
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'seller' || stored === 'distributor') {
      startTransition(() => {
        setViewMode(stored)
      })
      return
    }
    startTransition(() => {
      setViewMode('distributor')
    })
  }, [hasDistribuidorScope, isMasterAdmin])

  useEffect(() => {
    if (!hasDistribuidorScope || isMasterAdmin) return
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, viewMode)
  }, [hasDistribuidorScope, isMasterAdmin, viewMode])

  useEffect(() => {
    if (!sessionUserId) {
      startTransition(() => {
        setDistributionUserIds([])
      })
      return
    }
    if (!isSupabaseConfigured || !hasDistribuidorScope) {
      startTransition(() => {
        setDistributionUserIds([sessionUserId])
      })
      return
    }
    let active = true
    const load = async () => {
      setDistributionLoading(true)
      if (isMasterAdmin) {
        const { data, error } = await supabase
          .from('usuarios')
          .select('id')
          .eq('activo', true)
        if (!active) return
        if (error) {
          setDistributionUserIds([sessionUserId])
          setDistributionLoading(false)
          return
        }
        const ids = (data ?? []).map((row) => row.id)
        if (sessionUserId && !ids.includes(sessionUserId)) ids.push(sessionUserId)
        setDistributionUserIds(ids)
        setDistributionLoading(false)
        return
      }
      let query = supabase
        .from('usuarios')
        .select('id')
        .eq('activo', true)

    if (currentUser?.codigo_distribuidor) {
        query = query.or(
          `codigo_distribuidor.eq.${currentUser.codigo_distribuidor},distribuidor_padre_id.eq.${sessionUserId}`,
        )
      } else {
        query = query.eq('distribuidor_padre_id', sessionUserId)
      }

      const { data, error } = await query
      if (!active) return
      if (error) {
        setDistributionUserIds([sessionUserId])
        setDistributionLoading(false)
        return
      }
      const ids = (data ?? []).map((row) => row.id)
      if (sessionUserId && !ids.includes(sessionUserId)) ids.push(sessionUserId)
      setDistributionUserIds(ids)
      setDistributionLoading(false)
    }
    const handle = window.setTimeout(() => {
      void load()
    }, 0)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [hasDistribuidorScope, isMasterAdmin, currentUser?.codigo_distribuidor, sessionUserId])

  const value = useMemo(
    () => ({ viewMode, setViewMode, hasDistribuidorScope, distributionUserIds, distributionLoading }),
    [viewMode, hasDistribuidorScope, distributionUserIds, distributionLoading],
  )

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
}
