import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'

type UserRow = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
}

type UsersContextValue = {
  usersById: Record<string, string>
  loading: boolean
}

const UsersContext = createContext<UsersContextValue | undefined>(undefined)

export function UsersProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const [usersById, setUsersById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!session) {
      setUsersById({})
      setLoading(false)
      return
    }

    let active = true
    const loadUsers = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, email')

      if (!active) return

      if (error) {
        setUsersById({})
      } else {
        const map: Record<string, string> = {}
        ;(data as UserRow[] | null)?.forEach((user) => {
          const fullName = [user.nombre, user.apellido].filter(Boolean).join(' ').trim()
          map[user.id] = fullName || user.email || user.id
        })
        setUsersById(map)
      }
      setLoading(false)
    }

    loadUsers()
    return () => {
      active = false
    }
  }, [session])

  const value = useMemo(() => ({ usersById, loading }), [usersById, loading])

  return <UsersContext.Provider value={value}>{children}</UsersContext.Provider>
}

export function useUsers() {
  const context = useContext(UsersContext)
  if (!context) {
    throw new Error('useUsers must be used within UsersProvider')
  }
  return context
}
