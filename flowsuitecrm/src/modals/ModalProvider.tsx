import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageModal } from '../components/MessageModal'
import {
  RegistrarGestionModal,
  type GestionRole,
} from '../components/RegistrarGestionModal'
import { CitaModal } from '../modules/citas/CitaModal'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useUsers } from '../data/useUsers'
import { useAuth } from '../auth/useAuth'
import { useViewMode } from '../data/useViewMode'
import {
  ModalHostContext,
  type CitaModalIntent,
  type GestionModalIntent,
  type MessageModalIntent,
  type ModalHostValue,
} from './ModalHostContext'
export { useModalHost, useOptionalModalHost } from './useModalHost'

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const { currentRole, currentUser } = useUsers()
  const { session } = useAuth()
  const { distributionUserIds, hasDistribuidorScope } = useViewMode()
  const [messageIntent, setMessageIntent] = useState<MessageModalIntent | null>(null)
  const [citaIntent, setCitaIntent] = useState<CitaModalIntent | null>(null)
  const [gestionIntent, setGestionIntent] = useState<GestionModalIntent | null>(null)
  const [assignedOptionsFallback, setAssignedOptionsFallback] = useState<{ id: string; label: string }[]>([])

  const sessionUserId = session?.user.id ?? null

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

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionUserId || !currentRole) {
      setAssignedOptionsFallback([])
      return
    }
    type UserRow = { id: string; nombre: string | null; apellido: string | null; email: string | null; rol: string | null }
    const toOption = (row: UserRow) => {
      const name = [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.email || row.id
      const rolLabel = row.rol ? ` · ${row.rol}` : ''
      return { id: row.id, label: `${name}${rolLabel}` }
    }
    const selfOption = currentUser ? toOption(currentUser as UserRow) : { id: sessionUserId, label: 'Yo' }

    let active = true
    const loadAssignedOptions = async () => {
      if (currentRole === 'admin' || currentRole === 'distribuidor') {
        let query = supabase
          .from('usuarios')
          .select('id, nombre, apellido, email, rol')
          .eq('activo', true)
        if (hasDistribuidorScope && distributionUserIds.length > 0) {
          query = query.in('id', distributionUserIds)
        }
        const { data, error } = await query
        if (!active) return
        if (error) {
          setAssignedOptionsFallback([selfOption])
          return
        }
        const options = (data ?? []).map((row) => toOption(row as UserRow))
        setAssignedOptionsFallback(options.length > 0 ? options : [selfOption])
        return
      }

      if (currentRole === 'telemercadeo') {
        const { data: assignments } = await supabase
          .from('tele_vendedor_assignments')
          .select('vendedor_id')
          .eq('tele_id', sessionUserId)
        const vendedorIds = (assignments ?? []).map((a: { vendedor_id: string }) => a.vendedor_id)
        if (vendedorIds.length > 0) {
          const { data: vendedores } = await supabase
            .from('usuarios')
            .select('id, nombre, apellido, email, rol')
            .in('id', vendedorIds)
            .eq('activo', true)
          if (!active) return
          const options = [
            selfOption,
            ...(vendedores ?? []).map((row) => toOption(row as UserRow)),
          ]
          setAssignedOptionsFallback(options)
          return
        }
      }

      if (currentRole === 'supervisor_telemercadeo') {
        const { data } = await supabase
          .from('usuarios')
          .select('id, nombre, apellido, email, rol')
          .eq('activo', true)
        if (!active) return
        const options = (data ?? []).map((row) => toOption(row as UserRow))
        setAssignedOptionsFallback(options.length > 0 ? options : [selfOption])
        return
      }

      setAssignedOptionsFallback([selfOption])
    }

    void loadAssignedOptions()
    return () => {
      active = false
    }
  }, [currentRole, currentUser, distributionUserIds, hasDistribuidorScope, sessionUserId])

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
        key={[
          messageIntent?.channel ?? 'none',
          messageIntent?.initialTemplateId ?? 'no-template',
          messageIntent?.contact?.clienteId ?? messageIntent?.contact?.leadId ?? 'no-contact',
          messageIntent?.contact?.montoCargoVuelta ?? 'no-cv-amount',
          messageIntent?.contact?.saldoOperativo ?? 'no-operating-balance',
        ].join(':')}
        open={Boolean(messageIntent)}
        channel={messageIntent?.channel ?? 'whatsapp'}
        contact={messageIntent?.contact ?? null}
        initialTemplateId={messageIntent?.initialTemplateId}
        contextType={messageIntent?.contextType}
        mkMessageId={messageIntent?.mkMessageId ?? null}
        ccEmails={messageIntent?.ccEmails}
        onClose={closeMessageModal}
      />
      <CitaModal
        open={Boolean(citaIntent)}
        onClose={closeCitaModal}
        onSaved={(citaId) => citaIntent?.onSaved?.(citaId)}
        initialData={citaIntent?.initialData}
        assignedOptions={
          citaIntent?.assignedOptions && citaIntent.assignedOptions.length > 0
            ? citaIntent.assignedOptions
            : assignedOptionsFallback
        }
      />
      <RegistrarGestionModal
        open={Boolean(gestionIntent)}
        role={currentGestionRole}
        contacto={gestionIntent?.contacto}
        tipoDefault={gestionIntent?.tipoDefault}
        moduloOrigen={gestionIntent?.moduloOrigen}
        origenId={gestionIntent?.origenId}
        onClose={closeGestionModal}
        onSendMessage={(contacto) => {
          closeGestionModal()
          openMessageModal({
            channel: 'whatsapp',
            contact: {
              nombre: contacto.nombre,
              telefono: contacto.telefono ?? null,
              email: contacto.email ?? null,
            },
          })
        }}
        onCreateCita={(contacto) => {
          const selfOption = currentUser
            ? [{
                id: currentUser.id,
                label: [currentUser.nombre, currentUser.apellido].filter(Boolean).join(' ') || currentUser.email || currentUser.id,
              }]
            : []
          const fallbackOptions = assignedOptionsFallback.length > 0 ? assignedOptionsFallback : selfOption
          openCitaModal({
            initialData: {
              contacto_tipo: contacto.tipo,
              contacto_id: contacto.id,
              contacto_nombre: contacto.nombre,
              contacto_telefono: contacto.telefono ?? '',
            },
            assignedOptions: fallbackOptions,
          })
        }}
        onSubmit={async (draft) => {
          await gestionIntent?.onSubmit?.(draft)
        }}
      />
    </ModalHostContext.Provider>
  )
}
