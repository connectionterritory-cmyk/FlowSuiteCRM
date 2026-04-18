import { startTransition, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { useAuth } from '../auth/useAuth'
import { UsersContext, type UserRow } from './UsersContext'
export { useUsers } from './useUsers'

export function UsersProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const [usersById, setUsersById] = useState<Record<string, string>>({})
  const [currentRole, setCurrentRole] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<UserRow | null>(null)
  const [loading, setLoading] = useState(false)

  const metadata = session?.user.user_metadata as Record<string, string> | undefined
  const metadataFirst = metadata?.first_name?.trim() || ''
  const metadataLast = metadata?.last_name?.trim() || ''
  const metadataName =
    [metadataFirst, metadataLast].filter(Boolean).join(' ').trim() ||
    metadata?.full_name ||
    metadata?.name ||
    ''

  useEffect(() => {
    if (!session) {
      startTransition(() => {
        setUsersById({})
        setCurrentRole(null)
        setCurrentUser(null)
        setLoading(false)
      })
      return
    }

    let active = true
    const loadCurrentUser = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, email, rol, codigo_distribuidor, codigo_vendedor, distribuidor_padre_id, org_id, organizacion, telefono, foto_url')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!active) return

      if (error) {
        setCurrentRole(null)
        setCurrentUser(null)
      } else {
        const me = (data as UserRow | null) ?? null
        setCurrentUser(me)
        setCurrentRole(me?.rol ?? null)
        setUsersById((current) => ({
          ...current,
          [session.user.id]:
            metadataName ||
            [me?.nombre, me?.apellido].filter(Boolean).join(' ').trim() ||
            me?.email ||
            me?.codigo_vendedor ||
            me?.codigo_distribuidor ||
            session.user.email ||
            'Sin nombre',
        }))

        if (metadataName && me && !me.nombre && !me.apellido) {
          void supabase
            .from('usuarios')
            .update({
              nombre: metadataFirst || metadataName,
              apellido: metadataLast || null,
              email: me.email ?? session.user.email ?? null,
            })
            .eq('id', session.user.id)
        }
      }
      setLoading(false)
    }

    void loadCurrentUser()
    return () => {
      active = false
    }
  }, [metadataFirst, metadataLast, metadataName, session])

  useEffect(() => {
    if (!session) return

    let active = true
    const loadUsersDirectory = async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, email, codigo_distribuidor, codigo_vendedor')

      if (!active || error) return

      const map: Record<string, string> = {}
      ;((data as UserRow[] | null) ?? []).forEach((user) => {
        const fullName = [user.nombre, user.apellido].filter(Boolean).join(' ').trim()
        map[user.id] = fullName || user.email || user.codigo_vendedor || user.codigo_distribuidor || 'Sin nombre'
      })

      map[session.user.id] =
        map[session.user.id] ||
        metadataName ||
        session.user.email ||
        'Sin nombre'

      setUsersById(map)
    }

    void loadUsersDirectory()
    return () => {
      active = false
    }
  }, [metadataName, session])

  const value = useMemo(
    () => ({ usersById, currentRole, currentUser, loading }),
    [usersById, currentRole, currentUser, loading],
  )

  return <UsersContext.Provider value={value}>{children}</UsersContext.Provider>
}
