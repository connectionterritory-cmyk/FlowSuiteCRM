import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { getCarteraOpportunityGuard, type CarteraOpportunityGuard } from '../lib/carteraOpportunityGuard'
import { isClientOpportunityClosedStage, type ClientOpportunityChannel, type ClientOpportunitySource, type ClientOpportunityStatus } from '../constants/opportunities'

export type ClienteOpportunity = {
  id: string
  nombre: string | null
  lead_id: string | null
  cliente_id: string | null
  owner_id: string | null
  etapa: string | null
  valor: number | null
  probabilidad: number | null
  notas: string | null
  fecha_cierre_estimada: string | null
  created_at: string | null
  updated_at: string | null
  org_id?: string | null
  persona_id?: string | null
  producto_recomendado?: string | null
  categoria_producto?: string | null
  estado?: string | null
  source?: string | null
  canal?: string | null
  next_action?: string | null
  next_action_date?: string | null
  blocked_by_cartera?: boolean | null
  motivo_bloqueo?: string | null
}

export type ClienteOpportunityClient = {
  id: string
  org_id?: string | null
  nombre: string | null
  apellido: string | null
  telefono: string | null
  email: string | null
  persona_id?: string | null
  saldo_actual?: number | null
  monto_moroso?: number | null
  dias_atraso?: number | null
  hycite_id?: string | null
}

export type OpportunityProductSummary = {
  nombre: string
  categoria: string | null
}

export type OpportunitySalesSummary = {
  ventasCount: number
  ultimoMonto: number | null
  ultimaFecha: string | null
}

export type ClienteOpportunityDetail = {
  opportunity: ClienteOpportunity
  client: ClienteOpportunityClient | null
  guard: CarteraOpportunityGuard | null
  relatedReferrals: number
  installedProducts: OpportunityProductSummary[]
  salesSummary: OpportunitySalesSummary
}

type UpsertOpportunityInput = {
  id?: string
  cliente_id: string
  org_id: string
  persona_id?: string | null
  nombre?: string | null
  producto_recomendado?: string | null
  categoria_producto?: string | null
  etapa: string
  estado?: ClientOpportunityStatus | null
  owner_id: string
  source: ClientOpportunitySource
  canal?: ClientOpportunityChannel | null
  valor?: number | null
  probabilidad?: number | null
  next_action?: string | null
  next_action_date?: string | null
  blocked_by_cartera?: boolean
  motivo_bloqueo?: string | null
  fecha_cierre_estimada?: string | null
  notas?: string | null
}

const BASE_SELECT = 'id, nombre, lead_id, cliente_id, owner_id, etapa, valor, probabilidad, notas, fecha_cierre_estimada, created_at, updated_at'
const EXTENDED_SELECT = `${BASE_SELECT}, org_id, persona_id, producto_recomendado, categoria_producto, estado, source, canal, next_action, next_action_date, blocked_by_cartera, motivo_bloqueo`

function isMissingColumnError(message: string | undefined) {
  return Boolean(message && /column .* does not exist/i.test(message))
}

async function fetchOpportunities() {
  const query = supabase
    .from('oportunidades')
    .select(EXTENDED_SELECT)
    .order('updated_at', { ascending: false })

  const { data, error } = await query
  if (!error) return { data: (data as ClienteOpportunity[] | null) ?? [], error: null }

  if (!isMissingColumnError(error.message)) {
    return { data: [] as ClienteOpportunity[], error }
  }

  const fallback = await supabase
    .from('oportunidades')
    .select(BASE_SELECT)
    .order('updated_at', { ascending: false })

  return {
    data: ((fallback.data as ClienteOpportunity[] | null) ?? []).map((row) => ({
      ...row,
      org_id: null,
      persona_id: null,
      producto_recomendado: null,
      categoria_producto: null,
      estado: isClientOpportunityClosedStage(row.etapa) ? 'cerrada' : 'abierta',
      source: null,
      canal: null,
      next_action: null,
      next_action_date: null,
      blocked_by_cartera: false,
      motivo_bloqueo: null,
    })),
    error: fallback.error,
  }
}

