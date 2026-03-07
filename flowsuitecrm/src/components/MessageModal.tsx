import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import {
  buildWhatsappUrl,
  loadCustomTemplates,
  saveCustomTemplates,
  type CustomWhatsappTemplate,
  type WhatsappTemplateCategory,
} from '../lib/whatsappTemplates'
import { canonicalizeTemplate, PLACEHOLDER_OPTIONS, resolveTemplate } from '../lib/messagePlaceholders'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useToast } from './Toast'
import type { MessagingChannel, MessagingContact } from '../types/messaging'
import { useUsers } from '../data/UsersProvider'
import { useAuth } from '../auth/AuthProvider'

type MessageModalProps = {
  open: boolean
  channel: MessagingChannel
  contact: MessagingContact | null
  initialTemplateId?: string | null
  onClose: () => void
}

const sanitizePhone = (value: string) => value.replace(/\D/g, '')

// --- HISTORIAL ---
const HISTORY_KEY = 'flowsuite.messaging.history'
const MAX_HISTORY = 30

type HistoryEntry = {
  id: string
  contactName: string
  channel: MessagingChannel
  message: string
  sentAt: string
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function appendHistory(entry: Omit<HistoryEntry, 'id'>): void {
  if (typeof window === 'undefined') return
  const prev = loadHistory()
  const updated = [{ ...entry, id: `h_${Date.now()}` }, ...prev].slice(0, MAX_HISTORY)
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
}


type SystemTemplate = {
  id: string
  templateKey: string
  label: string
  message: string
  category: string
}

type MessageType =
  | 'general'
  | 'seguimiento'
  | 'cartera'
  | 'referidos'
  | 'cumpleanos'
  | 'citas'
  | 'servicio'
  | 'cambio_repuestos'

const MESSAGE_TYPE_OPTIONS: { value: MessageType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'cartera', label: 'Cartera' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'cumpleanos', label: 'Cumpleanos' },
  { value: 'citas', label: 'Citas' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'cambio_repuestos', label: 'Cambio de repuestos' },
]

const formatAmount = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return ''
  return Number(value).toFixed(2)
}

const firstName = (value?: string | null) => {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0] ?? ''
}

const buildSubtitle = (value: string) => {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= 80) return compact
  return compact.slice(0, 77) + '...'
}

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  general: 'General',
  seguimiento: 'Seguimiento',
  cartera: 'Cartera',
  referidos: 'Referidos',
  cumpleanos: 'Cumpleanos',
  citas: 'Citas',
  servicio: 'Servicio',
  cambio_repuestos: 'Cambio de repuestos',
}

const inferMessageTypeFromId = (templateId: string | null | undefined): MessageType => {
  if (!templateId) return 'general'
  const key = templateId.toLowerCase()
  if (key.includes('cumple')) return 'cumpleanos'
  if (key.includes('servicio')) return 'servicio'
  if (key.includes('repuesto') || key.includes('repuestos')) return 'cambio_repuestos'
  if (key.includes('cartera')) return 'cartera'
  if (key.includes('referid')) return 'referidos'
  if (key.includes('cita')) return 'citas'
  if (key.includes('seguimiento')) return 'seguimiento'
  return 'general'
}

const CATEGORY_OPTIONS: { value: WhatsappTemplateCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'cartera', label: 'Cartera' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'cumpleanos', label: 'Cumpleaños' },
  { value: 'citas', label: 'Citas' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'cambio_repuestos', label: 'Cambio de repuestos' },
]

