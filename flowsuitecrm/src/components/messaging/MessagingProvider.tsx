import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { useToast } from '../useToast'
import type { MessagingChannel, MessagingContact, MessagingContextType } from '../../types/messaging'
import { resolveTemplate } from '../../lib/messagePlaceholders'
import { baseTemplates } from '../../lib/whatsappTemplates'
import { emailTemplates } from '../../lib/emailTemplates'
import { DEFAULT_SENDER, type EmailSender } from '../../lib/emailSenders'

const normalizePhone = (phone: string): string | null => {
  if (!phone) return null

  let digits = phone.replace(/\D/g, '')
  digits = digits.replace(/^0+/, '')

  if (digits.length === 10) digits = '1' + digits

  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits
  }

  return null
}

export type CloudTemplate = {
  id: string
  nombre: string
  cuerpo: string
  asunto: string | null
  canal: MessagingChannel | 'all'
  category: string
  scope: 'personal' | 'shared'
  is_system?: boolean | null
  owner_id?: string | null
  org_id?: string | null
}

export type UnifiedTemplate = {
  id: string
  label: string
  message: string
  subject?: string | null
  category: string
  channel: MessagingChannel
  source: 'system' | 'cloud'
  raw?: CloudTemplate
}

// Renamed to MessagingState to avoid shadowing the imported MessagingContextType union type
interface MessagingState {
  // State
  activeChannel: MessagingChannel
  contact: MessagingContact | null
  message: string
  subject: string
  attachmentUrls: string[]
  scheduledFor: string
  emailSender: EmailSender

  // Templates
  cloudTemplates: CloudTemplate[]
  systemTemplates: UnifiedTemplate[]
  loadingTemplates: boolean

  // Setters
  setActiveChannel: (channel: MessagingChannel) => void
  setMessage: (m: string) => void
  setSubject: (s: string) => void
  setAttachmentUrls: (urls: string[]) => void
  setScheduledFor: (date: string) => void
  setEmailSender: (sender: EmailSender) => void

  // Actions
  sendMessage: () => Promise<void>
  saveTemplate: (title: string, category: string, scope: 'personal' | 'shared') => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  resolveMessage: (template: string) => string
  refreshTemplates: () => Promise<void>

  // UI Helpers
  sending: boolean
  variables: Record<string, string>
}

const MessagingContext = createContext<MessagingState | undefined>(undefined)

export const useMessaging = () => {
  const context = useContext(MessagingContext)
  if (!context) throw new Error('useMessaging must be used within MessagingProvider')
  return context
}

