import type { ContactKind, ContactRef, CanonicalContactDraft } from '../types/contacts'
import type { MessagingContact } from '../types/messaging'

const CONTACT_TABLES: Record<ContactKind, 'clientes' | 'leads'> = {
  cliente: 'clientes',
  lead: 'leads',
}

export function isContactKind(value: string | null | undefined): value is ContactKind {
  return value === 'cliente' || value === 'lead'
}

export function buildContactRef(contacto_tipo: string | null | undefined, contacto_id: string | null | undefined): ContactRef | null {
  if (!isContactKind(contacto_tipo) || !contacto_id) return null
  return { contacto_tipo, contacto_id }
}

export function getContactTable(contacto_tipo: ContactKind): 'clientes' | 'leads' {
  return CONTACT_TABLES[contacto_tipo]
}

export function getMessagingContactRef(contact: MessagingContact | null | undefined): ContactRef | null {
  if (!contact) return null
  if (contact.contactRef) return contact.contactRef
  if (contact.leadId) return { contacto_tipo: 'lead', contacto_id: contact.leadId }
  if (contact.clienteId) return { contacto_tipo: 'cliente', contacto_id: contact.clienteId }
  return null
}

export function toCanonicalContactDraft(input: Partial<CanonicalContactDraft>): CanonicalContactDraft {
  return {
    nombre: input.nombre?.trim() ?? '',
    apellido: input.apellido?.trim() || null,
    email: input.email?.trim() || null,
    telefono: input.telefono?.trim() || null,
    direccion: input.direccion?.trim() || null,
    ciudad: input.ciudad?.trim() || null,
    estado_region: input.estado_region?.trim() || null,
    codigo_postal: input.codigo_postal?.trim() || null,
  }
}
