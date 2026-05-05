import type { ContactRef } from './contacts'

export type MessagingContact = {
  nombre: string
  telefono?: string | null
  email?: string | null
  vendedor?: string
  vendedorNombre?: string | null
  vendedorTelefono?: string | null
  responsableNombre?: string | null
  recomendadoPor?: string | null
  recomendadoPorNombre?: string | null
  cuentaHycite?: string | null
  saldoActual?: number | null
  montoMoroso?: number | null
  montoCargoVuelta?: number | null
  saldoOperativo?: number | null
  fechaCargoVuelta?: string | null
  diasAtraso?: number | null
  estadoMorosidad?: string | null
  fuente?: string | null
  programa?: string | null
  ciudad?: string | null
  telegramChatId?: string | null
  clienteId?: string | null
  leadId?: string | null
  contactRef?: ContactRef | null
  // Campos de cita pre-agendada
  cita_fecha?: string | null
  cita_hora?: string | null
  cita_direccion?: string | null
  // Campos de equipo/producto
  equipo_nombre?: string | null
  equipo_serie?: string | null
}

export type MessagingChannel = 'whatsapp' | 'sms' | 'email' | 'telegram'

export type MessagingContextType =
  | 'campaign'
  | 'cobranza'
  | 'servicio'
  | 'cumpleanos'
  | 'seguimiento'
  | 'ad_hoc'
