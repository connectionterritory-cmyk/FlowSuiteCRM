import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import {
  getActivationState,
  normalizeReferido,
  stripPhone,
  type ReferidoFormRow,
} from '../lib/conexiones/validaciones'

export type CiActivacion = {
  id: string
  fecha_activacion: string | null
  representante_id: string | null
  cliente_id: string | null
  lead_id: string | null
  regalo_id: string | null
  foto_url: string | null
  whatsapp_mensaje_enviado_at: string | null
  estado: string | null
  created_at?: string | null
}

export type CiReferido = {
  id: string
  activacion_id: string | null
  nombre: string | null
  telefono: string | null
  relacion: string | null
  estado: string | null
  lead_id: string | null
}

export type CiCliente = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
}

export type CiLead = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
}

export type GiftProduct = {
  id: string
  nombre: string
  categoria: string | null
  activo: boolean | null
}

export type Representante = {
  id: string
  nombre: string
  telefono: string
}

export type CreateActivacionInput = {
  clienteId: string | null
  leadId: string | null
  regaloId: string | null
  fotoUrl: string | null
  whatsappEnviadoAt: string | null
  referidos: ReferidoFormRow[]
}

export type EmbajadorRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  fecha_nacimiento: string | null
}

export type PeriodoRecord = {
  id: string
  nombre: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  activo: boolean | null
}

export type EmbajadorProgramaRecord = {
  id: string
  embajador_id: string | null
  periodo_id: string | null
  nivel: string | null
  conexiones?: number | null
  total_conexiones?: number | null
  total_conexiones_anual?: number | null
  total_ventas_generadas_anual?: number | null
  ventas_generadas?: number | null
}

export type ConexionRow = {
  nombre: string
  telefono: string
  email: string
  estado: string
}

export type ConexionesData = {
  activaciones: CiActivacion[]
  referidos: CiReferido[]
  clientes: CiCliente[]
  leads: CiLead[]
  productos: GiftProduct[]
  representante: Representante | null
  representantesMap: Record<string, Representante>
}

export type ConexionesEmbajadoresData = {
  embajadores: EmbajadorRecord[]
  periodos: PeriodoRecord[]
  programas: EmbajadorProgramaRecord[]
  role: string | null
}

type ConexionesResult<T> = { data: T | null; error: string | null }

type ConexionesHookOptions = {
  autoLoad?: boolean
  mode?: 'activaciones' | 'embajadores' | 'all'
}