export function useClienteOpportunities() {
  const configured = isSupabaseConfigured
  const [opportunities, setOpportunities] = useState<ClienteOpportunity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const result = await fetchOpportunities()
    if (result.error) {
      setError(result.error.message)
      setOpportunities([])
    } else {
      setOpportunities(result.data)
    }
    setLoading(false)
  }, [configured])

  useEffect(() => {
    void load()
  }, [load])

  const activeOpportunities = useMemo(
    () => opportunities.filter((row) => !isClientOpportunityClosedStage(row.etapa) && row.estado !== 'cerrada' && row.estado !== 'perdida' && row.estado !== 'ganada'),
    [opportunities],
  )

  const findActiveByClient = useCallback(async (clienteId: string, categoriaProducto?: string | null) => {
    if (!clienteId) return null
    const rows = activeOpportunities.filter((row) => row.cliente_id === clienteId)
    if (rows.length === 0) return null
    if (!categoriaProducto) return rows[0]
    return rows.find((row) => (row.categoria_producto ?? '').toLowerCase() === categoriaProducto.toLowerCase()) ?? rows[0]
  }, [activeOpportunities])

  const upsertOpportunity = useCallback(async (input: UpsertOpportunityInput) => {
    const payload = {
      cliente_id: input.cliente_id,
      org_id: input.org_id,
      persona_id: input.persona_id ?? null,
      nombre: input.nombre ?? null,
      producto_recomendado: input.producto_recomendado ?? null,
      categoria_producto: input.categoria_producto ?? null,
      etapa: input.etapa,
      estado: input.estado ?? (input.blocked_by_cartera ? 'bloqueada' : 'abierta'),
      owner_id: input.owner_id,
      source: input.source,
      canal: input.canal ?? 'manual',
      valor: input.valor ?? 0,
      probabilidad: input.probabilidad ?? null,
      next_action: input.next_action ?? null,
      next_action_date: input.next_action_date ?? null,
      blocked_by_cartera: Boolean(input.blocked_by_cartera),
      motivo_bloqueo: input.motivo_bloqueo ?? null,
      fecha_cierre_estimada: input.fecha_cierre_estimada ?? null,
      notas: input.notas ?? null,
    }

    if (input.id) {
      const result = await supabase.from('oportunidades').update(payload).eq('id', input.id).select('*').single()
      if (!result.error && result.data) {
        setOpportunities((prev) => prev.map((row) => (row.id === input.id ? { ...row, ...(result.data as ClienteOpportunity) } : row)))
      }
      return result
    }

    const result = await supabase.from('oportunidades').insert(payload).select('*').single()
    if (!result.error && result.data) {
      setOpportunities((prev) => [result.data as ClienteOpportunity, ...prev])
    }
    return result
  }, [])

  const closeOpportunity = useCallback(async (id: string, outcome: 'ganada' | 'perdida' | 'cerrada', notes?: string | null) => {
    const stage = outcome === 'ganada' ? 'cerrado_ganado' : outcome === 'perdida' ? 'cerrado_perdido' : 'cerrado'
    const result = await supabase
      .from('oportunidades')
      .update({
        estado: outcome,
        etapa: stage,
        notas: notes ?? null,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (!result.error && result.data) {
      setOpportunities((prev) => prev.map((row) => (row.id === id ? { ...row, ...(result.data as ClienteOpportunity) } : row)))
    }
    return result
  }, [])

  const getClientOpportunityDetail = useCallback(async (opportunityId: string): Promise<ClienteOpportunityDetail | null> => {
    const opportunity = opportunities.find((row) => row.id === opportunityId)
    if (!opportunity || !opportunity.cliente_id) return null

    const [clientRes, equiposRes, ventasRes, activacionesRes, guard] = await Promise.all([
      supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono, email, persona_id, saldo_actual, monto_moroso, dias_atraso, hycite_id')
        .eq('id', opportunity.cliente_id)
        .maybeSingle(),
      supabase
        .from('cliente_productos')
        .select('producto_tipo')
        .eq('cliente_id', opportunity.cliente_id)
        .eq('is_active', true),
      supabase
        .from('ventas')
        .select('monto, fecha_venta')
        .eq('cliente_id', opportunity.cliente_id)
        .order('fecha_venta', { ascending: false })
        .limit(20),
      supabase
        .from('ci_activaciones')
        .select('id')
        .eq('cliente_id', opportunity.cliente_id),
      getCarteraOpportunityGuard(opportunity.cliente_id),
    ])

    let relatedReferrals = 0
    const activacionIds = ((activacionesRes.data ?? []) as { id: string }[]).map((row) => row.id)
    if (activacionIds.length > 0) {
      const referidosRes = await supabase
        .from('ci_referidos')
        .select('id', { count: 'exact', head: true })
        .in('activacion_id', activacionIds)
      relatedReferrals = referidosRes.count ?? 0
    }

    const ventas = (ventasRes.data ?? []) as { monto: number | null; fecha_venta: string | null }[]
    const installedProducts = Array.from(new Set(((equiposRes.data ?? []) as { producto_tipo: string | null }[]).map((row) => row.producto_tipo).filter(Boolean) as string[]))
      .map((name) => ({ nombre: name, categoria: null }))

    return {
      opportunity,
      client: (clientRes.data as ClienteOpportunityClient | null) ?? null,
      guard,
      relatedReferrals,
      installedProducts,
      salesSummary: {
        ventasCount: ventas.length,
        ultimoMonto: ventas[0]?.monto ?? null,
        ultimaFecha: ventas[0]?.fecha_venta ?? null,
      },
    }
  }, [opportunities])

  return {
    opportunities,
    activeOpportunities,
    loading,
    error,
    refresh: load,
    findActiveByClient,
    upsertOpportunity,
    closeOpportunity,
    getClientOpportunityDetail,
  }
}
