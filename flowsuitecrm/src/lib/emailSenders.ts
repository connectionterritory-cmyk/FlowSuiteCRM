export type EmailSender = {
  id: string
  label: string
  fromName: string
  fromEmail: string
  replyTo: string
}

export const EMAIL_SENDERS: EmailSender[] = [
  {
    id: 'oportunidad',
    label: 'Oportunidad / Ventas',
    fromName: 'Connection Worldwide Group',
    fromEmail: 'ventas@flowiadigital.com',
    replyTo: 'oportunidad@connectionworldwidegroup.com',
  },
  {
    id: 'cartera',
    label: 'Cartera / Cobranza',
    fromName: 'Connection Worldwide Group',
    fromEmail: 'cobranza@flowiadigital.com',
    replyTo: 'info@connectionworldwidegroup.com',
  },
  {
    id: 'servicio',
    label: 'Servicio al Cliente',
    fromName: 'Connection Worldwide Group',
    fromEmail: 'servicio@flowiadigital.com',
    replyTo: 'info@connectionworldwidegroup.com',
  },
  {
    id: 'referidos',
    label: 'Referidos',
    fromName: 'Connection Worldwide Group',
    fromEmail: 'referidos@flowiadigital.com',
    replyTo: 'oportunidad@connectionworldwidegroup.com',
  },
  {
    id: 'informacion',
    label: 'Información General',
    fromName: 'Connection Worldwide Group',
    fromEmail: 'info@flowiadigital.com',
    replyTo: 'info@connectionworldwidegroup.com',
  },
  {
    id: 'citas',
    label: 'Confirmación de Citas',
    fromName: 'Connection Worldwide Group',
    fromEmail: 'citas@flowiadigital.com',
    replyTo: 'info@connectionworldwidegroup.com',
  },
]

export const DEFAULT_SENDER = EMAIL_SENDERS[0]

export function getSenderById(id: string): EmailSender {
  return EMAIL_SENDERS.find(s => s.id === id) ?? DEFAULT_SENDER
}
