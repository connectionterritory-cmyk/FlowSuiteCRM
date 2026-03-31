import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import {
  RegistrarGestionModal,
  type GestionContactoRef,
  type GestionDraft,
  type GestionRole,
  type GestionTipo,
} from '../components/RegistrarGestionModal'
import { CitaModal, type CitaForm } from '../modules/citas/CitaModal'
import type { MessagingChannel, MessagingContact } from '../types/messaging'
import { useUsers } from '../data/UsersProvider'

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

type GestionModalIntent = {
  contacto?: GestionContactoRef | null
  tipoDefault?: GestionTipo
  moduloOrigen?: string
  origenId?: string
  onSubmit?: (draft: GestionDraft) => void | Promise<void>
}

type ModalHostValue = {
  openMessageModal: (intent: MessageModalIntent) => void
  closeMessageModal: () => void
  openCitaModal: (intent: CitaModalIntent) => void
  closeCitaModal: () => void
  openGestionModal: (intent?: GestionModalIntent) => void
  closeGestionModal: () => void
}

const ModalHostContext = createContext<ModalHostValue | null>(null)

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const { currentRole } = useUsers()
  const [messageIntent, setMessageIntent] = useState<MessageModalIntent | null>(null)
  const [citaIntent, setCitaIntent] = useState<CitaModalIntent | null>(null)
  const [gestionIntent, setGestionIntent] = useState<GestionModalIntent | null>(null)

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

  const openGestionModal = useCallback((intent?: GestionModalIntent) => {
    setGestionIntent(intent ?? {})
  }, [])

  const closeGestionModal = useCallback(() => {
    setGestionIntent(null)
  }, [])

  const currentGestionRole: GestionRole = currentRole === 'admin' || currentRole === 'distribuidor' || currentRole === 'vendedor' || currentRole === 'telemercadeo'
    ? currentRole
    : 'vendedor'

  const value = useMemo<ModalHostValue>(() => ({
    openMessageModal,
    closeMessageModal,
    openCitaModal,
    closeCitaModal,
    openGestionModal,
    closeGestionModal,
  }), [closeCitaModal, closeGestionModal, closeMessageModal, openCitaModal, openGestionModal, openMessageModal])

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
      <RegistrarGestionModal
        open={Boolean(gestionIntent)}
        role={currentGestionRole}
        contacto={gestionIntent?.contacto}
        tipoDefault={gestionIntent?.tipoDefault}
        moduloOrigen={gestionIntent?.moduloOrigen}
        origenId={gestionIntent?.origenId}
        onClose={closeGestionModal}
        onSubmit={async (draft) => {
          await gestionIntent?.onSubmit?.(draft)
          closeGestionModal()
        }}
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