// --- COMPONENT ---
export function MessageModal({ open, channel, contact, initialTemplateId, onClose }: MessageModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { currentUser } = useUsers()
  const { session } = useAuth()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resolvedContact: MessagingContact = contact ?? {
    nombre: '',
    telefono: null,
    email: null,
    vendedor: '',
    recomendadoPor: null,
    cuentaHycite: null,
    saldoActual: null,
    montoMoroso: null,
    diasAtraso: null,
    estadoMorosidad: null,
    clienteId: null,
    leadId: null,
  }

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [activeChannel, setActiveChannel] = useState<MessagingChannel>(channel)
  const [sending, setSending] = useState(false)

  const [customTemplates, setCustomTemplates] = useState<CustomWhatsappTemplate[]>(() => loadCustomTemplates())
  const [categoryFilter, setCategoryFilter] = useState<'all' | WhatsappTemplateCategory>('all')
  const [newTemplateTitle, setNewTemplateTitle] = useState('')
  const [newTemplateCategory, setNewTemplateCategory] = useState<WhatsappTemplateCategory>('general')
  const [messageType, setMessageType] = useState<MessageType>('general')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [editingTemplateTitle, setEditingTemplateTitle] = useState('')
  const [editingTemplateMessage, setEditingTemplateMessage] = useState('')
  const [editingTemplateCategory, setEditingTemplateCategory] = useState<WhatsappTemplateCategory>('general')

  const [distributorPhone, setDistributorPhone] = useState('')

  const exampleTemplate = useMemo<SystemTemplate>(
    () => ({
      id: 'ejemplo_personalizado',
      templateKey: 'ejemplo_personalizado',
      label: 'Ejemplo personalizado',
      category: 'basic',
      message: [
        'Hola {cliente}, soy {vendedor} de {organizacion}.',
        'Te escribo por tu cuenta Royal Prestige (HyCite) #{cuenta_hycite}.',
        'Saldo actual: $' + '{saldo_actual}. Moroso: $' + '{monto_moroso}.',
        'Si ya pagaste, ignora este mensaje. Si necesitas ayuda, escríbeme al {telefono}.',
      ].join('\n'),
    }),
    []
  )

  const variables = useMemo(() => {
    const cliente = firstName(resolvedContact.nombre ?? '')
    const currentUserName = [currentUser?.nombre, currentUser?.apellido].filter(Boolean).join(' ').trim()
    const responsableNombre = resolvedContact.responsableNombre ?? currentUserName
    const vendedorNombre = resolvedContact.vendedorNombre
      ?? resolvedContact.responsableNombre
      ?? currentUserName
      ?? ''
    const recomendadoPorNombre = resolvedContact.recomendadoPorNombre ?? resolvedContact.recomendadoPor ?? ''
    const vendedorTelefono = resolvedContact.vendedorTelefono
      ?? distributorPhone
      ?? currentUser?.telefono
      ?? ''
    return {
      cliente,
      nombre: cliente,
      telefono: resolvedContact.telefono ?? distributorPhone ?? currentUser?.telefono ?? '',
      vendedor_nombre: vendedorNombre,
      vendedor_telefono: vendedorTelefono,
      responsable_nombre: responsableNombre,
      recomendado_por_nombre: recomendadoPorNombre,
      email: resolvedContact.email ?? '',
      organizacion: currentUser?.organizacion ?? '',
      cuenta_hycite: resolvedContact.cuentaHycite ?? '',
      saldo_actual: formatAmount(resolvedContact.saldoActual),
      monto_moroso: formatAmount(resolvedContact.montoMoroso),
      dias_atraso: resolvedContact.diasAtraso != null ? String(resolvedContact.diasAtraso) : '',
      estado_morosidad: resolvedContact.estadoMorosidad ?? '',
      fuente: resolvedContact.fuente ?? '',
      programa: resolvedContact.programa ?? '',
      ciudad: resolvedContact.ciudad ?? '',
    }
  }, [currentUser?.apellido, currentUser?.nombre, currentUser?.organizacion, currentUser?.telefono, distributorPhone, resolvedContact])

  const loadUserTemplates = useCallback(() => {
    if (!open) return
    setCustomTemplates(loadCustomTemplates())
  }, [open])

  const loadDistributorPhone = useCallback(async () => {
    if (!open) return
    if (!isSupabaseConfigured) {
      setDistributorPhone(currentUser?.telefono ?? '')
      return
    }
    const { data, error } = await supabase.rpc('get_distributor_phone')
    const rpcPhone = (data as string | null) ?? ''
    if (!error && rpcPhone.trim()) {
      setDistributorPhone(rpcPhone)
      return
    }
    if (currentUser?.telefono?.trim()) {
      setDistributorPhone(currentUser.telefono)
      return
    }
    const userId = session?.user.id
    if (!userId) {
      setDistributorPhone('')
      return
    }
    const { data: userRow } = await supabase
      .from('usuarios')
      .select('telefono')
      .eq('id', userId)
      .maybeSingle()
    setDistributorPhone((userRow as { telefono?: string | null } | null)?.telefono ?? '')
  }, [open, currentUser?.telefono, session?.user.id])

  useEffect(() => {
    if (!open) return
    loadUserTemplates()
  }, [open, loadUserTemplates])

  useEffect(() => {
    if (!open) return
    loadDistributorPhone()
  }, [open, loadDistributorPhone])

  useEffect(() => {
    if (!open || !contact) return
    const preferred = initialTemplateId
      ? customTemplates.find((tmpl) => tmpl.id === initialTemplateId) ?? null
      : null
    if (preferred) {
      setSelectedTemplateId(preferred.id)
      setMessage(canonicalizeTemplate(preferred.message))
    } else {
      setSelectedTemplateId(exampleTemplate.templateKey)
      setMessage(canonicalizeTemplate(exampleTemplate.message))
    }
    setImageUrl('')
  }, [open, contact, initialTemplateId, exampleTemplate, customTemplates])

  useEffect(() => {
    if (!open) return
    setActiveChannel(channel)
  }, [channel, open])

  const channelLabel = t(`messaging.channel.${activeChannel}`)
  const canSendMessage = message.trim().length > 0
  const phoneValue = resolvedContact.telefono ? sanitizePhone(resolvedContact.telefono) : ''
  const hasPhone = phoneValue.length > 0
  const hasEmail = Boolean(resolvedContact.email?.trim())
  const channelTabs: MessagingChannel[] = ['whatsapp', 'sms', 'email']
  const charCount = message.length
  const charOver = charCount > 1024
  const charCaution = charCount > 800 && !charOver

  const warningMessage =
    activeChannel === 'email'
      ? !hasEmail
        ? t('messaging.emailMissing')
        : null
      : !hasPhone
        ? t('messaging.phoneMissing')
        : null

  const inferredMessageType = useMemo<MessageType>(() => {
    const customTemplate = customTemplates.find((template) => template.id === selectedTemplateId) ?? null
    const category = customTemplate?.category
    if (category && category in MESSAGE_TYPE_LABELS) {
      return category as MessageType
    }
    return inferMessageTypeFromId(selectedTemplateId ?? initialTemplateId)
  }, [customTemplates, initialTemplateId, selectedTemplateId])

  const resolvedMessage = useMemo(() => resolveTemplate(message, variables), [message, variables])
  const missingPlaceholders = resolvedMessage.missing

  const placeholderGroups = useMemo(() => {
    const map = new Map<string, { label: string; token: string }[]>()
    PLACEHOLDER_OPTIONS.forEach((option) => {
      if (!map.has(option.group)) map.set(option.group, [])
      map.get(option.group)!.push({ label: option.label, token: option.token })
    })
    return Array.from(map.entries())
  }, [])

  useEffect(() => {
    if (!open) return
    setMessageType(inferredMessageType)
  }, [inferredMessageType, open])

  const filteredTemplates = useMemo(() => {
    if (categoryFilter === 'all') return customTemplates
    return customTemplates.filter((template) => template.category === categoryFilter)
  }, [customTemplates, categoryFilter])

  // --- VARIABLE INSERTION AT CURSOR ---
  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setMessage((prev) => prev + variable)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = message.slice(0, start) + variable + message.slice(end)
    setMessage(next)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + variable.length, start + variable.length)
    }, 0)
  }

  // --- CUSTOM TEMPLATE SELECT ---
  const handleSelectCustom = (template: CustomWhatsappTemplate) => {
    setSelectedTemplateId(template.id)
    setMessage(template.message ? canonicalizeTemplate(template.message) : '')
  }

  const handleSelectExample = () => {
    setSelectedTemplateId(exampleTemplate.templateKey)
    setMessage(canonicalizeTemplate(exampleTemplate.message))
  }

  const handleSaveTemplate = () => {
    const title = newTemplateTitle.trim()
    if (!title || !message.trim()) return
    setSavingTemplate(true)
    const newTemplate: CustomWhatsappTemplate = {
      id: `custom_${Date.now()}`,
      label: title,
      message: message.trim(),
      category: newTemplateCategory,
      custom: true,
    }
    const updated = [...customTemplates, newTemplate]
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    setSelectedTemplateId(newTemplate.id)
    showToast('Plantilla guardada')
    setNewTemplateTitle('')
    setNewTemplateCategory('general')
    setSavingTemplate(false)
  }

  const handleStartEdit = (template: CustomWhatsappTemplate) => {
    setEditingTemplateId(template.id)
    setEditingTemplateTitle(template.label)
    setEditingTemplateMessage(template.message)
    setEditingTemplateCategory((template.category || 'general') as WhatsappTemplateCategory)
  }

  const handleCancelEdit = () => {
    setEditingTemplateId(null)
  }

  const handleSaveEdit = () => {
    if (!editingTemplateId || !editingTemplateTitle.trim()) return
    const updated = customTemplates.map((template) =>
      template.id === editingTemplateId
        ? {
            ...template,
            label: editingTemplateTitle.trim(),
            message: editingTemplateMessage.trim(),
            category: editingTemplateCategory,
          }
        : template
    )
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    if (selectedTemplateId === editingTemplateId) {
      setMessage(canonicalizeTemplate(editingTemplateMessage.trim()))
    }
    setEditingTemplateId(null)
    showToast('Plantilla actualizada')
  }

  const handleDeleteTemplate = (template: CustomWhatsappTemplate) => {
    const ok = window.confirm(`Eliminar la plantilla "${template.label}"?`)
    if (!ok) return
    const updated = customTemplates.filter((item) => item.id !== template.id)
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    if (selectedTemplateId === template.id) {
      setSelectedTemplateId(exampleTemplate.templateKey)
      setMessage(canonicalizeTemplate(exampleTemplate.message))
    }
    showToast('Plantilla eliminada')
  }

  // --- SEND ---
  const buildSenderName = () => {
    const parts = [currentUser?.nombre, currentUser?.apellido].filter(Boolean)
    return parts.join(' ').trim() || currentUser?.email || ''
  }

  const saveMessageLog = useCallback(
    async (finalMessage: string, sentAt: string) => {
      if (!isSupabaseConfigured) return
      const senderId = session?.user.id ?? null
      const senderName = buildSenderName()
      const messageTypeLabel = MESSAGE_TYPE_LABELS[messageType]
      const summary = `Mensaje ${channelLabel} (${messageTypeLabel})${senderName ? ` por ${senderName}` : ''}.`

      if (contact?.clienteId) {
        const { error } = await supabase.from('notasrp').insert({
          cliente_id: resolvedContact.clienteId,
          contenido: summary,
          canal: activeChannel,
          tipo_mensaje: messageType,
          enviado_por: senderId,
          enviado_en: sentAt,
          mensaje: finalMessage,
        })
        if (error) {
          showToast(error.message, 'error')
        }
      }

      if (contact?.leadId && senderId) {
        const { error } = await supabase.from('lead_notas').insert({
          lead_id: resolvedContact.leadId,
          usuario_id: senderId,
          nota: summary,
          tipo: 'mensajeria',
          canal: activeChannel,
          tipo_mensaje: messageType,
          mensaje: finalMessage,
        })
        if (error) {
          showToast(error.message, 'error')
        }
      }
    },
    [activeChannel, channelLabel, contact?.clienteId, contact?.leadId, messageType, session?.user.id, showToast]
  )

  const updateLeadContact = useCallback(async () => {
    if (!resolvedContact.leadId) return
    const { error } = await supabase
      .from('leads')
      .update({
        estado_pipeline: 'contactado',
        whatsapp_mensaje_enviado_at: new Date().toISOString(),
      })
      .eq('id', resolvedContact.leadId)
    if (error) showToast(error.message, 'error')
  }, [resolvedContact.leadId, showToast])

  const handleSend = async () => {
    if (!canSendMessage || warningMessage) return
    setSending(true)
    const finalMessage = imageUrl.trim()
      ? resolvedMessage.text.trim() + '\n\n' + imageUrl.trim()
      : resolvedMessage.text
    const sentAt = new Date().toISOString()
    if (activeChannel === 'whatsapp') {
      const url = resolvedContact.telefono ? buildWhatsappUrl(resolvedContact.telefono, finalMessage) : null
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    }
    if (activeChannel === 'sms' && hasPhone) {
      window.open(`sms:${phoneValue}?&body=${encodeURIComponent(finalMessage)}`, '_blank', 'noopener,noreferrer')
    }
    if (activeChannel === 'email' && hasEmail && resolvedContact.email) {
      const subject = t('messaging.emailSubject')
      window.open(`mailto:${resolvedContact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(finalMessage)}`, '_blank', 'noopener,noreferrer')
    }
    // Save to history
    appendHistory({ contactName: resolvedContact.nombre, channel: activeChannel, message: finalMessage, sentAt: new Date().toISOString() })
    await saveMessageLog(finalMessage, sentAt)
    await updateLeadContact()
    setSending(false)
  }

  if (!open || !contact) return null

  return (
    <Modal
      open={open}
      title={t('messaging.title', { channel: channelLabel })}
      description={t('messaging.subtitle')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSendMessage || Boolean(warningMessage) || sending || charOver}>
            {sending ? t('common.saving') : t('messaging.send')}
          </Button>
        </>
      }
    >
      {/* CANAL TABS */}
      <div className="template-tabs messaging-tabs">
        {channelTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`template-tab ${activeChannel === tab ? 'active' : ''}`.trim()}
            onClick={() => setActiveChannel(tab)}
          >
            {t(`messaging.channel.${tab}`)}
          </button>
        ))}
      </div>

      <div className="template-grid">
        {/* PANEL IZQUIERDO — TEMPLATES + HISTORIAL */}
        <div className="template-list">
          <div
            style={{
              padding: '0.45rem 0.75rem 0.35rem',
              fontSize: '0.7rem',
              fontWeight: 700,
              color: 'var(--color-text-muted, #6b7280)',
              letterSpacing: '0.05em',
              borderBottom: '1px solid var(--color-border, #e5e7eb)',
            }}
          >
            EJEMPLO
          </div>
          <div
            className={`template-item ${selectedTemplateId === exampleTemplate.templateKey ? 'active' : ''}`}
            onClick={handleSelectExample}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectExample() }
            }}
          >
            <div
              className="template-item-header"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.25rem' }}
            >
              <span className="template-title">{exampleTemplate.label}</span>
              <span
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  padding: '0.05rem 0.35rem',
                  borderRadius: '9999px',
                  border: '1px solid rgba(59,130,246,0.35)',
                  color: '#3b82f6',
                }}
              >
                Base
              </span>
            </div>
            <span
              className="template-snippet"
              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
                  {buildSubtitle(resolveTemplate(exampleTemplate.message, variables).text)}
            </span>
          </div>
          <div
            className="template-empty"
            style={{ marginTop: '0.5rem', lineHeight: 1.5 }}
          >
            Usa este ejemplo como base. Edita el texto a la derecha y agrega variables con un clic.
          </div>

          <div
            style={{
              padding: '0.6rem 0.75rem 0.35rem',
              fontSize: '0.7rem',
              fontWeight: 700,
              color: 'var(--color-text-muted, #6b7280)',
              letterSpacing: '0.05em',
              borderTop: '1px solid var(--color-border, #e5e7eb)',
              marginTop: '0.65rem',
            }}
          >
            MIS PLANTILLAS
          </div>

          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', padding: '0 0.75rem 0.5rem' }}>
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '9999px',
                border: `1px solid ${categoryFilter === 'all' ? '#3b82f6' : 'var(--color-border, #e5e7eb)'}`,
                background: categoryFilter === 'all' ? 'rgba(59,130,246,0.12)' : 'transparent',
                color: categoryFilter === 'all' ? '#3b82f6' : 'var(--color-text-muted, #6b7280)',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Todas
            </button>
            {CATEGORY_OPTIONS.map((category) => (
              <button
                key={category.value}
                type="button"
                onClick={() => setCategoryFilter(category.value)}
                style={{
                  padding: '0.2rem 0.55rem',
                  borderRadius: '9999px',
                  border: `1px solid ${categoryFilter === category.value ? '#3b82f6' : 'var(--color-border, #e5e7eb)'}`,
                  background: categoryFilter === category.value ? 'rgba(59,130,246,0.12)' : 'transparent',
                  color: categoryFilter === category.value ? '#3b82f6' : 'var(--color-text-muted, #6b7280)',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {category.label}
              </button>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="template-empty">No tienes plantillas guardadas.</div>
          )}
          {filteredTemplates.map((template) =>
            editingTemplateId === template.id ? (
              <div
                key={template.id}
                style={{
                  padding: '0.6rem 0.75rem',
                  background: 'var(--color-surface, #f9fafb)',
                  borderBottom: '1px solid var(--color-border, #e5e7eb)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                }}
                >
                  <input
                    value={editingTemplateTitle}
                    onChange={(e) => setEditingTemplateTitle(e.target.value)}
                    placeholder="Titulo..."
                    style={{
                      padding: '0.35rem 0.5rem',
                      borderRadius: '0.35rem',
                      border: '1px solid var(--color-border, #e5e7eb)',
                    fontSize: '0.8rem',
                  }}
                  />
                  <select
                    value={editingTemplateCategory}
                onChange={(e) => setEditingTemplateCategory(e.target.value as WhatsappTemplateCategory)}
                    style={{
                      padding: '0.35rem 0.5rem',
                      borderRadius: '0.35rem',
                      border: '1px solid var(--color-border, #e5e7eb)',
                    fontSize: '0.78rem',
                    background: 'var(--color-surface, #f9fafb)',
                  }}
                >
                  {CATEGORY_OPTIONS.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={3}
                  value={editingTemplateMessage}
                  onChange={(e) => setEditingTemplateMessage(e.target.value)}
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: '0.35rem',
                    border: '1px solid var(--color-border, #e5e7eb)',
                    fontSize: '0.78rem',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      color: 'var(--color-text-muted, #6b7280)',
                    }}
                  >
                    Cancelar
                  </button>
                  <Button type="button" onClick={handleSaveEdit} disabled={!editingTemplateTitle.trim()}>
                    Guardar
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={template.id}
                className={`template-item ${selectedTemplateId === template.id ? 'active' : ''}`}
                onClick={() => handleSelectCustom(template)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectCustom(template) }
                }}
              >
                <div
                  className="template-item-header"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.25rem' }}
                >
                  <span className="template-title">{template.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span
                      style={{
                        fontSize: '0.6rem',
                        fontWeight: 700,
                        padding: '0.05rem 0.35rem',
                        borderRadius: '9999px',
                        border: '1px solid rgba(16,185,129,0.35)',
                        color: '#10b981',
                      }}
                    >
                      {CATEGORY_OPTIONS.find((c) => c.value === template.category)?.label ?? 'General'}
                    </span>
                    <button
                      type="button"
                      aria-label="Editar plantilla"
                      title="Editar"
                      onClick={(e) => { e.stopPropagation(); handleStartEdit(template) }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-muted, #6b7280)',
                        fontSize: '0.7rem',
                        padding: '0.1rem 0.25rem',
                        lineHeight: 1,
                        borderRadius: '0.2rem',
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label="Eliminar plantilla"
                      title="Eliminar"
                      onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(template) }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-muted, #6b7280)',
                        fontSize: '0.75rem',
                        padding: '0.1rem 0.25rem',
                        lineHeight: 1,
                        borderRadius: '0.2rem',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <span
                  className="template-snippet"
                  style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {buildSubtitle(resolveTemplate(template.message, variables).text)}
                </span>
              </div>
            )
          )}
        </div>

        {/* PANEL DERECHO — EDITOR */}
        <div className="template-preview">
          <h4>{t('messaging.editorTitle')}</h4>
          <label className="form-field">
            <span>Tipo de mensaje</span>
            <select
              value={messageType}
              onChange={(event) => setMessageType(event.target.value as MessageType)}
              style={{
                padding: '0.45rem 0.65rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border, #e5e7eb)',
                background: 'var(--color-surface, #f9fafb)',
                color: 'var(--color-text)',
                fontSize: '0.8rem',
              }}
            >
              {MESSAGE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field template-message">
            <span>{t('messaging.messageLabel')}</span>
            <textarea
              ref={textareaRef}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('messaging.messagePlaceholder')}
            />
          </label>

          {/* CONTADOR DE CARACTERES */}
          <div
            style={{
              fontSize: '0.72rem',
              color: charOver ? '#dc2626' : charCaution ? '#d97706' : 'var(--color-text-muted, #6b7280)',
              textAlign: 'right',
              marginTop: '0.15rem',
            }}
          >
            {charCount} caracteres{charOver ? ' — mensaje demasiado largo' : charCaution ? ' — casi al límite' : ''}
          </div>

          {/* VARIABLES CLICABLES */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.4rem' }}>
            {placeholderGroups.map(([groupLabel, vars]) => (
              <div key={groupLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)' }}>{groupLabel}</span>
                {vars.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    title={`Insertar ${variable.token}`}
                    onClick={() => insertVariable(variable.token)}
                    style={{
                      background: 'var(--color-surface, #f3f4f6)',
                      border: '1px solid var(--color-border, #e5e7eb)',
                      borderRadius: '0.25rem',
                      padding: '0.15rem 0.45rem',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                    }}
                  >
                    {variable.token}
                  </button>
                ))}
              </div>
            ))}
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)' }}>
              — clic para insertar
            </span>
            {missingPlaceholders.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: '#d97706' }}>
                Faltan datos para: {missingPlaceholders.map((value) => `{${value}}`).join(', ')}
              </span>
            )}
          </div>

          {/* LINK DE IMAGEN */}
          {activeChannel === 'whatsapp' && (
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted, #6b7280)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  📎 {t('messaging.imagenLabel')}
                </span>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder={t('messaging.imagenPlaceholder')}
                  style={{
                    padding: '0.45rem 0.65rem',
                    borderRadius: '0.5rem',
                    border: `1px solid ${imageUrl.trim() ? 'rgba(59,130,246,0.5)' : 'var(--color-border, #e5e7eb)'}`,
                    background: 'var(--color-surface, #f9fafb)',
                    color: 'var(--color-text)',
                    fontSize: '0.8rem',
                  }}
                />
                {imageUrl.trim() && (
                  <p style={{ margin: 0, fontSize: '0.7rem', color: '#10b981' }}>
                    ✓ El link se adjuntará al final del mensaje
                  </p>
                )}
              </label>
            </div>
          )}

          {warningMessage && <p className="template-warning">{warningMessage}</p>}

          <div style={{ marginTop: '0.85rem', borderTop: '1px solid var(--color-border, #e5e7eb)', paddingTop: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)' }}>
              Guardar como plantilla
            </p>
            <p style={{ margin: '0.25rem 0 0.6rem', fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)' }}>
              Guardada solo para ti en este dispositivo.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '0.5rem' }}>
              <input
                value={newTemplateTitle}
                onChange={(e) => setNewTemplateTitle(e.target.value)}
                placeholder="Nombre de la plantilla..."
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.8rem',
                }}
              />
              <select
                value={newTemplateCategory}
                onChange={(e) => setNewTemplateCategory(e.target.value as WhatsappTemplateCategory)}
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.8rem',
                  background: 'var(--color-surface, #f9fafb)',
                }}
              >
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.6rem' }}>
              <Button
                type="button"
                onClick={handleSaveTemplate}
                disabled={!newTemplateTitle.trim() || !message.trim() || savingTemplate}
              >
                {savingTemplate ? t('common.saving') : 'Guardar plantilla'}
              </Button>
            </div>
          </div>

        </div>
      </div>
    </Modal>
  )
}
