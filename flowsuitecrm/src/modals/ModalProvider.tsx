import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import { CitaModal, type CitaForm } from '../modules/citas/CitaModal'
import type { MessagingChannel, MessagingContact } from '../types/messaging'

type AssignedOption = {
  id: string
  label: string
}

type MessageModalIntent = {
  channel: MessagingChannel
  contact: MessagingContact
  initialTemplateId?: string | null
}

type CitaModalIntent = {
  initialData?: Partial<CitaForm>
  assignedOptions?: AssignedOption[]
  onSaved?: (citaId?: string) => void
}

type ModalHostValue = {
  openMessageModal: (intent: MessageModalIntent) => void
  closeMessageModal: () => void
  openCitaModal: (intent: CitaModalIntent) => void
  closeCitaModal: () => void
}

const ModalHostContext = createContext<ModalHostValue | null>(null)

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [messageIntent, setMessageIntent] = useState<MessageModalIntent | null>(null)
  const [citaIntent, setCitaIntent] = useState<CitaModalIntent | null>(null)

  const openMessageModal = useCallback((intent: MessageModalIntent) => {
    setMessageIntent(intent)
  }, [])

  const closeMessageModal = useCallback(() => {
    setMessageIntent(null)
  }, [])

  const openCitaModal = useCallback((intent: CitaModalIntent) => {
    setCitaIntent(intent)
  }, [])

  const closeCitaModal = useCallback(() => {
    setCitaIntent(null)
  }, [])

  const value = useMemo<ModalHostValue>(() => ({
    openMessageModal,
    closeMessageModal,
    openCitaModal,
    closeCitaModal,
  }), [closeCitaModal, closeMessageModal, openCitaModal, openMessageModal])

  return (
    <ModalHostContext.Provider value={value}>
      {children}
      <MessageModal
        open={Boolean(messageIntent)}
        channel={messageIntent?.channel ?? 'whatsapp'}
        contact={messageIntent?.contact ?? null}
        initialTemplateId={messageIntent?.initialTemplateId}
        onClose={closeMessageModal}
      />
      <CitaModal
        open={Boolean(citaIntent)}
        onClose={closeCitaModal}
        onSaved={(citaId) => citaIntent?.onSaved?.(citaId)}
        initialData={citaIntent?.initialData}
        assignedOptions={citaIntent?.assignedOptions}
      />
    </ModalHostContext.Provider>
  )
}

export function useModalHost() {
  const context = useContext(ModalHostContext)
  if (!context) {
    throw new Error('useModalHost must be used within ModalProvider')
  }
  return context
}

export function useOptionalModalHost() {
  return useContext(ModalHostContext)
}
