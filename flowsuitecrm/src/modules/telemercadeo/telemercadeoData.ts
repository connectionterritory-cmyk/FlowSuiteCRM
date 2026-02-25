import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import type { Cliente, EquipoInstalado } from './TelemercadeoShared'

const CLIENTE_FIELDS =
  'id, nombre, apellido, telefono, telefono_casa, email, saldo_actual, monto_moroso, dias_atraso, fecha_nacimiento, fecha_ultimo_pedido, hycite_id, estado_cuenta, nivel'

/**
 * Returns the list of vendedor_ids assigned to a telemercadeo user.
 * Returns null if the user is not a telemercadeo role (meaning no filter needed).
 */
async function getTeleVendedorIds(userId: string): Promise<string[] | null> {
  // Get the user's role first
  const { data: userRow } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', userId)
    .maybeSingle()
  const rol = (userRow as { rol?: string } | null)?.rol ?? null
  if (rol !== 'telemercadeo') return null

  const { data } = await supabase
    .from('tele_vendedor_assignments')
    .select('vendedor_id')
    .eq('tele_id', userId)
  return ((data ?? []) as { vendedor_id: string }[]).map((r) => r.vendedor_id)
}

export function useTelemercadeoClientes() {
  const configured = isSupabaseConfigured
  const { session } = useAuth()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(false)

  const cargarClientes = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setLoading(true)

    const vendedorIds = await getTeleVendedorIds(session.user.id)

    // If telemercadeo user but has no assigned vendedores, show empty list
    if (vendedorIds !== null && vendedorIds.length === 0) {
      setClientes([])
      setLoading(false)
      return
    }

    let query = supabase
      .from('clientes')
      .select(CLIENTE_FIELDS)
      .order('dias_atraso', { ascending: false })

    // If vendedorIds is non-null, filter by owner_id IN assigned vendedores
    if (vendedorIds !== null) {
      query = query.in('owner_id', vendedorIds)
    }

    const { data } = await query
    setClientes((data as Cliente[]) ?? [])
    setLoading(false)
  }, [configured, session?.user.id])

  useEffect(() => {
    cargarClientes()
  }, [cargarClientes])

  return { clientes, loading, recargar: cargarClientes }
}

export function useTelemercadeoEquipos() {
  const configured = isSupabaseConfigured
  const { session } = useAuth()
  const [equipos, setEquipos] = useState<EquipoInstalado[]>([])
  const [loading, setLoading] = useState(false)

  const cargarEquipos = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setLoading(true)

    const vendedorIds = await getTeleVendedorIds(session.user.id)

    // If telemercadeo user but has no assigned vendedores, show empty list
    if (vendedorIds !== null && vendedorIds.length === 0) {
      setEquipos([])
      setLoading(false)
      return
    }

    let query = supabase
      .from('equipos_instalados')
      .select(`
        id, cliente_id, fecha_instalacion, activo,
        cliente:clientes(${CLIENTE_FIELDS})
      `)
      .eq('activo', true)

    if (vendedorIds !== null) {
      // Filter by clientes whose owner_id is in the assigned vendedores
      query = query.in('cliente.owner_id', vendedorIds)
    }

    const { data } = await query
    setEquipos((data as unknown as EquipoInstalado[]) ?? [])
    setLoading(false)
  }, [configured, session?.user.id])

  useEffect(() => {
    cargarEquipos()
  }, [cargarEquipos])

  return { equipos, loading, recargar: cargarEquipos }
}
