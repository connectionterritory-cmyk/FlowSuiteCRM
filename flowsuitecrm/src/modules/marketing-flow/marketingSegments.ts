import { fetchLeadsForSegment, SEGMENTS, type LeadRow, type LeadScope, type SegmentKey } from './leadSegments'
import { CLIENTE_SEGMENTS, type ClienteContactRow, type ClienteSegmentKey } from './clienteSegments'

export type MarketingSegmentKey = SegmentKey | ClienteSegmentKey

export type LeadContact = LeadRow & { contacto_tipo: 'lead' }
export type ClienteComponenteContact = ClienteContactRow & { contacto_tipo: 'cliente' }
export type MarketingContact = LeadContact | ClienteComponenteContact

export type MarketingSegment = {
  key: MarketingSegmentKey
  label: string
  hint?: string
  contacto_tipo: 'lead' | 'cliente'
  fetch: (scope: LeadScope) => Promise<MarketingContact[]>
  buildMensaje?: (contact: MarketingContact, template?: string | null) => string
}

const leadSegments: MarketingSegment[] = SEGMENTS.map((segment) => ({
  key: segment.key,
  label: segment.label,
  hint: segment.hint,
  contacto_tipo: 'lead',
  fetch: async (scope) => {
    const rows = await fetchLeadsForSegment(segment.key, scope)
    return rows.map((row) => ({ ...row, contacto_tipo: 'lead' }))
  },
}))

const clienteSegments: MarketingSegment[] = CLIENTE_SEGMENTS.map((segment) => ({
  key: segment.key,
  label: segment.label,
  hint: segment.hint,
  contacto_tipo: segment.contacto_tipo,
  fetch: async (scope) => {
    const rows = await segment.fetch(scope)
    return rows.map((row) => ({ ...row, contacto_tipo: 'cliente' }))
  },
  buildMensaje: segment.buildMensaje
    ? (contact, template) => segment.buildMensaje?.(contact as ClienteContactRow, template)
    : undefined,
}))

export const MARKETING_SEGMENTS: MarketingSegment[] = [...leadSegments, ...clienteSegments]

export const getMarketingSegment = (key: MarketingSegmentKey) =>
  MARKETING_SEGMENTS.find((segment) => segment.key === key) ?? null

export const isLeadContact = (contact: MarketingContact): contact is LeadContact =>
  contact.contacto_tipo === 'lead'

export const isClienteContact = (contact: MarketingContact): contact is ClienteComponenteContact =>
  contact.contacto_tipo === 'cliente'
