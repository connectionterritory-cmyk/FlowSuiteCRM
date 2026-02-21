import { createElement, useCallback, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import type { MessagingChannel, MessagingContact } from '../types/messaging'

type ActiveMessage = {
  channel: MessagingChannel
  contact: MessagingContact
}

export function useMessaging() {
  const [activeMessage, setActiveMessage] = useState<ActiveMessage | null>(null)

  const openChannel = useCallback((channel: MessagingChannel, contact: MessagingContact) => {
    setActiveMessage({ channel, contact })
  }, [])

  const closeModal = useCallback(() => {
    setActiveMessage(null)
  }, [])

  const openWhatsapp = useCallback(
    (contact: MessagingContact) => {
      openChannel('whatsapp', contact)
    },
    [openChannel]
  )

  const openSms = useCallback(
    (contact: MessagingContact) => {
      openChannel('sms', contact)
    },
    [openChannel]
  )

  const openEmail = useCallback(
    (contact: MessagingContact) => {
      openChannel('email', contact)
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
