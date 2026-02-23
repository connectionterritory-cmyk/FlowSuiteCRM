import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import type { Cliente, EquipoInstalado } from './TelemercadeoShared'

export function useTelemercadeoClientes() {
  const configured = isSupabaseConfigured
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(false)

  const cargarClientes = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    const { data } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, telefono, telefono_casa, email, saldo_actual, monto_moroso, dias_atraso, fecha_nacimiento, fecha_ultimo_pedido, hycite_id, estado_cuenta, nivel')
      .order('dias_atraso', { ascending: false })
    setClientes((data as Cliente[]) ?? [])
    setLoading(false)
  }, [configured])

  useEffect(() => {
    cargarClientes()
  }, [cargarClientes])

  return { clientes, loading, recargar: cargarClientes }
}

export function useTelemercadeoEquipos() {
  const configured = isSupabaseConfigured
  const [equipos, setEquipos] = useState<EquipoInstalado[]>([])
  const [loading, setLoading] = useState(false)

  const cargarEquipos = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    const { data } = await supabase
      .from('equipos_instalados')
      .select(`
        id, cliente_id, fecha_instalacion, activo,
        cliente:clientes(id, nombre, apellido, telefono, telefono_casa, email, saldo_actual, monto_moroso, dias_atraso, fecha_nacimiento, fecha_ultimo_pedido, hycite_id, estado_cuenta, nivel)
      `)
      .eq('activo', true)
    setEquipos((data as unknown as EquipoInstalado[]) ?? [])
    setLoading(false)
  }, [configured])

  useEffect(() => {
    cargarEquipos()
  }, [cargarEquipos])

  return { equipos, loading, recargar: cargarEquipos }
}
