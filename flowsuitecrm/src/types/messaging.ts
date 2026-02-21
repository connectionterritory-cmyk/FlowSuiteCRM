export type MessagingContact = {
  nombre: string
  telefono?: string | null
  email?: string | null
  vendedor?: string
  leadId?: string | null
}

export type MessagingChannel = 'whatsapp' | 'sms' | 'email'
