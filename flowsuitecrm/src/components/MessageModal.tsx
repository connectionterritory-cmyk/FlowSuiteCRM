import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import {
  buildWhatsappUrl,
  replaceTemplateVariables,
  loadCustomTemplates,
  saveCustomTemplates,
  DEFAULT_SYSTEM_TEMPLATES,
  type CustomWhatsappTemplate,
} from '../lib/whatsappTemplates'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useToast } from './Toast'
import type { MessagingChannel, MessagingContact } from '../types/messaging'
import { useAuth } from '../auth/AuthProvider'
import { useUsers } from '../data/UsersProvider'

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

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const CHANNEL_ICON: Record<MessagingChannel, string> = {
  whatsapp: '💬',
  sms: '📱',
  email: '✉️',
}

type SystemTemplate = {
  id: string
  templateKey: string
  label: string
  message: string
  category: string
  isSystem: boolean
}

type TemplateFilter = 'all' | 'system' | 'custom'

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

// --- COMPONENT ---
export function MessageModal({ open, channel, contact, initialTemplateId, onClose }: MessageModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { session } = useAuth()
  const { currentUser } = useUsers()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [activeChannel, setActiveChannel] = useState<MessagingChannel>(channel)
  const [sending, setSending] = useState(false)

  // Custom templates
  const [customTemplates, setCustomTemplates] = useState<CustomWhatsappTemplate[]>(() => loadCustomTemplates())
  const [savingTitle, setSavingTitle] = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)

  // Edit custom template inline
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingMessage, setEditingMessage] = useState('')

  // History
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => loadHistory())
  const [showHistory, setShowHistory] = useState(false)

  // System templates (org-level)
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([])
  const [systemLoading, setSystemLoading] = useState(false)
  const [systemError, setSystemError] = useState<string | null>(null)

  // Search + filter
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>('all')
  const [historySearch, setHistorySearch] = useState('')

  // Edit system template inline
  const [editingSystemId, setEditingSystemId] = useState<string | null>(null)
  const [editingSystemTitle, setEditingSystemTitle] = useState('')
  const [editingSystemMessage, setEditingSystemMessage] = useState('')

  const [distributorPhone, setDistributorPhone] = useState('')

  const canEditSystem = currentUser?.rol === 'admin' || currentUser?.rol === 'distribuidor'
  const organizacion = currentUser?.organizacion?.trim() ?? ''

  const defaultSystemTemplates = useMemo<SystemTemplate[]>(
    () =>
      DEFAULT_SYSTEM_TEMPLATES.map((template) => ({
        id: template.key,
        templateKey: template.key,
        label: template.label,
        message: template.message,
        category: template.category,
        isSystem: true,
      })),
    []
  )

  const variables = useMemo(() => {
    const cliente = firstName(contact?.nombre ?? '')
    return {
      cliente,
      nombre: cliente,
      vendedor: contact?.vendedor ?? '',
      recomendado_por: contact?.recomendadoPor ?? '',
      telefono: distributorPhone || currentUser?.telefono || '',
      email: contact?.email ?? '',
      organizacion: currentUser?.organizacion ?? '',
      cuenta_hycite: contact?.cuentaHycite ?? '',
      saldo_actual: formatAmount(contact?.saldoActual),
      monto_moroso: formatAmount(contact?.montoMoroso),
      dias_atraso: contact?.diasAtraso != null ? String(contact.diasAtraso) : '',
      estado_morosidad: contact?.estadoMorosidad ?? '',
    }
  }, [contact, currentUser?.organizacion, currentUser?.telefono, distributorPhone])

  const loadSystemTemplates = useCallback(async () => {
    if (!open) return
    if (!isSupabaseConfigured || !organizacion) {
      setSystemTemplates(defaultSystemTemplates)
      return
    }
    setSystemLoading(true)
    setSystemError(null)
    const { data, error } = await supabase
      .from('whatsapp_templates_org')
      .select('id, template_key, label, message, category, is_system')
      .eq('organizacion', organizacion)
      .order('created_at', { ascending: true })
    if (error) {
      setSystemError(error.message)
      setSystemTemplates(defaultSystemTemplates)
      setSystemLoading(false)
      return
    }

    const rows = (data ?? []) as Array<{
      id: string
      template_key: string
      label: string
      message: string
      category: string
      is_system: boolean
    }>

    if (rows.length === 0 && canEditSystem && session?.user.id) {
      const seedRows = DEFAULT_SYSTEM_TEMPLATES.map((template) => ({
        organizacion,
        template_key: template.key,
        label: template.label,
        message: template.message,
        category: template.category,
        is_system: true,
        updated_by: session.user.id,
      }))
      const { data: inserted, error: insertError } = await supabase
        .from('whatsapp_templates_org')
        .insert(seedRows)
        .select('id, template_key, label, message, category, is_system')
      if (insertError) {
        setSystemError(insertError.message)
        setSystemTemplates(defaultSystemTemplates)
        setSystemLoading(false)
        return
      }
      const insertedRows = (inserted ?? []) as Array<{
        id: string
        template_key: string
        label: string
        message: string
        category: string
        is_system: boolean
      }>
      setSystemTemplates(
        insertedRows.map((row) => ({
          id: row.id,
          templateKey: row.template_key,
          label: row.label,
          message: row.message,
          category: row.category,
          isSystem: row.is_system,
        }))
      )
      setSystemLoading(false)
      return
    }

    if (rows.length === 0) {
      setSystemTemplates(defaultSystemTemplates)
      setSystemLoading(false)
      return
    }

    setSystemTemplates(
      rows.map((row) => ({
        id: row.id,
        templateKey: row.template_key,
        label: row.label,
        message: row.message,
        category: row.category,
        isSystem: row.is_system,
      }))
    )
    setSystemLoading(false)
  }, [open, organizacion, defaultSystemTemplates, canEditSystem, session?.user.id])

  const loadDistributorPhone = useCallback(async () => {
    if (!open) return
    if (!isSupabaseConfigured) {
      setDistributorPhone(currentUser?.telefono ?? '')
      return
    }
    const { data, error } = await supabase.rpc('get_distributor_phone')
    if (error) {
      setDistributorPhone(currentUser?.telefono ?? '')
      return
    }
    setDistributorPhone((data as string | null) ?? currentUser?.telefono ?? '')
  }, [open, currentUser?.telefono])

  useEffect(() => {
    if (!open) return
    loadSystemTemplates()
  }, [open, loadSystemTemplates])

  useEffect(() => {
    if (!open) return
    loadDistributorPhone()
  }, [open, loadDistributorPhone])

  useEffect(() => {
    if (!open || !contact) return
    const preferredId =
      initialTemplateId ??
      systemTemplates[0]?.templateKey ??
      customTemplates[0]?.id ??
      null
    if (!preferredId) return
    setSelectedTemplateId(preferredId)
    const system = systemTemplates.find((item) => item.templateKey === preferredId)
    const custom = customTemplates.find((item) => item.id === preferredId)
    const templateMessage = system?.message ?? custom?.message ?? ''
    setMessage(templateMessage ? replaceTemplateVariables(templateMessage, variables) : '')
    setShowSaveForm(false)
    setSavingTitle('')
    setEditingTemplateId(null)
    setEditingSystemId(null)
    setShowHistory(false)
    setImageUrl('')
  }, [open, contact, systemTemplates, customTemplates, variables, initialTemplateId])

  useEffect(() => {
    if (!open) return
    setActiveChannel(channel)
  }, [channel, open])

  if (!open || !contact) return null

  const channelLabel = t(`messaging.channel.${activeChannel}`)
  const canSendMessage = message.trim().length > 0
  const phoneValue = contact.telefono ? sanitizePhone(contact.telefono) : ''
  const hasPhone = phoneValue.length > 0
  const hasEmail = Boolean(contact.email?.trim())
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

  // --- SYSTEM TEMPLATE SELECT ---
  const handleSelectSystem = (template: SystemTemplate) => {
    setSelectedTemplateId(template.templateKey)
    setMessage(template.message ? replaceTemplateVariables(template.message, variables) : '')
    setShowSaveForm(false)
    setEditingTemplateId(null)
    setEditingSystemId(null)
  }

  // --- CUSTOM TEMPLATE SELECT ---
  const handleSelectCustom = (id: string) => {
    setSelectedTemplateId(id)
    const template = customTemplates.find((item) => item.id === id)
    setMessage(template ? replaceTemplateVariables(template.message, variables) : '')
    setShowSaveForm(false)
  }

  // --- EDIT SYSTEM TEMPLATE ---
  const handleStartSystemEdit = (template: SystemTemplate) => {
    if (!canEditSystem) return
    setEditingSystemId(template.id)
    setEditingSystemTitle(template.label)
    setEditingSystemMessage(template.message)
  }

  const handleSaveSystemEdit = async () => {
    if (!canEditSystem || !editingSystemId || !session?.user.id) return
    const title = editingSystemTitle.trim()
    if (!title || !editingSystemMessage.trim()) return
    const { data, error } = await supabase
      .from('whatsapp_templates_org')
      .update({ label: title, message: editingSystemMessage.trim(), updated_by: session.user.id })
      .eq('id', editingSystemId)
      .select('id, template_key, label, message, category, is_system')
      .maybeSingle()
    if (error) {
      showToast(error.message, 'error')
      return
    }
    if (data) {
      const updated = systemTemplates.map((template) =>
        template.id === data.id
          ? {
              id: data.id,
              templateKey: data.template_key,
              label: data.label,
              message: data.message,
              category: data.category,
              isSystem: data.is_system,
            }
          : template
      )
      setSystemTemplates(updated)
      if (selectedTemplateId === data.template_key) {
        setMessage(replaceTemplateVariables(data.message, variables))
      }
      setEditingSystemId(null)
      showToast('Plantilla del sistema actualizada')
    }
  }

  const handleCancelSystemEdit = () => {
    setEditingSystemId(null)
  }

  // --- SAVE NEW CUSTOM TEMPLATE ---
  const handleSaveTemplate = () => {
    const title = savingTitle.trim()
    if (!title || !message.trim()) return
    const newTemplate: CustomWhatsappTemplate = {
      id: `custom_${Date.now()}`,
      label: title,
      message: message.trim(),
      category: 'custom',
      custom: true,
    }
    const updated = [...customTemplates, newTemplate]
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    setSelectedTemplateId(newTemplate.id)
    setSavingTitle('')
    setShowSaveForm(false)
    showToast('Plantilla guardada')
  }

  // --- EDIT CUSTOM TEMPLATE ---
  const handleStartEdit = (template: CustomWhatsappTemplate) => {
    setEditingTemplateId(template.id)
    setEditingTitle(template.label)
    setEditingMessage(template.message)
  }

  const handleSaveEdit = () => {
    if (!editingTemplateId || !editingTitle.trim()) return
    const updated = customTemplates.map((tmpl) =>
      tmpl.id === editingTemplateId
        ? { ...tmpl, label: editingTitle.trim(), message: editingMessage.trim() }
        : tmpl
    )
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    if (selectedTemplateId === editingTemplateId) {
      setMessage(replaceTemplateVariables(editingMessage.trim(), variables))
    }
    setEditingTemplateId(null)
    showToast('Plantilla actualizada')
  }

  const handleCancelEdit = () => {
    setEditingTemplateId(null)
  }

  // --- DELETE CUSTOM TEMPLATE ---
  const handleDeleteCustomTemplate = (id: string) => {
    const updated = customTemplates.filter((tmpl) => tmpl.id !== id)
    setCustomTemplates(updated)
    saveCustomTemplates(updated)
    if (selectedTemplateId === id) {
      setSelectedTemplateId(null)
      setMessage('')
    }
  }

  // --- SEND ---
  const updateLeadContact = useCallback(async () => {
    if (!contact.leadId) return
    const { error } = await supabase
      .from('leads')
      .update({
        estado_pipeline: 'contactado',
        whatsapp_mensaje_enviado_at: new Date().toISOString(),
      })
      .eq('id', contact.leadId)
    if (error) showToast(error.message, 'error')
  }, [contact.leadId, showToast])

  const handleSend = async () => {
    if (!canSendMessage || warningMessage) return
    setSending(true)
    const finalMessage = imageUrl.trim()
      ? message.trim() + '\n\n' + imageUrl.trim()
      : message
    if (activeChannel === 'whatsapp') {
      const url = contact.telefono ? buildWhatsappUrl(contact.telefono, finalMessage) : null
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    }
    if (activeChannel === 'sms' && hasPhone) {
      window.open(`sms:${phoneValue}?&body=${encodeURIComponent(finalMessage)}`, '_blank', 'noopener,noreferrer')
    }
    if (activeChannel === 'email' && hasEmail && contact.email) {
      const subject = t('messaging.emailSubject')
      window.open(`mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(finalMessage)}`, '_blank', 'noopener,noreferrer')
    }
    // Save to history
    appendHistory({ contactName: contact.nombre, channel: activeChannel, message: finalMessage, sentAt: new Date().toISOString() })
    setHistoryEntries(loadHistory())
    await updateLeadContact()
    setSending(false)
  }

  const normalizedSearch = templateSearch.trim().toLowerCase()
  const matchesSearch = (label: string, messageText: string) => {
    if (!normalizedSearch) return true
    return (
      label.toLowerCase().includes(normalizedSearch) ||
      messageText.toLowerCase().includes(normalizedSearch)
    )
  }

  const filteredSystemTemplates = systemTemplates.filter((template) => {
    if (templateFilter === 'custom') return false
    return matchesSearch(template.label, template.message)
  })

  const filteredCustomTemplates = customTemplates.filter((template) => {
    if (templateFilter === 'system') return false
    return matchesSearch(template.label, template.message)
  })

  const normalizedHistorySearch = historySearch.trim().toLowerCase()
  const filteredHistoryEntries = historyEntries.filter((entry) => {
    if (!normalizedHistorySearch) return true
    return (
      entry.contactName.toLowerCase().includes(normalizedHistorySearch) ||
      entry.message.toLowerCase().includes(normalizedHistorySearch)
    )
  })

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
          {!showHistory ? (
            <>
              {/* BUSCADOR + FILTROS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.5rem' }}>
                <input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Buscar plantillas..."
                  style={{
                    padding: '0.45rem 0.6rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--color-border, #e5e7eb)',
                    background: 'var(--color-surface, #f9fafb)',
                    color: 'var(--color-text)',
                    fontSize: '0.8rem',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {([
                    { key: 'all', label: 'Todas' },
                    { key: 'system', label: 'Sistema' },
                    { key: 'custom', label: 'Mis plantillas' },
                  ] as const).map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setTemplateFilter(filter.key)}
                      style={{
                        padding: '0.2rem 0.55rem',
                        borderRadius: '9999px',
                        border: `1px solid ${templateFilter === filter.key ? '#3b82f6' : 'var(--color-border, #e5e7eb)'}`,
                        background: templateFilter === filter.key ? 'rgba(59,130,246,0.12)' : 'transparent',
                        color: templateFilter === filter.key ? '#3b82f6' : 'var(--color-text-muted, #6b7280)',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {templateFilter !== 'custom' && (
                <>
                  {/* PLANTILLAS DEL SISTEMA */}
                  <div
                    style={{
                      padding: '0.4rem 0.75rem 0.25rem',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: 'var(--color-text-muted, #6b7280)',
                      letterSpacing: '0.05em',
                      borderTop: '1px solid var(--color-border, #e5e7eb)',
                    }}
                  >
                    SISTEMA
                  </div>

                  {systemLoading && <div className="template-empty">{t('common.loading')}</div>}
                  {systemError && (
                    <div className="template-warning" style={{ margin: '0.35rem 0' }}>
                      {systemError}
                    </div>
                  )}
                  {!systemLoading && filteredSystemTemplates.length === 0 && (
                    <div className="template-empty">Sin resultados</div>
                  )}

                  {!systemLoading && filteredSystemTemplates.map((template) =>
                    editingSystemId === template.id && canEditSystem ? (
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
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          value={editingSystemTitle}
                          onChange={(e) => setEditingSystemTitle(e.target.value)}
                          placeholder="Título..."
                          style={{
                            padding: '0.3rem 0.5rem',
                            borderRadius: '0.25rem',
                            border: '1px solid var(--color-border, #e5e7eb)',
                            fontSize: '0.8rem',
                          }}
                        />
                        <textarea
                          rows={3}
                          value={editingSystemMessage}
                          onChange={(e) => setEditingSystemMessage(e.target.value)}
                          style={{
                            padding: '0.3rem 0.5rem',
                            borderRadius: '0.25rem',
                            border: '1px solid var(--color-border, #e5e7eb)',
                            fontSize: '0.78rem',
                            resize: 'vertical',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={handleCancelSystemEdit}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)' }}
                          >
                            Cancelar
                          </button>
                          <Button type="button" onClick={handleSaveSystemEdit} disabled={!editingSystemTitle.trim()}>
                            Guardar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={template.id}
                        className={`template-item ${selectedTemplateId === template.templateKey ? 'active' : ''}`}
                        onClick={() => handleSelectSystem(template)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectSystem(template) }
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
                                border: '1px solid rgba(59,130,246,0.35)',
                                color: '#3b82f6',
                              }}
                            >
                              Sistema
                            </span>
                            {canEditSystem && (
                              <button
                                type="button"
                                aria-label="Editar plantilla del sistema"
                                title="Editar"
                                onClick={(e) => { e.stopPropagation(); handleStartSystemEdit(template) }}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: 'var(--color-text-muted, #6b7280)', fontSize: '0.7rem',
                                  padding: '0.1rem 0.25rem', lineHeight: 1, borderRadius: '0.2rem',
                                }}
                              >
                                ✎
                              </button>
                            )}
                          </div>
                        </div>
                        <span
                          className="template-snippet"
                          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {template.message
                            ? buildSubtitle(replaceTemplateVariables(template.message, variables))
                            : t('messaging.templateEmpty')}
                        </span>
                      </div>
                    )
                  )}
                </>
              )}

              {/* MIS PLANTILLAS GUARDADAS */}
              {(templateFilter !== 'system' || filteredCustomTemplates.length > 0) && (
                <>
                  <div
                    style={{
                      padding: '0.5rem 0.75rem 0.25rem',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: 'var(--color-text-muted, #6b7280)',
                      letterSpacing: '0.05em',
                      borderTop: '1px solid var(--color-border, #e5e7eb)',
                      marginTop: '0.25rem',
                    }}
                  >
                    MIS PLANTILLAS
                  </div>
                  {filteredCustomTemplates.length === 0 && (
                    <div className="template-empty">Sin plantillas personales.</div>
                  )}
                  {filteredCustomTemplates.map((template) =>
                    editingTemplateId === template.id ? (
                      // EDIT FORM INLINE
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
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          placeholder="Título..."
                          style={{
                            padding: '0.3rem 0.5rem',
                            borderRadius: '0.25rem',
                            border: '1px solid var(--color-border, #e5e7eb)',
                            fontSize: '0.8rem',
                          }}
                        />
                        <textarea
                          rows={3}
                          value={editingMessage}
                          onChange={(e) => setEditingMessage(e.target.value)}
                          style={{
                            padding: '0.3rem 0.5rem',
                            borderRadius: '0.25rem',
                            border: '1px solid var(--color-border, #e5e7eb)',
                            fontSize: '0.78rem',
                            resize: 'vertical',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)' }}
                          >
                            Cancelar
                          </button>
                          <Button type="button" onClick={handleSaveEdit} disabled={!editingTitle.trim()}>
                            Guardar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // NORMAL DISPLAY
                      <div
                        key={template.id}
                        className={`template-item ${selectedTemplateId === template.id ? 'active' : ''}`}
                        onClick={() => handleSelectCustom(template.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectCustom(template.id) }
                        }}
                      >
                        <div
                          className="template-item-header"
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <span className="template-title">{template.label}</span>
                          <div style={{ display: 'flex', gap: '0.15rem', flexShrink: 0 }}>
                            <button
                              type="button"
                              aria-label="Editar plantilla"
                              title="Editar"
                              onClick={(e) => { e.stopPropagation(); handleStartEdit(template) }}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-text-muted, #6b7280)', fontSize: '0.7rem',
                                padding: '0.1rem 0.25rem', lineHeight: 1, borderRadius: '0.2rem',
                              }}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              aria-label="Eliminar plantilla"
                              title="Eliminar"
                              onClick={(e) => { e.stopPropagation(); handleDeleteCustomTemplate(template.id) }}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-text-muted, #6b7280)', fontSize: '0.75rem',
                                padding: '0.1rem 0.25rem', lineHeight: 1, borderRadius: '0.2rem',
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
                          {buildSubtitle(replaceTemplateVariables(template.message, variables))}
                        </span>
                      </div>
                    )
                  )}
                </>
              )}

              {/* TOGGLE HISTORIAL */}
              {historyEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  style={{
                    marginTop: '0.5rem',
                    background: 'none',
                    border: '1px dashed var(--color-border, #e5e7eb)',
                    borderRadius: '0.375rem',
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.75rem',
                    color: 'var(--color-text-muted, #6b7280)',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  🕐 Ver historial ({historyEntries.length})
                </button>
              )}
            </>
          ) : (
            // HISTORIAL VIEW
            <>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  color: 'var(--color-text-muted, #6b7280)',
                  padding: '0.4rem 0.75rem',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                ← Volver a plantillas
              </button>
              <div style={{ padding: '0 0.75rem 0.5rem' }}>
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar en historial..."
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.6rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--color-border, #e5e7eb)',
                    background: 'var(--color-surface, #f9fafb)',
                    color: 'var(--color-text)',
                    fontSize: '0.8rem',
                  }}
                />
              </div>
              <div
                style={{
                  borderTop: '1px solid var(--color-border, #e5e7eb)',
                  paddingTop: '0.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  maxHeight: '340px',
                  overflowY: 'auto',
                }}
              >
                {filteredHistoryEntries.map((entry) => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setMessage(entry.message); setShowHistory(false); setSelectedTemplateId(null) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { setMessage(entry.message); setShowHistory(false); setSelectedTemplateId(null) }
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border, #e5e7eb)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                        {CHANNEL_ICON[entry.channel]} {entry.contactName}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted, #6b7280)' }}>
                        {formatDate(entry.sentAt)}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #6b7280)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* PANEL DERECHO — EDITOR */}
        <div className="template-preview">
          <h4>{t('messaging.editorTitle')}</h4>
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
            {[
              { label: 'Cliente', vars: ['{cliente}', '{email}'] },
              { label: 'Vendedor', vars: ['{vendedor}', '{organizacion}'] },
              { label: 'Recomendado', vars: ['{recomendado_por}'] },
              { label: 'Contacto', vars: ['{telefono}'] },
              { label: 'Cartera', vars: ['{cuenta_hycite}', '{saldo_actual}', '{monto_moroso}', '{dias_atraso}', '{estado_morosidad}'] },
            ].map((group) => (
              <div key={group.label} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-muted, #6b7280)' }}>{group.label}</span>
                {group.vars.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    title={`Insertar ${variable}`}
                    onClick={() => insertVariable(variable)}
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
                    {variable}
                  </button>
                ))}
              </div>
            ))}
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)' }}>
              — clic para insertar
            </span>
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

          {/* GUARDAR COMO PLANTILLA */}
          {message.trim() && !showSaveForm && (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              style={{
                marginTop: '0.6rem',
                background: 'none',
                border: '1px dashed var(--color-border, #e5e7eb)',
                borderRadius: '0.375rem',
                padding: '0.4rem 0.75rem',
                fontSize: '0.78rem',
                color: 'var(--color-text-muted, #6b7280)',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              + Guardar como plantilla
            </button>
          )}
          {showSaveForm && (
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={savingTitle}
                onChange={(e) => setSavingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTemplate()
                  if (e.key === 'Escape') { setShowSaveForm(false); setSavingTitle('') }
                }}
                placeholder="Nombre de la plantilla..."
                style={{
                  flex: 1,
                  padding: '0.4rem 0.6rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.8rem',
                }}
              />
              <Button type="button" onClick={handleSaveTemplate} disabled={!savingTitle.trim()}>
                Guardar
              </Button>
              <button
                type="button"
                onClick={() => { setShowSaveForm(false); setSavingTitle('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #6b7280)', fontSize: '0.9rem', padding: '0.25rem' }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
