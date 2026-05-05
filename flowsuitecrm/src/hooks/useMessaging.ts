import { createElement, useCallback, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import type { MessagingChannel, MessagingContact, MessagingContextType } from '../types/messaging'
import { useOptionalModalHost } from '../modals/useModalHost'

type ActiveMessage = {
  channel: MessagingChannel
  contact: MessagingContact
  templateId?: string
  contextType?: MessagingContextType
  ccEmails?: string[]
}

export function useMessaging() {
  const modalHost = useOptionalModalHost()
  const [activeMessage, setActiveMessage] = useState<ActiveMessage | null>(null)

  const openChannel = useCallback((channel: MessagingChannel, contact: MessagingContact, templateId?: string, contextType?: MessagingContextType, ccEmails?: string[]) => {
    if (modalHost) {
      modalHost.openMessageModal({ channel, contact, initialTemplateId: templateId ?? null, contextType, ccEmails })
      return
    }
    setActiveMessage({ channel, contact, templateId, contextType, ccEmails })
  }, [modalHost])

  const closeModal = useCallback(() => {
    if (modalHost) {
      modalHost.closeMessageModal()
      return
    }
    setActiveMessage(null)
  }, [modalHost])

  const openWhatsapp = useCallback(
    (contact: MessagingContact, templateId?: string, contextType?: MessagingContextType) => {
      openChannel('whatsapp', contact, templateId, contextType)
    },
    [openChannel]
  )

  const openSms = useCallback(
    (contact: MessagingContact, templateId?: string, contextType?: MessagingContextType) => {
      openChannel('sms', contact, templateId, contextType)
    },
    [openChannel]
  )

  const openEmail = useCallback(
    (contact: MessagingContact, templateId?: string, contextType?: MessagingContextType, ccEmails?: string[]) => {
      openChannel('email', contact, templateId, contextType, ccEmails)
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
          contextType: activeMessage.contextType,
          ccEmails: activeMessage.ccEmails,
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
