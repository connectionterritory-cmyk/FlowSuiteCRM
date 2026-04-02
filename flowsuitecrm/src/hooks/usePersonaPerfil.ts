import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase/client'

export type PersonaLead = {
  id: string
  nombre: string | null
  apellido: string | null
  estado_pipeline: string
  owner_id: string | null
  created_at: string
}

export type PersonaCliente = {
  id: string
  nombre: string | null
  apellido: string | null
  estado_cuenta: string | null
  vendedor_id: string | null
  fecha_ultimo_pedido: string | null
  saldo_actual: number
}

export type PersonaEmbajador = {
  id: string
  estado: string
  fecha_aceptacion: string | null
  lead_id: string | null
  cliente_id: string | null
}

export type PersonaActivacion = {
  id: string
  estado: string | null
  cantidad_referidos: number
  regalo_nombre: string | null
  representante_id: string
  created_at: string | null
}

export type PersonaActividad = {
  id: string
  tipo: string
  resumen: string | null
  contenido: string | null
  metadata: Record<string, unknown> | null
  autor_id: string
  fecha_actividad: string
  created_at: string
  contacto_tipo: 'lead' | 'cliente'
  contacto_id: string
}

export type PersonaPerfil = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  leads: PersonaLead[]
  clientes: PersonaCliente[]
  embajadores: PersonaEmbajador[]
  activaciones: PersonaActivacion[]
  actividades: PersonaActividad[]
}

type State = {
  perfil: PersonaPerfil | null
  loading: boolean
  error: string | null
}

export function usePersonaPerfil(personaId: string | null): State {
  const [state, setState] = useState<State>({ perfil: null, loading: false, error: null })

  useEffect(() => {
    if (!personaId) {
      setState({ perfil: null, loading: false, error: null })
      return
    }

    let active = true

    const load = async () => {
      setState((s) => ({ ...s, loading: true, error: null }))

      // Query principal: persona + registros vinculados via FK inverso
      const { data: persona, error: personaError } = await supabase
        .from('personas')
        .select(`
          id, nombre, apellido, email, telefono,
          leads!leads_persona_id_fkey(id, nombre, apellido, estado_pipeline, owner_id, created_at),
          clientes!clientes_persona_id_fkey(id, nombre, apellido, estado_cuenta, vendedor_id, fecha_ultimo_pedido, saldo_actual),
          embajadores!embajadores_persona_id_fkey(id, estado, fecha_aceptacion, lead_id, cliente_id)
        `)
        .eq('id', personaId)
        .single()

      if (!active) return

      if (personaError || !persona) {
        setState({ perfil: null, loading: false, error: personaError?.message ?? 'Persona no encontrada' })
        return
      }

      const leads = (persona.leads ?? []) as PersonaLead[]
      const clientes = (persona.clientes ?? []) as PersonaCliente[]
      const embajadores = (persona.embajadores ?? []) as PersonaEmbajador[]

      const leadIds = leads.map((l) => l.id)
      const clienteIds = clientes.map((c) => c.id)

      // Queries paralelas: activaciones + historial de contacto_actividades
      const [activacionesResult, leadActividadesResult, clienteActividadesResult] = await Promise.all([
        // ci_activaciones para cualquier lead o cliente de esta persona
        leadIds.length > 0 || clienteIds.length > 0
          ? supabase
              .from('ci_activaciones')
              .select('id, estado, cantidad_referidos, regalo_nombre, representante_id, created_at')
              .or(
                [
                  leadIds.length > 0 ? `lead_id.in.(${leadIds.join(',')})` : null,
                  clienteIds.length > 0 ? `cliente_id.in.(${clienteIds.join(',')})` : null,
                ]
                  .filter(Boolean)
                  .join(','),
              )
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [], error: null }),

        // contacto_actividades de los leads
        leadIds.length > 0
          ? supabase
              .from('contacto_actividades')
              .select('id, tipo, resumen, contenido, metadata, autor_id, fecha_actividad, created_at, contacto_tipo, contacto_id')
              .eq('contacto_tipo', 'lead')
              .in('contacto_id', leadIds)
              .order('fecha_actividad', { ascending: false })
              .limit(30)
          : Promise.resolve({ data: [], error: null }),

        // contacto_actividades de los clientes
        clienteIds.length > 0
          ? supabase
              .from('contacto_actividades')
              .select('id, tipo, resumen, contenido, metadata, autor_id, fecha_actividad, created_at, contacto_tipo, contacto_id')
              .eq('contacto_tipo', 'cliente')
              .in('contacto_id', clienteIds)
              .order('fecha_actividad', { ascending: false })
              .limit(30)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (!active) return

      const activaciones = (activacionesResult.data ?? []) as PersonaActivacion[]

      const actividades = [
        ...((leadActividadesResult.data ?? []) as PersonaActividad[]),
        ...((clienteActividadesResult.data ?? []) as PersonaActividad[]),
      ]
        .sort((a, b) => new Date(b.fecha_actividad).getTime() - new Date(a.fecha_actividad).getTime())
        .slice(0, 30)

      setState({
        perfil: {
          id: persona.id,
          nombre: persona.nombre,
          apellido: persona.apellido,
          email: persona.email,
          telefono: persona.telefono,
          leads,
          clientes,
          embajadores,
          activaciones,
          actividades,
        },
        loading: false,
        error: null,
      })
    }

    void load()
    return () => {
      active = false
    }
  }, [personaId])

  return state
}
