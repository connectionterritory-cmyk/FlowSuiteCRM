import { createElement, useCallback, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import type { MessagingChannel, MessagingContact } from '../types/messaging'
import { useOptionalModalHost } from '../modals/ModalProvider'

type ActiveMessage = {
  channel: MessagingChannel
  contact: MessagingContact
  templateId?: string
}

export function useMessaging() {
  const modalHost = useOptionalModalHost()
  const [activeMessage, setActiveMessage] = useState<ActiveMessage | null>(null)

  const openChannel = useCallback((channel: MessagingChannel, contact: MessagingContact, templateId?: string) => {
    if (modalHost) {
      modalHost.openMessageModal({ channel, contact, initialTemplateId: templateId ?? null })
      return
    }
    setActiveMessage({ channel, contact, templateId })
  }, [modalHost])

  const closeModal = useCallback(() => {
    if (modalHost) {
      modalHost.closeMessageModal()
      return
    }
    setActiveMessage(null)
  }, [modalHost])

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
    if (modalHost) {
      return function MessagingModalRenderer() {
        return null
      }
    }
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
  }, [activeMessage, closeModal, modalHost])

  return {
    openWhatsapp,
    openSms,
    openEmail,
    ModalRenderer,
  }
}
