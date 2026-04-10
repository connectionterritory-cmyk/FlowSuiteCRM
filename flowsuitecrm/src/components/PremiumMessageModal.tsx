import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import { InsertFieldDropdown } from './InsertFieldDropdown'
import {
  baseTemplates,
  buildWhatsappUrl,
} from '../lib/whatsappTemplates'
import { emailTemplates } from '../lib/emailTemplates'
import {
  canonicalizeTemplate,
  resolveTemplate,
} from '../lib/messagePlaceholders'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useToast } from './useToast'
import type { MessagingChannel, MessagingContact } from '../types/messaging'
import { useUsers } from '../data/useUsers'
import { useAuth } from '../auth/useAuth'
import { getMessagingContactRef } from '../lib/contactRefs'
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  deleteTemplate,
  saveOutboxMessage,
  type MessageTemplate,
} from '../lib/messageTemplatesService'
import {
  fetchContactHistory,
  CANAL_ICON,
  formatHistoryDate,
  type HistoryEntry,
} from '../lib/contactHistoryService'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type PremiumMessageModalProps = {
  open: boolean
  channel: MessagingChannel
  contact: MessagingContact | null
  initialTemplateId?: string | null
  onClose: () => void
}

type ViewTab = 'composer' | 'preview'

type EditingTemplate = {
  id: string
  nombre: string
  cuerpo: string
  asunto: string
  category: string
  scope: 'personal' | 'shared'
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const sanitizePhone = (value: string) => value.replace(/\D/g, '')

const firstName = (value?: string | null) => {
  if (!value) return ''
  return value.trim().split(/\s+/)[0] ?? ''
}

const formatAmount = (value?: number | string | null) => {
  if (value === null || value === undefined) return ''
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : value
  return Number.isNaN(n) ? '' : n.toFixed(2)
}

const CHANNEL_ICONS: Record<MessagingChannel, string> = {
  whatsapp: '💬',
  sms: '📱',
  email: '✉️',
  telegram: '📩',
}

const CHANNEL_LABELS: Record<MessagingChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  telegram: 'Telegram',
}

