/**
 * clienteSegments.ts
 * Segmentos MarketingFlow cuyo contacto_tipo = 'cliente'.
 *
 * Patrón de consolidación:
 *   1 fila por cliente con lista de componentes vencidos.
 *   EnviosPage registra mensajes por cliente (con mensaje_texto personalizado).
 */

import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import type { LeadScope } from './leadSegments'

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ComponenteVencido = {
  componente_id: string
  nombre_componente: string | null
  ciclo_meses: number | null
  fecha_proximo_cambio: string | null
}

export type ClienteContactRow = {
  id: string           // = cliente_id, usado como contacto_id en mk_messages
  cliente_id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  vendedor_id: string | null
  distribuidor_id: string | null
  componentes: ComponenteVencido[]
}

type ViewRow = {
  id: string
  nombre_componente: string | null
  ciclo_meses: number | null
  fecha_proximo_cambio: string | null
  equipo?: {
    cliente?: {
      id: string
      nombre: string | null
      apellido: string | null
      telefono: string | null
      vendedor_id: string | null
      distribuidor_id: string | null
    } | {
      id: string
      nombre: string | null
      apellido: string | null
      telefono: string | null
      vendedor_id: string | null
      distribuidor_id: string | null
    }[]
  } | {
    cliente?: {
      id: string
      nombre: string | null
      apellido: string | null
      telefono: string | null
      vendedor_id: string | null
      distribuidor_id: string | null
    } | {
      id: string
      nombre: string | null
      apellido: string | null
      telefono: string | null
      vendedor_id: string | null
      distribuidor_id: string | null
    }[]
  }[]
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Obtiene clientes con componentes vencidos (fecha_proximo_cambio <= hoy).
 * Devuelve una fila por cliente (mensaje por cliente).
 */
export const fetchComponentesVencidos = async (
  scope: LeadScope,
): Promise<ClienteContactRow[]> => {
  if (!isSupabaseConfigured) return []

  const todayKey = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('componentes_equipo')
    .select(
      'id, nombre_componente, ciclo_meses, fecha_proximo_cambio,' +
      'equipo:equipos_instalados(cliente:clientes(id, nombre, apellido, telefono, vendedor_id, distribuidor_id))',
    )
    .eq('activo', true)
    .not('fecha_proximo_cambio', 'is', null)
    .lte('fecha_proximo_cambio', todayKey)

  if (error || !data) return []

  const raw = data as unknown as ViewRow[]
  const rows = raw.flatMap((row) => {
    const equipo = Array.isArray(row.equipo) ? row.equipo[0] : row.equipo
    const clienteRaw = equipo?.cliente
    const cliente = Array.isArray(clienteRaw) ? clienteRaw[0] : clienteRaw
    if (!cliente?.id) return [] as ClienteContactRow[]
    return [
      {
        cliente_id: cliente.id,
        nombre: cliente.nombre ?? null,
        apellido: cliente.apellido ?? null,
        telefono: cliente.telefono ?? null,
        vendedor_id: cliente.vendedor_id ?? null,
        distribuidor_id: cliente.distribuidor_id ?? null,
        componentes: [
          {
            componente_id: row.id,
            nombre_componente: row.nombre_componente ?? null,
            ciclo_meses: row.ciclo_meses ?? null,
            fecha_proximo_cambio: row.fecha_proximo_cambio ?? null,
          },
        ],
      },
    ]
  })

  // Filtro de scope en JS (RLS ya restringe, esto alinea con viewMode del distribuidor)
  let scoped = rows
  if (scope.role === 'vendedor' && scope.userId) {
    scoped = scoped.filter((r) => r.vendedor_id === scope.userId)
  } else if (
    scope.hasDistribuidorScope &&
    scope.viewMode === 'distributor' &&
    scope.distributionUserIds.length > 0
  ) {
    scoped = scoped.filter(
      (r) =>
        scope.distributionUserIds.includes(r.vendedor_id ?? '') ||
        scope.distributionUserIds.includes(r.distribuidor_id ?? ''),
    )
  }

  const map = new Map<string, ClienteContactRow>()
  for (const row of scoped) {
    if (!map.has(row.cliente_id)) {
      map.set(row.cliente_id, {
        id: row.cliente_id,
        cliente_id: row.cliente_id,
        nombre: row.nombre,
        apellido: row.apellido,
        telefono: row.telefono,
        vendedor_id: row.vendedor_id,
        distribuidor_id: row.distribuidor_id,
        componentes: [],
      })
    }
    map.get(row.cliente_id)!.componentes.push(...row.componentes)
  }

  return Array.from(map.values())
}

// ── Renderizado de mensaje ───────────────────────────────────────────────────

/**
 * Construye el texto del mensaje para un cliente y sus componentes vencidos.
 * Si se pasa template, sustituye {{nombre}} y {{componentes}}.
 * Este texto se guarda en mk_messages.mensaje_texto (personalizado por cliente).
 */
export const buildComponentesMessage = (
  contact: ClienteContactRow,
  template?: string | null,
): string => {
  const nombre =
    [contact.nombre, contact.apellido].filter(Boolean).join(' ') ||
    'Estimado cliente'

  const lista = contact.componentes
    .map((componente) => {
      const ciclo = componente.ciclo_meses ? ` (${componente.ciclo_meses} meses)` : ''
      const fecha = componente.fecha_proximo_cambio ? ` vence ${componente.fecha_proximo_cambio}` : ''
      return `- ${componente.nombre_componente ?? 'Componente'}${ciclo}${fecha}`
    })
    .join('\n')

  if (template) {
    return template
      .replace(/\{\{nombre\}\}/g, nombre)
      .replace(/\{\{componentes\}\}/g, lista)
  }

  return (
    `Hola ${nombre}, estos componentes requieren servicio:\n` +
    `${lista}\n` +
    `¿Podemos agendar el mantenimiento?`
  )
}

// ── Definición del segmento (compatible con SEGMENTS en leadSegments.ts) ─────

export const CLIENTE_SEGMENTS = [
  {
    key: 'componentes_vencidos' as const,
    label: 'Componentes vencidos',
    hint: 'Clientes con componentes cuya fecha_proximo_cambio ya vencio',
    contacto_tipo: 'cliente' as const,
    fetch: fetchComponentesVencidos,
    buildMensaje: buildComponentesMessage,
  },
]

export type ClienteSegmentKey = (typeof CLIENTE_SEGMENTS)[number]['key']
