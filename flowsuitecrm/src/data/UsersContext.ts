import { createContext } from 'react'

type UserRow = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  rol: string | null
  codigo_distribuidor?: string | null
  codigo_vendedor?: string | null
  distribuidor_padre_id?: string | null
  org_id?: string | null
  organizacion?: string | null
  telefono?: string | null
  foto_url?: string | null
}

export type UsersContextValue = {
  usersById: Record<string, string>
  currentRole: string | null
  currentUser: UserRow | null
  loading: boolean
}

export const UsersContext = createContext<UsersContextValue | undefined>(undefined)

export type { UserRow }
