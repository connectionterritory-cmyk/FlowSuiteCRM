import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useUsers } from './UsersProvider'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'

type ViewMode = 'seller' | 'distributor'

type ViewModeContextValue = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  hasDistribuidorScope: boolean
  distributionUserIds: string[]
  distributionLoading: boolean
}

const STORAGE_KEY = 'flowsuite.viewMode'

const ViewModeContext = createContext<ViewModeContextValue | undefined>(undefined)

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useUsers()
  const { session } = useAuth()
  const hasDistribuidorScope =
    currentUser?.rol === 'admin' ||
    currentUser?.rol === 'distribuidor' ||
    Boolean(currentUser?.codigo_distribuidor)
  const [distributionUserIds, setDistributionUserIds] = useState<string[]>([])
  const [distributionLoading, setDistributionLoading] = useState(false)

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'seller'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'distributor' ? 'distributor' : 'seller'
  })

  useEffect(() => {
    if (!hasDistribuidorScope) {
      setViewMode('seller')
      return
    }
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'seller' || stored === 'distributor') {
      setViewMode(stored)
      return
    }
    setViewMode('distributor')
  }, [hasDistribuidorScope])

  useEffect(() => {
    if (!hasDistribuidorScope) return
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, viewMode)
  }, [hasDistribuidorScope, viewMode])

  useEffect(() => {
    if (!isSupabaseConfigured || !hasDistribuidorScope || !currentUser?.codigo_distribuidor) {
      setDistributionUserIds(session?.user.id ? [session.user.id] : [])
      return
    }
    let active = true
    const load = async () => {
      setDistributionLoading(true)
      let query = supabase
        .from('usuarios')
        .select('id')
        .eq('activo', true)

      if (currentUser.codigo_distribuidor) {
        query = query.or(
          `codigo_distribuidor.eq.${currentUser.codigo_distribuidor},distribuidor_padre_id.eq.${session.user.id}`,
        )
      } else {
        query = query.eq('distribuidor_padre_id', session.user.id)
      }

      const { data, error } = await query
      if (!active) return
      if (error) {
        setDistributionUserIds(session?.user.id ? [session.user.id] : [])
        setDistributionLoading(false)
        return
      }
      const ids = (data ?? []).map((row) => row.id)
      if (session?.user.id && !ids.includes(session.user.id)) ids.push(session.user.id)
      setDistributionUserIds(ids)
      setDistributionLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [hasDistribuidorScope, currentUser?.codigo_distribuidor, session?.user.id])

  const value = useMemo(
    () => ({ viewMode, setViewMode, hasDistribuidorScope, distributionUserIds, distributionLoading }),
    [viewMode, hasDistribuidorScope, distributionUserIds, distributionLoading],
  )

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
}

export function useViewMode() {
  const context = useContext(ViewModeContext)
  if (!context) {
    throw new Error('useViewMode must be used within ViewModeProvider')
  }
  return context
}
