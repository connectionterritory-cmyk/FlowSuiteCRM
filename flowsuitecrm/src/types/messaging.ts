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
  diasAtraso?: number | null
  estadoMorosidad?: string | null
  fuente?: string | null
  programa?: string | null
  ciudad?: string | null
  clienteId?: string | null
  leadId?: string | null
}

export type MessagingChannel = 'whatsapp' | 'sms' | 'email'
