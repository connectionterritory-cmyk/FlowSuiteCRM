import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'

type UserRow = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  rol: string | null
  codigo_distribuidor?: string | null
  codigo_vendedor?: string | null
  distribuidor_padre_id?: string | null
  organizacion?: string | null
  telefono?: string | null
  foto_url?: string | null
}

type UsersContextValue = {
  usersById: Record<string, string>
  currentRole: string | null
  currentUser: UserRow | null
  loading: boolean
}

const UsersContext = createContext<UsersContextValue | undefined>(undefined)

export function UsersProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const [usersById, setUsersById] = useState<Record<string, string>>({})
  const [currentRole, setCurrentRole] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<UserRow | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!session) {
      setUsersById({})
      setCurrentRole(null)
      setLoading(false)
      return
    }

    let active = true
    const loadUsers = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, email, rol, codigo_distribuidor, codigo_vendedor, distribuidor_padre_id, organizacion, telefono, foto_url')

      if (!active) return

      if (error) {
        setUsersById({})
        setCurrentRole(null)
      } else {
        const map: Record<string, string> = {}
        const currentUserId = session.user.id
        const metadata = session.user.user_metadata as Record<string, string> | undefined
        const metadataFirst = metadata?.first_name?.trim() || ''
        const metadataLast = metadata?.last_name?.trim() || ''
        const metadataName =
          [metadataFirst, metadataLast].filter(Boolean).join(' ').trim() ||
          metadata?.full_name ||
          metadata?.name ||
          ''
        const rows = (data as UserRow[] | null) ?? []
        const currentUserRow = rows.find((user) => user.id === currentUserId) ?? null
        rows.forEach((user) => {
          const fullName = [user.nombre, user.apellido].filter(Boolean).join(' ').trim()
          map[user.id] = fullName || user.email || 'Sin nombre'
        })

        if (currentUserId) {
          const currentFallback = metadataName || map[currentUserId] || session.user.email || 'Sin nombre'
          map[currentUserId] = currentFallback

          if (metadataName && currentUserRow && !currentUserRow.nombre && !currentUserRow.apellido) {
            await supabase
              .from('usuarios')
              .update({
                nombre: metadataFirst || metadataName,
                apellido: metadataLast || null,
                email: currentUserRow.email ?? session.user.email ?? null,
              })
              .eq('id', currentUserId)
          }
        }
        setUsersById(map)
        const me = (data as UserRow[] | null)?.find((u) => u.id === session.user.id) ?? null
        setCurrentUser(me)
        setCurrentRole(me?.rol ?? null)
      }
      setLoading(false)
    }

    loadUsers()
    return () => {
      active = false
    }
  }, [session])

  const value = useMemo(
    () => ({ usersById, currentRole, currentUser, loading }),
    [usersById, currentRole, currentUser, loading],
  )

  return <UsersContext.Provider value={value}>{children}</UsersContext.Provider>
}

export function useUsers() {
  const context = useContext(UsersContext)
  if (!context) {
    throw new Error('useUsers must be used within UsersProvider')
  }
  return context
}