export function MessagingProvider({
  children,
  initialChannel,
  initialContact,
  initialTemplateId,
  contextType,
  mkMessageId,
  onClose
}: {
  children: React.ReactNode
  initialChannel: MessagingChannel
  initialContact: MessagingContact | null
  initialTemplateId?: string | null
  contextType?: MessagingContextType
  mkMessageId?: string | null
  onClose?: () => void
}) {
  const { showToast } = useToast()
  const { session } = useAuth()
  const { currentUser } = useUsers()
  
  const [activeChannel, setActiveChannel] = useState<MessagingChannel>(initialChannel)
  const [message, setMessage] = useState('')
  const [subject, setSubject] = useState('')
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([])
  const [scheduledFor, setScheduledFor] = useState('')
  const [emailSender, setEmailSender] = useState<EmailSender>(DEFAULT_SENDER)
  const [cloudTemplates, setCloudTemplates] = useState<CloudTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [sending, setSending] = useState(false)

  const variables = useMemo(() => {
    const nombre = initialContact?.nombre?.split(' ')[0] || ''
    const currentUserName = [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(' ').trim()
    const organizacion = currentUser?.organizacion || 'Connection Worldwide Group'
    
    // Improved fallback for vendedor_nombre (matching stash logic)
    const vendedorNombre = 
      currentUserName || 
      initialContact?.responsableNombre || 
      initialContact?.vendedorNombre || 
      initialContact?.vendedor || 
      ''

    const vars: Record<string, string> = {
      cliente: nombre,
      nombre,
      vendedor_nombre: vendedorNombre,
      vendedor_telefono: currentUser?.telefono || '',
      organizacion,
      email: initialContact?.email || '',
      telefono: initialContact?.telefono || '',
      cuenta_hycite: initialContact?.cuentaHycite || '',
      saldo_actual: initialContact?.saldoActual?.toFixed(2) || '0.00',
      monto_moroso: initialContact?.montoMoroso?.toFixed(2) || '0.00',
      dias_atraso: String(initialContact?.diasAtraso || '0'),
      estado_morosidad: initialContact?.estadoMorosidad || '',
      fuente: initialContact?.fuente || '',
      programa: initialContact?.programa || '',
      ciudad: initialContact?.ciudad || '',
      cita_fecha: initialContact?.cita_fecha || '',
      cita_hora: initialContact?.cita_hora || '',
      cita_direccion: initialContact?.cita_direccion || '',
      equipo_nombre: initialContact?.equipo_nombre || '',
      equipo_serie: initialContact?.equipo_serie || '',
    }

    return vars
  }, [initialContact, currentUser])

  const resolveMessage = useCallback((template: string) => {
    // CORRECCIÓN: Extraer explícitamente la propiedad .text del objeto de resolución
    const result = resolveTemplate(template, variables)
    return typeof result === 'string' ? result : (result.text || '')
  }, [variables])

  const systemTemplates = useMemo<UnifiedTemplate[]>(() => {
    if (activeChannel === 'email') {
      return emailTemplates.map(t => ({
        id: `sys_email_${t.id}`,
        label: t.label,
        message: t.message,
        subject: t.subject,
        category: t.category,
        channel: 'email',
        source: 'system'
      }))
    }
    return baseTemplates.map(t => ({
      id: `sys_${t.id}`,
      label: t.label,
      message: t.message,
      category: t.category,
      channel: activeChannel,
      source: 'system'
    }))
  }, [activeChannel])

  const refreshTemplates = useCallback(async () => {
    if (!isSupabaseConfigured || !session?.user?.id) return
    setLoadingTemplates(true)
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('updated_at', { ascending: false })
      
      if (error) throw error
      setCloudTemplates(data as CloudTemplate[])
    } catch (err) {
      console.error('Error loading templates:', err)
    } finally {
      setLoadingTemplates(false)
    }
  }, [session])

  useEffect(() => {
    refreshTemplates()
  }, [refreshTemplates])

  useEffect(() => {
    if (!initialTemplateId) return
    const allTemplates: UnifiedTemplate[] = [
      ...systemTemplates,
      ...cloudTemplates.map((t) => ({
        id: t.id,
        label: t.nombre,
        message: t.cuerpo,
        subject: t.asunto ?? undefined,
        category: t.category,
        channel: (t.canal === 'all' ? activeChannel : t.canal) as MessagingChannel,
        source: 'cloud' as const,
        raw: t,
      })),
    ]
    const match = allTemplates.find((t) => t.id === initialTemplateId)
    if (!match) return
    setMessage(match.message)
    if (match.subject) setSubject(match.subject)
  // Solo correr cuando los templates terminen de cargar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId, loadingTemplates])

  const sendMessage = async () => {
    if (sending) return
    setSending(true)
    try {
      const resolved = resolveMessage(message)
      const isDirect = !scheduledFor

      // SMS: único canal que sigue usando la app nativa (no hay API)
      if (isDirect && activeChannel === 'sms') {
        const normalizedPhone = normalizePhone(initialContact?.telefono ?? '')
        if (!normalizedPhone) {
          showToast('Numero de telefono invalido', 'error')
          return
        }
        const smsRecipient = normalizedPhone.replace(/^\+/, '')
        const smsBody = encodeURIComponent(resolved.trim())
        const smsUrl = smsBody ? `sms:${smsRecipient}&body=${smsBody}` : `sms:${smsRecipient}`
        window.location.href = smsUrl
        showToast('Abriendo app de mensajes', 'success')
        if (onClose) onClose()
        return
      }

      // Para todos los demás canales: insertar en outbox y dejar que process-outbox envíe
      // scheduled_for = 1s atrás garantiza que process-outbox lo recoja inmediatamente
      const contactId = initialContact?.clienteId || initialContact?.leadId || null
      if (!contactId) {
        showToast('No se puede enviar: contacto sin ID registrado.', 'error')
        return
      }

      const scheduleTime = scheduledFor || new Date(Date.now() - 1000).toISOString()

      const { data: outboxRow, error: outboxError } = await supabase
        .from('outbox_messages')
        .insert({
          owner_id: session?.user.id,
          org_id: currentUser?.organizacion,
          contact_tipo: initialContact?.clienteId ? 'cliente' : 'lead',
          contact_id: contactId,
          contexto_tipo: contextType ?? 'ad_hoc',
          canal: activeChannel,
          destinatario: activeChannel === 'email' ? initialContact?.email : (initialContact?.telefono || initialContact?.telegramChatId),
          asunto: activeChannel === 'email' ? subject : null,
          mensaje: message,
          mensaje_resuelto: resolved,
          attachment_urls: attachmentUrls,
          from_email: activeChannel === 'email' ? emailSender.fromEmail : null,
          from_name: activeChannel === 'email' ? emailSender.fromName : null,
          reply_to: activeChannel === 'email' ? emailSender.replyTo : null,
          sender_name: activeChannel === 'email' ? variables.vendedor_nombre || null : null,
          status: 'programado',
          scheduled_for: scheduleTime,
          sent_at: null
        })
        .select('id')
        .single()

      if (outboxError) throw outboxError

      if (mkMessageId && outboxRow?.id) {
        const { error: linkError } = await supabase
          .from('mk_messages')
          .update({
            outbox_message_id: outboxRow.id,
            status: 'programado',
          })
          .eq('id', mkMessageId)
        if (linkError) {
          console.error('Link mk_messages error:', linkError)
          showToast('Mensaje en cola, pero no se pudo enlazar la campaña.', 'error')
        }
      }

      // Envío directo: invocar process-outbox para despachar ahora mismo
      if (isDirect) {
        const { error: processError } = await supabase.functions.invoke('process-outbox')
        if (processError) {
          showToast('Mensaje en cola, se enviará en breve')
          if (onClose) onClose()
          return
        }
      }

      showToast(scheduledFor ? 'Mensaje programado' : 'Mensaje enviado', 'success')
      if (onClose) onClose()
    } catch (err) {
      console.error('Send error:', err)
      showToast('Error al enviar mensaje', 'error')
    } finally {
      setSending(false)
    }
  }

  const saveTemplate = async (title: string, category: string, scope: 'personal' | 'shared') => {
    try {
      const { error } = await supabase
        .from('message_templates')
        .insert({
          owner_id: session?.user.id,
          org_id: currentUser?.organizacion,
          nombre: title,
          cuerpo: message,
          asunto: activeChannel === 'email' ? subject : null,
          canal: activeChannel,
          category,
          scope,
          attachment_urls: attachmentUrls
        })
      if (error) throw error
      showToast('Plantilla guardada', 'success')
      refreshTemplates()
    } catch (err) {
      showToast('Error al guardar plantilla', 'error')
    }
  }

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', id)
      if (error) throw error
      showToast('Plantilla eliminada', 'success')
      refreshTemplates()
    } catch (err) {
      showToast('Error al eliminar plantilla', 'error')
    }
  }

  return (
    <MessagingContext.Provider value={{
      activeChannel,
      contact: initialContact,
      message,
      subject,
      attachmentUrls,
      scheduledFor,
      emailSender,
      cloudTemplates,
      systemTemplates,
      loadingTemplates,
      setActiveChannel,
      setMessage,
      setSubject,
      setAttachmentUrls,
      setScheduledFor,
      setEmailSender,
      sendMessage,
      saveTemplate,
      deleteTemplate,
      resolveMessage,
      refreshTemplates,
      sending,
      variables
    }}>
      {children}
    </MessagingContext.Provider>
  )
}
