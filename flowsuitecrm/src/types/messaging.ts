export type MessagingContact = {
  nombre: string
  telefono?: string | null
  email?: string | null
  vendedor?: string
  recomendadoPor?: string | null
  cuentaHycite?: string | null
  saldoActual?: number | null
  montoMoroso?: number | null
  diasAtraso?: number | null
  estadoMorosidad?: string | null
  clienteId?: string | null
  leadId?: string | null
}

export type MessagingChannel = 'whatsapp' | 'sms' | 'email'
