import { useCallback, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import {
  RegistrarGestionModal,
  type GestionRole,
} from '../components/RegistrarGestionModal'
import { CitaModal } from '../modules/citas/CitaModal'
import { useUsers } from '../data/useUsers'
import {
  ModalHostContext,
  type CitaModalIntent,
  type GestionModalIntent,
  type MessageModalIntent,
  type ModalHostValue,
} from './ModalHostContext'

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