export const useConexiones = (options?: ConexionesHookOptions) => {
  const { session } = useAuth()
  const configured = isSupabaseConfigured
  const { autoLoad = true, mode = 'activaciones' } = options ?? {}
  const [activaciones, setActivaciones] = useState<CiActivacion[]>([])
  const [referidos, setReferidos] = useState<CiReferido[]>([])
  const [clientes, setClientes] = useState<CiCliente[]>([])
  const [leads, setLeads] = useState<CiLead[]>([])
  const [productos, setProductos] = useState<GiftProduct[]>([])
  const [representante, setRepresentante] = useState<Representante | null>(null)
  const [representantesMap, setRepresentantesMap] = useState<Record<string, Representante>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [embajadores, setEmbajadores] = useState<EmbajadorRecord[]>([])
  const [periodos, setPeriodos] = useState<PeriodoRecord[]>([])
  const [programas, setProgramas] = useState<EmbajadorProgramaRecord[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [loadingEmbajadores, setLoadingEmbajadores] = useState(false)
  const [errorEmbajadores, setErrorEmbajadores] = useState<string | null>(null)

  const loadConexiones = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)

    const userId = session?.user.id ?? null
    const representantePromise = userId
      ? supabase.from('usuarios').select('id, nombre, apellido, telefono').eq('id', userId).maybeSingle()
      : Promise.resolve({ data: null, error: null })

    const [
      activacionesResult,
      referidosResult,
      clientesResult,
      leadsResult,
      productosResult,
      representanteResult,
      usuariosResult,
    ] = await Promise.all([
      supabase.from('ci_activaciones').select('*').order('created_at', { ascending: false }),
      supabase
        .from('ci_referidos')
        .select('id, activacion_id, nombre, telefono, relacion, estado, lead_id')
        .order('created_at', { ascending: true }),
      supabase.from('clientes').select('id, nombre, apellido, telefono').order('nombre'),
      supabase.from('leads').select('id, nombre, apellido, telefono').order('created_at', { ascending: false }),
      supabase
        .from('productos')
        .select('id, nombre, categoria, activo')
        .eq('categoria', 'regalo_premium')
        .eq('activo', true)
        .order('nombre'),
      representantePromise,
      supabase.from('usuarios').select('id, nombre, apellido, telefono'),
    ])

    if (
      activacionesResult.error ||
      referidosResult.error ||
      clientesResult.error ||
      leadsResult.error ||
      productosResult.error ||
      representanteResult.error ||
      usuariosResult.error
    ) {
      setError(
        activacionesResult.error?.message ||
          referidosResult.error?.message ||
          clientesResult.error?.message ||
          leadsResult.error?.message ||
          productosResult.error?.message ||
          representanteResult.error?.message ||
          usuariosResult.error?.message ||
          'Error loading data',
      )
    }

    setActivaciones((activacionesResult.data as CiActivacion[]) ?? [])
    setReferidos((referidosResult.data as CiReferido[]) ?? [])
    setClientes((clientesResult.data as CiCliente[]) ?? [])
    setLeads((leadsResult.data as CiLead[]) ?? [])
    setProductos((productosResult.data as GiftProduct[]) ?? [])

    const usuariosList =
      (usuariosResult.data as Array<{ id: string; nombre: string | null; apellido: string | null; telefono: string | null }> | null) ??
      []
    const representantes: Record<string, Representante> = {}
    usuariosList.forEach((user) => {
      const fullName = [user.nombre, user.apellido].filter(Boolean).join(' ').trim()
      representantes[user.id] = {
        id: user.id,
        nombre: fullName || user.id,
        telefono: user.telefono ?? '',
      }
    })
    setRepresentantesMap(representantes)

    const repData =
      (representanteResult.data as { id?: string; nombre?: string | null; apellido?: string | null; telefono?: string | null } | null) ??
      null
    if (repData && userId) {
      const repName = [repData.nombre, repData.apellido].filter(Boolean).join(' ').trim()
      setRepresentante({
        id: userId,
        nombre: repName || userId,
        telefono: repData.telefono ?? '',
      })
    } else {
      setRepresentante(null)
    }

    setLoading(false)
  }, [configured, session?.user.id])

  const loadEmbajadores = useCallback(async () => {
    if (!configured) return
    setLoadingEmbajadores(true)
    setErrorEmbajadores(null)
    const [embajadoresResult, periodosResult, programasResult, roleResult] = await Promise.all([
      supabase.from('embajadores').select('id, nombre, apellido, email, telefono, fecha_nacimiento'),
      supabase.from('periodos_programa').select('*'),
      supabase.from('embajador_programas').select('*'),
      session?.user.id
        ? supabase.from('usuarios').select('rol').eq('id', session.user.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (embajadoresResult.error || periodosResult.error || programasResult.error || roleResult.error) {
      setErrorEmbajadores(
        embajadoresResult.error?.message ||
          periodosResult.error?.message ||
          programasResult.error?.message ||
          roleResult.error?.message ||
          'Error loading data',
      )
    }

    setEmbajadores((embajadoresResult.data as EmbajadorRecord[]) ?? [])
    setPeriodos((periodosResult.data as PeriodoRecord[]) ?? [])
    setProgramas((programasResult.data as EmbajadorProgramaRecord[]) ?? [])
    setRole((roleResult.data as { rol?: string } | null)?.rol ?? null)
    setLoadingEmbajadores(false)
  }, [configured, session?.user.id])

  useEffect(() => {
    if (!autoLoad) return
    if (mode === 'activaciones' || mode === 'all') {
      loadConexiones()
    }
    if (mode === 'embajadores' || mode === 'all') {
      loadEmbajadores()
    }
  }, [autoLoad, loadConexiones, loadEmbajadores, mode])

  const createActivacion = useCallback(
    async (input: CreateActivacionInput): Promise<ConexionesResult<{ activacion: CiActivacion; referidos: CiReferido[] }>> => {
      if (!configured) return { data: null, error: 'Supabase not configured' }
      if (!session?.user.id) return { data: null, error: 'Auth required' }

      const normalizedReferidos = input.referidos.map(normalizeReferido).filter((row) => row.nombre && row.telefono)
      const estado = getActivationState({
        referidosCount: normalizedReferidos.length,
        photoPath: input.fotoUrl,
        whatsappAt: input.whatsappEnviadoAt,
      })

      const activationPayload = {
        representante_id: session.user.id,
        cliente_id: input.clienteId,
        lead_id: input.leadId,
        regalo_id: input.regaloId,
        foto_url: input.fotoUrl,
        whatsapp_mensaje_enviado_at: input.whatsappEnviadoAt,
        estado,
      }

      const { data: activationData, error: activationError } = await supabase
        .from('ci_activaciones')
        .insert(activationPayload)
        .select('*')
        .single()

      if (activationError || !activationData) {
        return { data: null, error: activationError?.message ?? 'Error creating activation' }
      }

      let referidosData: CiReferido[] = []
      if (normalizedReferidos.length > 0) {
        const referidosPayload = normalizedReferidos.map((row) => ({
          activacion_id: activationData.id,
          nombre: row.nombre,
          telefono: row.telefono,
          relacion: row.relacion,
          estado: 'pendiente',
        }))
        const { data, error: referidosError } = await supabase
          .from('ci_referidos')
          .insert(referidosPayload)
          .select('id, activacion_id, nombre, telefono, relacion, estado, lead_id')
        if (referidosError) {
          return { data: null, error: referidosError.message }
        }
        referidosData = (data as CiReferido[]) ?? []
      }

      setActivaciones((prev) => [activationData as CiActivacion, ...prev])
      if (referidosData.length > 0) {
        setReferidos((prev) => [...referidosData, ...prev])
      }
      return { data: { activacion: activationData as CiActivacion, referidos: referidosData }, error: null }
    },
    [configured, session?.user.id],
  )

  const updateActivacion = useCallback(
    async (id: string, updates: Partial<CiActivacion>): Promise<ConexionesResult<CiActivacion>> => {
      if (!configured) return { data: null, error: 'Supabase not configured' }
      const { data, error: updateError } = await supabase
        .from('ci_activaciones')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (updateError || !data) {
        return { data: null, error: updateError?.message ?? 'Error updating activation' }
      }
      setActivaciones((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))
      return { data: data as CiActivacion, error: null }
    },
    [configured],
  )

  const updateReferido = useCallback(
    async (id: string, updates: Partial<CiReferido>): Promise<ConexionesResult<CiReferido>> => {
      if (!configured) return { data: null, error: 'Supabase not configured' }
      const payload = { ...updates }
      if (typeof payload.telefono === 'string') {
        payload.telefono = stripPhone(payload.telefono)
      }
      const { data, error: updateError } = await supabase
        .from('ci_referidos')
        .update(payload)
        .eq('id', id)
        .select('id, activacion_id, nombre, telefono, relacion, estado, lead_id')
        .single()
      if (updateError || !data) {
        return { data: null, error: updateError?.message ?? 'Error updating referido' }
      }
      setReferidos((prev) => prev.map((item) => (item.id === id ? { ...item, ...payload } : item)))
      return { data: data as CiReferido, error: null }
    },
    [configured],
  )

  const addReferido = useCallback(
    async (activacionId: string, row: ReferidoFormRow): Promise<ConexionesResult<CiReferido>> => {
      if (!configured) return { data: null, error: 'Supabase not configured' }
      const payload = normalizeReferido(row)
      const { data, error: insertError } = await supabase
        .from('ci_referidos')
        .insert({ activacion_id: activacionId, ...payload, estado: 'pendiente' })
        .select('id, activacion_id, nombre, telefono, relacion, estado, lead_id')
        .single()
      if (insertError || !data) {
        return { data: null, error: insertError?.message ?? 'Error creating referido' }
      }
      setReferidos((prev) => [data as CiReferido, ...prev])
      return { data: data as CiReferido, error: null }
    },
    [configured],
  )

  const enviarFotoSorteo = useCallback(
    async (activacionId: string, sentAt: string): Promise<ConexionesResult<CiActivacion>> => {
      if (!configured) return { data: null, error: 'Supabase not configured' }
      const activation = activaciones.find((row) => row.id === activacionId)
      const referidosCount = referidos.filter((row) => row.activacion_id === activacionId).length
      const estado = getActivationState({
        referidosCount,
        photoPath: activation?.foto_url ?? null,
        whatsappAt: sentAt,
      })
      return updateActivacion(activacionId, { whatsapp_mensaje_enviado_at: sentAt, estado })
    },
    [activaciones, referidos, updateActivacion, configured],
  )

  const createCliente = useCallback(async (payload: {
    nombre: string | null
    apellido: string | null
    telefono: string | null
    numero_cuenta_financiera?: string | null
    vendedor_id?: string | null
    activo?: boolean | null
  }) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { data, error: insertError } = await supabase
      .from('clientes')
      .insert(payload)
      .select('id, nombre, apellido, telefono')
      .single()
    if (insertError) {
      return { data: null, error: insertError.message }
    }
    const cliente = data as CiCliente
    setClientes((prev) => [cliente, ...prev])
    return { data: cliente, error: null }
  }, [configured])

  const createProspecto = useCallback(async (payload: {
    nombre: string | null
    apellido: string | null
    telefono: string | null
    owner_id: string | null
    vendedor_id?: string | null
    fuente?: string | null
    estado_pipeline?: string | null
  }) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { data, error: insertError } = await supabase
      .from('leads')
      .insert(payload)
      .select('id, nombre, apellido, telefono')
      .single()
    if (insertError) {
      return { data: null, error: insertError.message }
    }
    const lead = data as CiLead
    setLeads((prev) => [lead, ...prev])
    return { data: lead, error: null }
  }, [configured])

  const createLeadFromReferido = useCallback(async (payload: { referidoId: string; nombre: string; apellido: string | null; telefono: string; owner_id: string; vendedor_id: string; referido_por_cliente_id: string | null }) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .insert({
        nombre: payload.nombre,
        apellido: payload.apellido,
        telefono: payload.telefono,
        fuente: 'conexiones_infinitas',
        estado_pipeline: 'nuevo',
        owner_id: payload.owner_id,
        vendedor_id: payload.vendedor_id,
        referido_por_cliente_id: payload.referido_por_cliente_id,
      })
      .select('id, nombre, apellido, telefono')
      .single()

    if (leadError || !leadData) {
      return { data: null, error: leadError?.message ?? 'Error creating lead' }
    }

    const { error: updateError } = await supabase
      .from('ci_referidos')
      .update({ lead_id: leadData.id })
      .eq('id', payload.referidoId)

    if (updateError) {
      return { data: null, error: updateError.message }
    }

    const lead = leadData as CiLead
    setLeads((prev) => [lead, ...prev])
    setReferidos((prev) => prev.map((row) => (row.id === payload.referidoId ? { ...row, lead_id: leadData.id } : row)))
    return { data: lead, error: null }
  }, [configured])

  const uploadActivationPhoto = useCallback(async (file: File, path: string) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { error: uploadError } = await supabase.storage.from('conexiones-infinitas').upload(path, file, {
      upsert: true,
    })
    if (uploadError) {
      return { data: null, error: uploadError.message }
    }
    return { data: path, error: null }
  }, [configured])

  const createSignedPhotoUrl = useCallback(async (path: string) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { data, error: signedError } = await supabase.storage.from('conexiones-infinitas').createSignedUrl(path, 3600)
    if (signedError) {
      return { data: null, error: signedError.message }
    }
    return { data: data?.signedUrl ?? null, error: null }
  }, [configured])

  const createEmbajador = useCallback(async (payload: { nombre: string | null; apellido: string | null; email: string | null; telefono: string | null; fecha_nacimiento: string | null }) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { error: insertError } = await supabase.from('embajadores').insert(payload)
    if (insertError) {
      return { data: null, error: insertError.message }
    }
    return { data: true, error: null }
  }, [configured])

  const createPeriodo = useCallback(async (payload: { nombre: string; anio: number; fecha_inicio: string; fecha_fin: string; activo: boolean }) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { error: insertError } = await supabase.from('periodos_programa').insert(payload)
    if (insertError) {
      return { data: null, error: insertError.message }
    }
    return { data: true, error: null }
  }, [configured])

  const registerEmbajadorPrograma = useCallback(async (payload: { embajador_id: string; periodo_id: string; nivel: string }) => {
    if (!configured) return { data: null, error: 'Supabase not configured' }
    const { error: insertError } = await supabase.from('embajador_programas').insert(payload)
    if (insertError) {
      return { data: null, error: insertError.message }
    }
    return { data: true, error: null }
  }, [configured])

  const saveConexiones = useCallback(
    async (input: { program: EmbajadorProgramaRecord; rows: ConexionRow[]; ownerId: string | null }): Promise<ConexionesResult<true>> => {
      if (!configured) return { data: null, error: 'Supabase not configured' }
      if (!input.program.embajador_id) return { data: null, error: 'Missing embajador' }
      const validRows = input.rows.filter((row) => row.nombre.trim() !== '')
      if (validRows.length === 0) return { data: null, error: 'No rows' }

      const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
      const leadsPayload = validRows.map((row) => ({
        nombre: row.nombre.trim(),
        telefono: toNull(stripPhone(row.telefono)),
        email: toNull(row.email),
        fuente: 'referido',
        embajador_id: input.program.embajador_id,
        owner_id: input.ownerId,
        vendedor_id: input.ownerId,
        estado_pipeline: 'nuevo',
      }))

      const program4en14Result = await supabase
        .from('programa_4en14')
        .select('id')
        .eq('propietario_tipo', 'embajador')
        .eq('propietario_id', input.program.embajador_id)
        .eq('estado', 'activo')
        .order('fecha_inicio', { ascending: false })
        .limit(1)

      const program4en14Id = program4en14Result.data?.[0]?.id ?? null
      const referidosPayload = program4en14Id
        ? validRows.map((row) => ({
            programa_id: program4en14Id,
            nombre: row.nombre.trim(),
            telefono: toNull(stripPhone(row.telefono)),
            estado_presentacion: row.estado || 'pendiente',
          }))
        : []

      const currentConnections =
        input.program.total_conexiones_anual ??
        input.program.total_conexiones ??
        input.program.conexiones ??
        0
      const nextConnections = currentConnections + validRows.length

      const requests = [
        supabase.from('leads').insert(leadsPayload),
        supabase.from('embajador_programas').update({ total_conexiones_anual: nextConnections }).eq('id', input.program.id),
      ]
      if (referidosPayload.length > 0) {
        requests.push(supabase.from('programa_4en14_referidos').insert(referidosPayload))
      }
      const results = await Promise.all(requests)
      const errorResult = results.find((result) => 'error' in result && result.error)
      if (errorResult && 'error' in errorResult && errorResult.error) {
        return { data: null, error: errorResult.error.message }
      }

      setProgramas((prev) =>
        prev.map((item) =>
          item.id === input.program.id
            ? { ...item, total_conexiones_anual: nextConnections }
            : item,
        ),
      )
      return { data: true, error: null }
    },
    [configured],
  )

  const data = useMemo<ConexionesData>(
    () => ({ activaciones, referidos, clientes, leads, productos, representante, representantesMap }),
    [activaciones, referidos, clientes, leads, productos, representante, representantesMap],
  )

  const embajadoresData = useMemo<ConexionesEmbajadoresData>(
    () => ({ embajadores, periodos, programas, role }),
    [embajadores, periodos, programas, role],
  )

  return {
    configured,
    loading,
    error,
    data,
    loadConexiones,
    loadingEmbajadores,
    errorEmbajadores,
    embajadoresData,
    loadEmbajadores,
    createActivacion,
    updateActivacion,
    updateReferido,
    addReferido,
    enviarFotoSorteo,
    createCliente,
    createProspecto,
    createLeadFromReferido,
    uploadActivationPhoto,
    createSignedPhotoUrl,
    createEmbajador,
    createPeriodo,
    registerEmbajadorPrograma,
    saveConexiones,
  }
}