// WhatsApp preview renderer — bolds *text*, italics _text_
function renderWhatsappText(text: string): string {
  return text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function PremiumMessageModal({
  open,
  channel,
  contact,
  initialTemplateId,
  onClose,
}: PremiumMessageModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { currentUser } = useUsers()
  const { session } = useAuth()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Contact resolution ─────────────────────────────────────
  const resolvedContact = useMemo<MessagingContact>(() => {
    if (!contact) return { nombre: '', telefono: null, email: null, vendedor: '' }
    const raw = contact as MessagingContact & Record<string, unknown>
    return {
      ...contact,
      cuentaHycite:
        contact.cuentaHycite ??
        (raw.hycite_id as string | null | undefined) ??
        (raw.cuenta_hycite as string | null | undefined) ??
        null,
      saldoActual:
        contact.saldoActual ??
        (raw.saldo_actual != null ? Number(raw.saldo_actual) : null),
      montoMoroso:
        contact.montoMoroso ??
        (raw.monto_moroso != null ? Number(raw.monto_moroso) : null),
      diasAtraso:
        contact.diasAtraso ??
        (raw.dias_atraso as number | null | undefined) ??
        null,
      estadoMorosidad:
        contact.estadoMorosidad ??
        (raw.estado_morosidad as string | null | undefined) ??
        null,
    }
  }, [contact])

  const [hydratedContact, setHydratedContact] = useState<MessagingContact | null>(null)
  const activeContact = hydratedContact ?? resolvedContact

  // ── Core state ─────────────────────────────────────────────
  const [activeChannel, setActiveChannel] = useState<MessagingChannel>(channel)
  const [viewTab, setViewTab] = useState<ViewTab>('composer')
  const [message, setMessage] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [sending, setSending] = useState(false)

  // ── Cloud templates ────────────────────────────────────────
  const [cloudTemplates, setCloudTemplates] = useState<MessageTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  // Template editing inline
  const [editingTemplate, setEditingTemplate] = useState<EditingTemplate | null>(null)

  // New template form
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateCategory, setNewTemplateCategory] = useState('general')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false)

  // Replace-or-keep dialog
  const [pendingTemplate, setPendingTemplate] = useState<{
    id: string
    cuerpo: string
    asunto?: string | null
  } | null>(null)

  // ── History ────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // ── Schedule ───────────────────────────────────────────────
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')

  // ── Distributor phone ──────────────────────────────────────
  const [distributorPhone, setDistributorPhone] = useState('')
  const [useEvolutionApi, setUseEvolutionApi] = useState(false)

  // ─────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────
  const COBRANZAS_PHONE = '7862913042'
  const variables = useMemo(() => {
    const cliente = firstName(activeContact.nombre)
    const currentUserName = [currentUser?.nombre, currentUser?.apellido]
      .filter(Boolean)
      .join(' ')
      .trim()
    const vendedorNombre =
      activeContact.vendedorNombre ??
      activeContact.vendedor ??
      activeContact.responsableNombre ??
      currentUserName
    const vendedorTelefonoBase =
      activeContact.vendedorTelefono ?? distributorPhone ?? currentUser?.telefono ?? ''
    const vendedorTelefono =
      activeContact.estadoMorosidad != null ? COBRANZAS_PHONE : vendedorTelefonoBase
    return {
      cliente,
      nombre: cliente,
      telefono: activeContact.telefono ?? '',
      vendedor_nombre: vendedorNombre,
      vendedor_telefono: vendedorTelefono,
      responsable_nombre:
        activeContact.responsableNombre ?? currentUserName,
      recomendado_por_nombre:
        activeContact.recomendadoPorNombre ?? activeContact.recomendadoPor ?? '',
      email: activeContact.email ?? '',
      organizacion: currentUser?.organizacion ?? '',
      cuenta_hycite: activeContact.cuentaHycite ?? '',
      saldo_actual: formatAmount(activeContact.saldoActual),
      monto_moroso: formatAmount(activeContact.montoMoroso),
      dias_atraso:
        activeContact.diasAtraso != null ? String(activeContact.diasAtraso) : '',
      estado_morosidad: activeContact.estadoMorosidad ?? '',
      fuente: activeContact.fuente ?? '',
      programa: activeContact.programa ?? '',
      ciudad: activeContact.ciudad ?? '',
    }
  }, [activeContact, currentUser, distributorPhone])

  const resolvedMessage = useMemo(
    () => resolveTemplate(message, variables),
    [message, variables]
  )
  const missingVars = resolvedMessage.missing
  const charCount = message.length
  const charOver = charCount > 1024
  const smsSegments = Math.ceil(charCount / 160) || 1

  const phoneValue = activeContact.telefono ? sanitizePhone(activeContact.telefono) : ''
  const hasPhone = phoneValue.length > 0
  const hasEmail = Boolean(activeContact.email?.trim())
  const canSend =
    Boolean(contact) &&
    message.trim().length > 0 &&
    !charOver &&
    (activeChannel === 'email' ? hasEmail : hasPhone)

  // All templates merged: system + cloud
  const allTemplates = useMemo<(MessageTemplate & { isSystem?: boolean })[]>(() => {
    const systemAsCloud: (MessageTemplate & { isSystem?: boolean })[] = baseTemplates
      .filter(() => activeChannel !== 'email')
      .map((tmpl) => ({
        id: tmpl.id,
        owner_id: '',
        org_id: null,
        canal: 'whatsapp' as const,
        nombre: tmpl.label,
        asunto: null,
        cuerpo: tmpl.message,
        category: tmpl.category,
        scope: 'shared' as const,
        is_system: true,
        isSystem: true,
        created_at: '',
        updated_at: '',
      }))

    const emailAsCloud: (MessageTemplate & { isSystem?: boolean })[] =
      activeChannel === 'email'
        ? emailTemplates.map((tmpl) => ({
            id: tmpl.id,
            owner_id: '',
            org_id: null,
            canal: 'email' as const,
            nombre: tmpl.label,
            asunto: tmpl.subject,
            cuerpo: tmpl.message,
            category: tmpl.category,
            scope: 'shared' as const,
            is_system: true,
            isSystem: true,
            created_at: '',
            updated_at: '',
          }))
        : []

    const cloudFiltered = cloudTemplates.filter(
      (tmpl) => tmpl.canal === activeChannel || tmpl.canal === 'all'
    )

    // cloud templates override system templates with same id
    const systemIds = new Set(cloudFiltered.map((tmpl) => tmpl.id))
    const baseToShow = activeChannel === 'email' ? emailAsCloud : systemAsCloud
    return [
      ...baseToShow.filter((tmpl) => !systemIds.has(tmpl.id)),
      ...cloudFiltered,
    ]
  }, [cloudTemplates, activeChannel])

  const filteredTemplates = useMemo(() => {
    let list = allTemplates
    if (categoryFilter !== 'all') {
      list = list.filter((tmpl) => tmpl.category === categoryFilter)
    }
    if (templateSearch.trim()) {
      const q = templateSearch.toLowerCase()
      list = list.filter(
        (t) =>
          t.nombre.toLowerCase().includes(q) ||
          t.cuerpo.toLowerCase().includes(q)
      )
    }
    return list
  }, [allTemplates, categoryFilter, templateSearch])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    allTemplates.forEach((t) => seen.add(t.category))
    return Array.from(seen)
  }, [allTemplates])

  // ─────────────────────────────────────────────────────────
  // Effects
  // ─────────────────────────────────────────────────────────

  // Reset when modal closes
  useEffect(() => {
    if (open) return
    setMessage('')
    setEmailSubject('')
    setSelectedTemplateId(null)
    setViewTab('composer')
    setShowSchedule(false)
    setScheduleDate('')
    setScheduleTime('')
    setShowNewTemplateForm(false)
    setNewTemplateName('')
    setPendingTemplate(null)
    setEditingTemplate(null)
  }, [open])

  // Sync channel
  useEffect(() => {
    if (open) setActiveChannel(channel)
  }, [channel, open])

  // Load cloud templates
  useEffect(() => {
    if (!open || !isSupabaseConfigured || !session?.user.id) return
    setLoadingTemplates(true)
    fetchTemplates()
      .then(setCloudTemplates)
      .catch(() => showToast('Error al cargar plantillas', 'error'))
      .finally(() => setLoadingTemplates(false))
  }, [open, session?.user.id, showToast])

  // Load history
  useEffect(() => {
    if (!open || !isSupabaseConfigured) return
    const clienteId = resolvedContact.clienteId
    const leadId = resolvedContact.leadId
    if (!clienteId && !leadId) return
    setLoadingHistory(true)
    fetchContactHistory(clienteId, leadId)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }, [open, resolvedContact.clienteId, resolvedContact.leadId])

  // Hydrate contact data
  useEffect(() => {
    setHydratedContact(null)
    if (!open || !isSupabaseConfigured) return
    const clienteId = resolvedContact.clienteId
    const needsHydration =
      resolvedContact.saldoActual == null ||
      resolvedContact.montoMoroso == null ||
      resolvedContact.diasAtraso == null ||
      resolvedContact.estadoMorosidad == null ||
      !resolvedContact.cuentaHycite
    if (!needsHydration) return
    let cancelled = false
    const load = async () => {
      let data: unknown = null
      if (clienteId) {
        const resp = await supabase
          .from('clientes')
          .select('saldo_actual,monto_moroso,dias_atraso,estado_morosidad,hycite_id')
          .eq('id', clienteId)
          .maybeSingle()
        data = resp.data ?? null
      }
      if (!data) {
        const rawPhone = resolvedContact.telefono ?? ''
        const phoneDigits = sanitizePhone(rawPhone)
        if (phoneDigits.length >= 7) {
          const resp = await supabase
            .from('clientes')
            .select('saldo_actual,monto_moroso,dias_atraso,estado_morosidad,hycite_id')
            .or(`telefono.ilike.%${phoneDigits}%,telefono_casa.ilike.%${phoneDigits}%`)
            .limit(1)
            .maybeSingle()
          data = resp.data ?? null
        }
      }
      if (cancelled || !data) return
      const row = data as Record<string, unknown>
      setHydratedContact({
        ...resolvedContact,
        saldoActual:
          resolvedContact.saldoActual ??
          (row.saldo_actual != null ? Number(row.saldo_actual) : null),
        montoMoroso:
          resolvedContact.montoMoroso ??
          (row.monto_moroso != null ? Number(row.monto_moroso) : null),
        diasAtraso:
          resolvedContact.diasAtraso ?? (row.dias_atraso as number | null | undefined) ?? null,
        estadoMorosidad:
          resolvedContact.estadoMorosidad ??
          (row.estado_morosidad as string | null | undefined) ??
          null,
        cuentaHycite:
          resolvedContact.cuentaHycite ?? (row.hycite_id as string | null | undefined) ?? null,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, resolvedContact])

  // Load distributor phone
  useEffect(() => {
    if (!open) return
    if (!isSupabaseConfigured) {
      setDistributorPhone(currentUser?.telefono ?? '')
      return
    }
    void supabase
      .rpc('get_distributor_phone')
      .then(({ data, error }) => {
        if (error) {
          setDistributorPhone(currentUser?.telefono ?? '')
          return
        }
        const ph = (data as string | null) ?? ''
        setDistributorPhone(ph.trim() || currentUser?.telefono || '')
      })
  }, [open, currentUser])

  // Apply initialTemplateId on open
  useEffect(() => {
    if (!open || !initialTemplateId) return
    const found = allTemplates.find((tmpl) => tmpl.id === initialTemplateId)
    if (found) {
      setSelectedTemplateId(found.id)
      setMessage(canonicalizeTemplate(found.cuerpo))
      if (found.asunto) setEmailSubject(found.asunto)
    }
  }, [open, initialTemplateId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────

  const insertVariable = useCallback(
    (token: string) => {
      const ta = textareaRef.current
      if (!ta) {
        setMessage((prev) => prev + token)
        return
      }
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = message.slice(0, start) + token + message.slice(end)
      setMessage(next)
      setTimeout(() => {
        ta.focus()
        ta.setSelectionRange(start + token.length, start + token.length)
      }, 0)
    },
    [message]
  )

  const handleSelectTemplate = useCallback(
    (tmpl: MessageTemplate & { isSystem?: boolean }) => {
      const hasContent = message.trim().length > 0
      if (hasContent && tmpl.id !== selectedTemplateId) {
        setPendingTemplate({
          id: tmpl.id,
          cuerpo: tmpl.cuerpo,
          asunto: tmpl.asunto,
        })
        return
      }
      setSelectedTemplateId(tmpl.id)
      setMessage(canonicalizeTemplate(tmpl.cuerpo))
      if (tmpl.asunto) setEmailSubject(resolveTemplate(tmpl.asunto, variables).text)
    },
    [message, selectedTemplateId, variables]
  )

  const applyPendingTemplate = (action: 'replace' | 'keep') => {
    if (!pendingTemplate) return
    if (action === 'replace') {
      setMessage(canonicalizeTemplate(pendingTemplate.cuerpo))
      if (pendingTemplate.asunto)
        setEmailSubject(resolveTemplate(pendingTemplate.asunto, variables).text)
    } else {
      // 'keep' — insert template cuerpo below existing text
      setMessage((prev) =>
        prev.trim() + '\n\n' + canonicalizeTemplate(pendingTemplate.cuerpo)
      )
    }
    setSelectedTemplateId(pendingTemplate.id)
    setPendingTemplate(null)
  }

  const handleSaveNewTemplate = async () => {
    if (!newTemplateName.trim() || !message.trim()) return
    if (!session?.user.id) { showToast('Inicia sesión para guardar plantillas', 'error'); return }
    setSavingTemplate(true)
    try {
      const created = await createTemplate(session.user.id, currentUser?.organizacion ?? null, {
        canal: activeChannel,
        nombre: newTemplateName,
        asunto: activeChannel === 'email' ? emailSubject : undefined,
        cuerpo: message,
        category: newTemplateCategory,
        scope: 'personal',
      })
      setCloudTemplates((prev) => [created, ...prev])
      setSelectedTemplateId(created.id)
      setNewTemplateName('')
      setShowNewTemplateForm(false)
      showToast('Plantilla guardada en la nube')
    } catch {
      showToast('Error al guardar plantilla', 'error')
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleStartEdit = (tmpl: MessageTemplate) => {
    setEditingTemplate({
      id: tmpl.id,
      nombre: tmpl.nombre,
      cuerpo: tmpl.cuerpo,
      asunto: tmpl.asunto ?? '',
      category: tmpl.category,
      scope: tmpl.scope,
    })
  }

  const handleSaveEdit = async () => {
    if (!editingTemplate) return
    try {
      const updated = await updateTemplate(editingTemplate.id, {
        nombre: editingTemplate.nombre,
        cuerpo: editingTemplate.cuerpo,
        asunto: editingTemplate.asunto || null,
        category: editingTemplate.category,
        scope: editingTemplate.scope,
      })
      setCloudTemplates((prev) =>
        prev.map((tmpl) => (tmpl.id === updated.id ? updated : tmpl))
      )
      if (selectedTemplateId === updated.id) {
        setMessage(canonicalizeTemplate(updated.cuerpo))
      }
      setEditingTemplate(null)
      showToast('Plantilla actualizada')
    } catch {
      showToast('Error al actualizar plantilla', 'error')
    }
  }

  const handleDuplicateTemplate = async (tmpl: MessageTemplate) => {
    if (!session?.user.id) return
    try {
      const dup = await duplicateTemplate(
        session.user.id,
        currentUser?.organizacion ?? null,
        tmpl
      )
      setCloudTemplates((prev) => [dup, ...prev])
      showToast('Plantilla duplicada')
    } catch {
      showToast('Error al duplicar', 'error')
    }
  }

  const handleDeleteTemplate = async (tmpl: MessageTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla "${tmpl.nombre}"?`)) return
    try {
      await deleteTemplate(tmpl.id)
      setCloudTemplates((prev) => prev.filter((item) => item.id !== tmpl.id))
      if (selectedTemplateId === tmpl.id) {
        setSelectedTemplateId(null)
        setMessage('')
      }
      showToast('Plantilla eliminada')
    } catch {
      showToast('Error al eliminar', 'error')
    }
  }

  // ── CRM logging ──────────────────────────────────────────

  const buildSenderName = useCallback(() => {
    return [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(' ').trim() ||
      currentUser?.email || ''
  }, [currentUser])

  const saveMessageLog = useCallback(
    async (finalMessage: string, sentAt: string) => {
      if (!isSupabaseConfigured) return
      const senderId = session?.user.id ?? null
      const senderName = buildSenderName()
      const summary = `Mensaje ${CHANNEL_LABELS[activeChannel]}${senderName ? ` por ${senderName}` : ''}.`
      const contactRef = getMessagingContactRef(activeContact)

      if (contactRef?.contacto_tipo === 'cliente') {
        await supabase.from('notasrp').insert({
          cliente_id: contactRef.contacto_id,
          contenido: summary,
          canal: activeChannel,
          enviado_por: senderId,
          enviado_en: sentAt,
          mensaje: finalMessage,
        })
      }
      if (contactRef?.contacto_tipo === 'lead' && senderId) {
        await supabase.from('lead_notas').insert({
          lead_id: contactRef.contacto_id,
          usuario_id: senderId,
          nota: summary,
          tipo: 'mensajeria',
          canal: activeChannel,
          mensaje: finalMessage,
        })
      }
    },
    [activeChannel, activeContact, buildSenderName, session?.user.id]
  )

  const updateLeadContact = useCallback(async () => {
    const contactRef = getMessagingContactRef(activeContact)
    if (contactRef?.contacto_tipo !== 'lead') return
    await supabase
      .from('leads')
      .update({ estado_pipeline: 'contactado', whatsapp_mensaje_enviado_at: new Date().toISOString() })
      .eq('id', contactRef.contacto_id)
  }, [activeContact])

  // ── Send ─────────────────────────────────────────────────

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    const finalMessage = resolvedMessage.text
    const sentAt = new Date().toISOString()
    const contactRef = getMessagingContactRef(activeContact)

    try {
      if (activeChannel === 'whatsapp') {
        if (useEvolutionApi && isSupabaseConfigured) {
          const { data, error } = await supabase.functions.invoke('send-whatsapp', {
            body: { phone: phoneValue, message: finalMessage },
          })
          if (error) throw error
          if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error)
          showToast('Mensaje enviado por WhatsApp')
        } else {
          const url = activeContact.telefono ? buildWhatsappUrl(activeContact.telefono, finalMessage) : null
          if (url) window.open(url, '_blank', 'noopener,noreferrer')
        }
      }

      if (activeChannel === 'sms' && hasPhone) {
        window.open(`sms:${phoneValue}?&body=${encodeURIComponent(finalMessage)}`, '_blank', 'noopener,noreferrer')
      }

      if (activeChannel === 'telegram' && hasPhone) {
        window.open(`https://t.me/${phoneValue}`, '_blank', 'noopener,noreferrer')
      }

      if (activeChannel === 'email' && hasEmail && activeContact.email) {
        if (!isSupabaseConfigured || !session?.access_token) {
          showToast('Configura Supabase e inicia sesión para enviar correos.', 'error')
          return
        }
        const { data, error } = await supabase.functions.invoke('send-message-email', {
          body: {
            to: activeContact.email,
            subject: emailSubject.trim() || t('messaging.emailSubject'),
            message: finalMessage,
            contactName: activeContact.nombre,
            replyTo: currentUser?.email ?? null,
            senderName: buildSenderName() || null,
          },
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (error || (data as { error?: string } | null)?.error) {
          const msg = (error as { message?: string } | null)?.message || (data as { error?: string } | null)?.error || 'No se pudo enviar el correo.'
          showToast(msg, 'error')
          return
        }
        showToast('Correo enviado')
      }

      // Save to CRM
      await saveMessageLog(finalMessage, sentAt)
      await updateLeadContact()

      // Save to outbox as 'enviado'
      if (isSupabaseConfigured && session?.user.id) {
        await saveOutboxMessage({
          owner_id: session.user.id,
          org_id: currentUser?.organizacion ?? null,
          contact_tipo: contactRef?.contacto_tipo ?? null,
          contact_id: contactRef?.contacto_id ?? null,
          canal: activeChannel,
          destinatario: activeChannel === 'email' ? (activeContact.email ?? null) : phoneValue || null,
          asunto: activeChannel === 'email' ? emailSubject.trim() || null : null,
          mensaje: message,
          mensaje_resuelto: finalMessage,
          template_id: (selectedTemplateId && !allTemplates.find(t => t.id === selectedTemplateId)?.isSystem)
            ? selectedTemplateId
            : null,
          status: 'enviado',
        }).catch(() => {})
      }

      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al enviar', 'error')
    } finally {
      setSending(false)
    }
  }

  // ── Schedule ─────────────────────────────────────────────

  const handleSchedule = async () => {
    if (!scheduleDate || !scheduleTime) {
      showToast('Selecciona fecha y hora para programar', 'error')
      return
    }
    if (!session?.user.id) { showToast('Inicia sesión para programar envíos', 'error'); return }
    const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString()
    const finalMessage = resolvedMessage.text
    const contactRef = getMessagingContactRef(activeContact)

    setSending(true)
    try {
      await saveOutboxMessage({
        owner_id: session.user.id,
        org_id: currentUser?.organizacion ?? null,
        contact_tipo: contactRef?.contacto_tipo ?? null,
        contact_id: contactRef?.contacto_id ?? null,
        canal: activeChannel,
        destinatario: activeChannel === 'email' ? (activeContact.email ?? null) : phoneValue || null,
        asunto: activeChannel === 'email' ? emailSubject.trim() || null : null,
        mensaje: message,
        mensaje_resuelto: finalMessage,
        template_id: (selectedTemplateId && !allTemplates.find(t => t.id === selectedTemplateId)?.isSystem)
          ? selectedTemplateId
          : null,
        status: 'programado',
        scheduled_for: scheduledFor,
      })
      showToast(`Mensaje programado para ${new Date(scheduledFor).toLocaleString('es')}`)
      onClose()
    } catch {
      showToast('Error al programar envío', 'error')
    } finally {
      setSending(false)
    }
  }

  // ── Save draft ────────────────────────────────────────────

  const handleSaveDraft = async () => {
    if (!message.trim() || !session?.user.id) return
    const contactRef = getMessagingContactRef(activeContact)
    try {
      await saveOutboxMessage({
        owner_id: session.user.id,
        org_id: currentUser?.organizacion ?? null,
        contact_tipo: contactRef?.contacto_tipo ?? null,
        contact_id: contactRef?.contacto_id ?? null,
        canal: activeChannel,
        destinatario: activeChannel === 'email' ? (activeContact.email ?? null) : phoneValue || null,
        asunto: activeChannel === 'email' ? emailSubject.trim() || null : null,
        mensaje: message,
        mensaje_resuelto: resolvedMessage.text,
        template_id: null,
        status: 'borrador',
      })
      showToast('Borrador guardado')
    } catch {
      showToast('Error al guardar borrador', 'error')
    }
  }

  // ─────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────

  const renderContactPanel = () => (
    <div className="pmm-contact-card">
      <div className="pmm-contact-name">{activeContact.nombre || 'Contacto'}</div>
      <div className="pmm-contact-meta">
        {hasPhone && (
          <span className="pmm-contact-chip">📱 {activeContact.telefono}</span>
        )}
        {hasEmail && (
          <span className="pmm-contact-chip">✉️ {activeContact.email}</span>
        )}
        {activeContact.ciudad && (
          <span className="pmm-contact-chip">📍 {activeContact.ciudad}</span>
        )}
      </div>
      {(activeContact.saldoActual != null || activeContact.montoMoroso != null) && (
        <div className="pmm-contact-meta" style={{ marginTop: '4px' }}>
          {activeContact.saldoActual != null && (
            <span className="pmm-contact-chip" style={{ color: '#10b981' }}>
              Saldo ${formatAmount(activeContact.saldoActual)}
            </span>
          )}
          {activeContact.montoMoroso != null && Number(activeContact.montoMoroso) > 0 && (
            <span className="pmm-contact-chip" style={{ color: '#f59e0b' }}>
              Moroso ${formatAmount(activeContact.montoMoroso)}
            </span>
          )}
        </div>
      )}
      {(activeContact.vendedorNombre ?? activeContact.vendedor) && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          Responsable: {activeContact.vendedorNombre ?? activeContact.vendedor}
        </div>
      )}
    </div>
  )

  const renderHistory = () => (
    <div className="pmm-history">
      <button
        type="button"
        className="pmm-history-toggle"
        onClick={() => setHistoryOpen((v) => !v)}
      >
        <span>Historial reciente</span>
        <span>{historyOpen ? '▲' : '▼'} {history.length > 0 ? `(${history.length})` : ''}</span>
      </button>
      {historyOpen && (
        <div className="pmm-history-list">
          {loadingHistory && (
            <div className="pmm-history-empty">Cargando...</div>
          )}
          {!loadingHistory && history.length === 0 && (
            <div className="pmm-history-empty">Sin mensajes previos</div>
          )}
          {history.map((entry) => (
            <div key={entry.id} className="pmm-history-item">
              <div className="pmm-history-header">
                <span>{CANAL_ICON[entry.canal] ?? '💬'} {entry.canal}</span>
                <span className="pmm-history-date">
                  {formatHistoryDate(entry.enviado_en ?? entry.created_at)}
                </span>
              </div>
              <div className="pmm-history-text">
                {(entry.mensaje ?? entry.contenido ?? '').slice(0, 100)}
                {(entry.mensaje ?? entry.contenido ?? '').length > 100 ? '…' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderTemplateList = () => (
    <div className="pmm-template-section">
      <div className="pmm-section-label">Plantillas</div>

      {/* Search */}
      <input
        value={templateSearch}
        onChange={(e) => setTemplateSearch(e.target.value)}
        placeholder="Buscar plantilla..."
        className="pmm-search"
      />

      {/* Category filter pills */}
      <div className="pmm-category-pills">
        <button
          type="button"
          className={`pmm-pill ${categoryFilter === 'all' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          Todas
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`pmm-pill ${categoryFilter === cat ? 'active' : ''}`}
            onClick={() => setCategoryFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template items */}
      <div className="pmm-template-list">
        {loadingTemplates && (
          <div className="pmm-empty">Cargando plantillas...</div>
        )}
        {!loadingTemplates && filteredTemplates.length === 0 && (
          <div className="pmm-empty">Sin plantillas en esta categoría.</div>
        )}
        {filteredTemplates.map((tmpl) =>
          editingTemplate?.id === tmpl.id ? (
            <div key={tmpl.id} className="pmm-template-edit">
              <input
                value={editingTemplate.nombre}
                onChange={(e) => setEditingTemplate((p) => p && { ...p, nombre: e.target.value })}
                placeholder="Nombre..."
                className="pmm-edit-input"
              />
              {activeChannel === 'email' && (
                <input
                  value={editingTemplate.asunto}
                  onChange={(e) => setEditingTemplate((p) => p && { ...p, asunto: e.target.value })}
                  placeholder="Asunto..."
                  className="pmm-edit-input"
                />
              )}
              <textarea
                rows={3}
                value={editingTemplate.cuerpo}
                onChange={(e) => setEditingTemplate((p) => p && { ...p, cuerpo: e.target.value })}
                className="pmm-edit-textarea"
              />
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="pmm-link-btn"
                  onClick={() => setEditingTemplate(null)}
                >
                  Cancelar
                </button>
                <Button type="button" onClick={handleSaveEdit} disabled={!editingTemplate.nombre.trim()}>
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <div
              key={tmpl.id}
              className={`pmm-template-item ${selectedTemplateId === tmpl.id ? 'active' : ''}`}
              onClick={() => handleSelectTemplate(tmpl)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleSelectTemplate(tmpl)
                }
              }}
            >
              <div className="pmm-template-item-header">
                <span className="pmm-template-name">{tmpl.nombre}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className={`pmm-badge ${tmpl.isSystem ? 'system' : tmpl.scope === 'shared' ? 'shared' : 'personal'}`}>
                    {tmpl.isSystem ? 'Sistema' : tmpl.scope === 'shared' ? 'Equipo' : 'Personal'}
                  </span>
                  {!tmpl.isSystem && (
                    <>
                      <button
                        type="button"
                        title="Editar"
                        className="pmm-icon-btn"
                        onClick={(e) => { e.stopPropagation(); handleStartEdit(tmpl as MessageTemplate) }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Duplicar"
                        className="pmm-icon-btn"
                        onClick={(e) => { e.stopPropagation(); void handleDuplicateTemplate(tmpl as MessageTemplate) }}
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        title="Eliminar"
                        className="pmm-icon-btn danger"
                        onClick={(e) => { e.stopPropagation(); void handleDeleteTemplate(tmpl as MessageTemplate) }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="pmm-template-snippet">
                {resolveTemplate(tmpl.cuerpo, variables).text.slice(0, 80)}
                {tmpl.cuerpo.length > 80 ? '…' : ''}
              </div>
            </div>
          )
        )}
      </div>

      {/* New template form */}
      {showNewTemplateForm ? (
        <div className="pmm-new-template-form">
          <input
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
            placeholder="Nombre de la plantilla..."
            className="pmm-edit-input"
          />
          <select
            value={newTemplateCategory}
            onChange={(e) => setNewTemplateCategory(e.target.value)}
            className="pmm-select"
          >
            {['general', 'seguimiento', 'cartera', 'referidos', 'cumpleanos', 'citas', 'servicio', 'campana'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button type="button" className="pmm-link-btn" onClick={() => setShowNewTemplateForm(false)}>
              Cancelar
            </button>
            <Button
              type="button"
              onClick={() => void handleSaveNewTemplate()}
              disabled={!newTemplateName.trim() || !message.trim() || savingTemplate}
            >
              {savingTemplate ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="pmm-save-btn"
          onClick={() => setShowNewTemplateForm(true)}
          disabled={!message.trim()}
        >
          + Guardar mensaje como plantilla
        </button>
      )}
    </div>
  )

  const renderPreview = () => {
    const text = resolvedMessage.text
    if (activeChannel === 'whatsapp') {
      return (
        <div className="pmm-preview-bubble">
          <div
            className="pmm-preview-whatsapp"
            dangerouslySetInnerHTML={{ __html: renderWhatsappText(text) }}
          />
          <div className="pmm-preview-time">
            {new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )
    }
    if (activeChannel === 'sms') {
      return (
        <div className="pmm-preview-sms">
          <div className="pmm-preview-sms-bubble">{text}</div>
          <div className="pmm-preview-sms-meta">
            {charCount} caracteres · {smsSegments} segmento{smsSegments !== 1 ? 's' : ''}
          </div>
        </div>
      )
    }
    if (activeChannel === 'email') {
      return (
        <div className="pmm-preview-email">
          {emailSubject && (
            <div className="pmm-preview-email-subject">
              <strong>Asunto:</strong> {resolveTemplate(emailSubject, variables).text}
            </div>
          )}
          <div className="pmm-preview-email-body">
            {text.split('\n').map((line, i) => (
              <p key={i} style={{ margin: '0 0 8px' }}>{line || <br />}</p>
            ))}
          </div>
        </div>
      )
    }
    // telegram / default
    return (
      <div className="pmm-preview-telegram">{text}</div>
    )
  }

  // ─────────────────────────────────────────────────────────
  // Template replace dialog
  // ─────────────────────────────────────────────────────────

  const renderReplaceDialog = () => {
    if (!pendingTemplate) return null
    return (
      <div className="pmm-replace-overlay">
        <div className="pmm-replace-dialog">
          <p className="pmm-replace-title">¿Qué hacemos con el texto actual?</p>
          <p className="pmm-replace-sub">Tienes un mensaje escrito. Elige cómo aplicar la nueva plantilla.</p>
          <div className="pmm-replace-actions">
            <button
              type="button"
              className="pmm-replace-btn primary"
              onClick={() => applyPendingTemplate('replace')}
            >
              Reemplazar todo
            </button>
            <button
              type="button"
              className="pmm-replace-btn"
              onClick={() => applyPendingTemplate('keep')}
            >
              Agregar debajo
            </button>
            <button
              type="button"
              className="pmm-replace-btn ghost"
              onClick={() => { setPendingTemplate(null) }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const channelTabs: MessagingChannel[] = ['whatsapp', 'sms', 'email', 'telegram']

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      title="Enviar mensaje"
      description={activeContact.nombre ? `Para: ${activeContact.nombre}` : undefined}
      onClose={onClose}
      className="modal-xl"
      bodyClassName="pmm-body-wrap"
      actions={
        <>
          <Button
            variant="ghost"
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={!message.trim() || sending}
          >
            Guardar borrador
          </Button>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <button
            type="button"
            className={`pmm-schedule-toggle ${showSchedule ? 'active' : ''}`}
            onClick={() => setShowSchedule((v) => !v)}
            title="Programar envío"
          >
            🕐
          </button>
          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend || sending}
          >
            {sending ? 'Enviando…' : `Enviar ${CHANNEL_ICONS[activeChannel]}`}
          </Button>
        </>
      }
    >
      <div className="pmm-grid" style={{ position: 'relative' }}>
        {/* Template replace dialog overlay */}
        {renderReplaceDialog()}

        {/* ── LEFT SIDEBAR ─────────────────────────────── */}
        <div className="pmm-sidebar">
          {renderContactPanel()}
          {renderTemplateList()}
          {renderHistory()}
        </div>

        {/* ── RIGHT COMPOSER ───────────────────────────── */}
        <div className="pmm-composer">
          {/* Channel tabs */}
          <div className="template-tabs pmm-channel-tabs">
            {channelTabs.map((ch) => (
              <button
                key={ch}
                type="button"
                className={`template-tab ${activeChannel === ch ? 'active' : ''}`}
                onClick={() => {
                  setActiveChannel(ch)
                  setSelectedTemplateId(null)
                  setCategoryFilter('all')
                }}
              >
                {CHANNEL_ICONS[ch]} {CHANNEL_LABELS[ch]}
              </button>
            ))}
          </div>

          {/* Email subject */}
          {activeChannel === 'email' && (
            <label className="form-field">
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Asunto</span>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Asunto del correo…"
                className="pmm-input"
              />
            </label>
          )}

          {/* Composer / Preview tabs */}
          <div className="pmm-view-tabs">
            <button
              type="button"
              className={`pmm-view-tab ${viewTab === 'composer' ? 'active' : ''}`}
              onClick={() => setViewTab('composer')}
            >
              Editar
            </button>
            <button
              type="button"
              className={`pmm-view-tab ${viewTab === 'preview' ? 'active' : ''}`}
              onClick={() => setViewTab('preview')}
            >
              Preview
            </button>
          </div>

          {viewTab === 'composer' ? (
            <>
              <textarea
                ref={textareaRef}
                rows={7}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Escribe tu mensaje aquí o selecciona una plantilla…"
                className="pmm-textarea"
              />

              {/* Insert field + char counter row */}
              <div className="pmm-composer-toolbar">
                <InsertFieldDropdown onInsert={insertVariable} />
                <span
                  className={`pmm-char-count ${charOver ? 'over' : charCount > 800 ? 'caution' : ''}`}
                >
                  {activeChannel === 'sms'
                    ? `${charCount} car. · ${smsSegments} seg.`
                    : `${charCount} car.${charOver ? ' — demasiado largo' : ''}`}
                </span>
              </div>

              {/* Missing vars warning */}
              {missingVars.length > 0 && (
                <div className="pmm-warning">
                  Datos faltantes: {missingVars.map((v) => `{${v}}`).join(', ')} — usa el formato{' '}
                  <code>{'{variable|"valor por defecto"}'}</code> para un respaldo.
                </div>
              )}

              {/* Evolution API toggle */}
              {activeChannel === 'whatsapp' && isSupabaseConfigured && (
                <label className="pmm-toggle-label">
                  <input
                    type="checkbox"
                    checked={useEvolutionApi}
                    onChange={(e) => setUseEvolutionApi(e.target.checked)}
                  />
                  Enviar automáticamente con Evolution API
                </label>
              )}

              {/* Schedule panel */}
              {showSchedule && (
                <div className="pmm-schedule-panel">
                  <div className="pmm-section-label">Programar envío</div>
                  <div className="pmm-schedule-row">
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="pmm-input"
                      min={new Date().toISOString().slice(0, 10)}
                    />
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="pmm-input"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleSchedule()}
                      disabled={!canSend || !scheduleDate || !scheduleTime || sending}
                    >
                      Programar
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Preview tab
            <div className="pmm-preview-wrap">
              {message.trim() ? renderPreview() : (
                <div className="pmm-empty" style={{ padding: '2rem 0' }}>
                  Escribe un mensaje para ver el preview.
                </div>
              )}
              {missingVars.length > 0 && (
                <div className="pmm-warning" style={{ marginTop: '12px' }}>
                  Variables sin datos: {missingVars.map((v) => `{${v}}`).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
