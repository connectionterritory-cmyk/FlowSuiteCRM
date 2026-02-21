import { MessageModal } from './MessageModal'
import type { MessagingContact } from '../types/messaging'

type WhatsappTemplateModalProps = {
  open: boolean
  contact: MessagingContact | null
  onClose: () => void
}

export function WhatsappTemplateModal({ open, contact, onClose }: WhatsappTemplateModalProps) {
  return <MessageModal open={open} channel="whatsapp" contact={contact} onClose={onClose} />
}
