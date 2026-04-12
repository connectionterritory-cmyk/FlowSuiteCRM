import { createContext } from 'react'
import type { CitaForm } from '../modules/citas/CitaModal'
import type { MessagingChannel, MessagingContact, MessagingContextType } from '../types/messaging'
import type { GestionContactoRef, GestionDraft, GestionTipo } from '../components/RegistrarGestionModal'

type AssignedOption = {
  id: string
  label: string
}

export type MessageModalIntent = {
  channel: MessagingChannel
  contact: MessagingContact
  initialTemplateId?: string | null
  contextType?: MessagingContextType
  mkMessageId?: string | null
}

export type CitaModalIntent = {
  initialData?: Partial<CitaForm>
  assignedOptions?: AssignedOption[]
  onSaved?: (citaId?: string) => void
}

export type GestionModalIntent = {
  contacto?: GestionContactoRef | null
  tipoDefault?: GestionTipo
  moduloOrigen?: string
  origenId?: string
  onSubmit?: (draft: GestionDraft) => void | Promise<void>
}

export type ModalHostValue = {
  openMessageModal: (intent: MessageModalIntent) => void
  closeMessageModal: () => void
  openCitaModal: (intent: CitaModalIntent) => void
  closeCitaModal: () => void
  openGestionModal: (intent?: GestionModalIntent) => void
  closeGestionModal: () => void
}

export const ModalHostContext = createContext<ModalHostValue | null>(null)
