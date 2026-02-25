import { createElement, useCallback, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import type { MessagingChannel, MessagingContact } from '../types/messaging'

type ActiveMessage = {
  channel: MessagingChannel
  contact: MessagingContact
  templateId?: string
}

export function useMessaging() {
  const [activeMessage, setActiveMessage] = useState<ActiveMessage | null>(null)

  const openChannel = useCallback((channel: MessagingChannel, contact: MessagingContact, templateId?: string) => {
    setActiveMessage({ channel, contact, templateId })
  }, [])

  const closeModal = useCallback(() => {
    setActiveMessage(null)
  }, [])

  const openWhatsapp = useCallback(
    (contact: MessagingContact, templateId?: string) => {
      openChannel('whatsapp', contact, templateId)
    },
    [openChannel]
  )

  const openSms = useCallback(
    (contact: MessagingContact, templateId?: string) => {
      openChannel('sms', contact, templateId)
    },
    [openChannel]
  )

  const openEmail = useCallback(
    (contact: MessagingContact, templateId?: string) => {
      openChannel('email', contact, templateId)
    },
    [openChannel]
  )

  const ModalRenderer = useMemo(() => {
    return function MessagingModalRenderer() {
      if (!activeMessage) return null
        return createElement(MessageModal, {
          open: true,
          channel: activeMessage.channel,
          contact: activeMessage.contact,
          initialTemplateId: activeMessage.templateId,
          onClose: closeModal,
        })
    }
  }, [activeMessage, closeModal])

  return {
    openWhatsapp,
    openSms,
    openEmail,
    ModalRenderer,
  }
}
