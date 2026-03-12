export type ContactKind = 'cliente' | 'lead'

export type ContactRef = {
  contacto_tipo: ContactKind
  contacto_id: string
}

export type CanonicalContactDraft = {
  nombre: string
  apellido?: string | null
  email?: string | null
  telefono?: string | null
  direccion?: string | null
  ciudad?: string | null
  estado_region?: string | null
  codigo_postal?: string | null
}

export type NextActionPayload = ContactRef & {
  next_action: string | null
  next_action_date: string | null
}

export type NotePayload = ContactRef & {
  nota: string
  canal?: string | null
  tipo_mensaje?: string | null
}

export type AppointmentPayload = ContactRef & {
  start_at: string
  tipo: string
  estado: string
  assigned_to?: string | null
  notas?: string | null
  direccion?: string | null
  ciudad?: string | null
  estado_region?: string | null
  zip?: string | null
  resultado?: string | null
  resultado_notas?: string | null
}
