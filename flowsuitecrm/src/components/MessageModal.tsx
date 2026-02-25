import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import {
  buildWhatsappUrl,
  replaceTemplateVariables,
  loadCustomTemplates,
  saveCustomTemplates,
  type CustomWhatsappTemplate,
} from '../lib/whatsappTemplates'
import { supabase } from '../lib/supabase/client'
import { useToast } from './Toast'
import type { MessagingChannel, MessagingContact } from '../types/messaging'

type MessageModalProps = {
  open: boolean
  channel: MessagingChannel
  contact: MessagingContact | null
  initialTemplateId?: string | null
  onClose: () => void
}

const builtinTemplateIds = ['cumpleanos', 'referido', 'seguimiento', 'recordatorio', 'personalizado'] as const
type BuiltinTemplateId = (typeof builtinTemplateIds)[number]

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

// --- COMPONENT ---
export function MessageModal({ open, channel, contact, initialTemplateId, onClose }: MessageModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
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

  const builtinTemplates = useMemo(() => {
    return builtinTemplateIds.map((id) => ({
      id,
      label: t(`messaging.templates.${id}Label`),
      message: t(`messaging.templates.${id}`),
    }))
  }, [t])

  const variables = useMemo(
    () => ({
      nombre: contact?.nombre ?? '',
      vendedor: contact?.vendedor ?? '',
    }),
    [contact]
  )

  useEffect(() => {
    if (!open || !contact) return
    const preferredId = initialTemplateId ?? builtinTemplates[0]?.id ?? null
    if (!preferredId) return
    setSelectedTemplateId(preferredId)
    const builtin = builtinTemplates.find((item) => item.id === preferredId)
    const custom = customTemplates.find((item) => item.id === preferredId)
    const templateMessage = builtin?.message ?? custom?.message ?? ''
    setMessage(templateMessage ? replaceTemplateVariables(templateMessage, variables) : '')
    setShowSaveForm(false)
    setSavingTitle('')
    setEditingTemplateId(null)
    setShowHistory(false)
    setImageUrl('')
  }, [open, contact, builtinTemplates, customTemplates, variables, initialTemplateId])

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

  // --- BUILTIN TEMPLATE SELECT ---
  const handleSelectBuiltin = (id: BuiltinTemplateId) => {
    setSelectedTemplateId(id)
    const template = builtinTemplates.find((item) => item.id === id)
    setMessage(template ? replaceTemplateVariables(template.message, variables) : '')
    setShowSaveForm(false)
    setEditingTemplateId(null)
  }

  // --- CUSTOM TEMPLATE SELECT ---
  const handleSelectCustom = (id: string) => {
    setSelectedTemplateId(id)
    const template = customTemplates.find((item) => item.id === id)
    setMessage(template ? replaceTemplateVariables(template.message, variables) : '')
    setShowSaveForm(false)
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
              {/* PLANTILLAS BASE */}
              {builtinTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`template-item ${selectedTemplateId === template.id ? 'active' : ''}`}
                  onClick={() => handleSelectBuiltin(template.id as BuiltinTemplateId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectBuiltin(template.id as BuiltinTemplateId) }
                  }}
                >
                  <div className="template-item-header">
                    <span className="template-title">{template.label}</span>
                  </div>
                  <span className="template-snippet">
                    {template.message ? replaceTemplateVariables(template.message, variables) : t('messaging.templateEmpty')}
                  </span>
                </div>
              ))}

              {/* MIS PLANTILLAS GUARDADAS */}
              {customTemplates.length > 0 && (
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
                  {customTemplates.map((template) =>
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
                        <span className="template-snippet">
                          {replaceTemplateVariables(template.message, variables)}
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
                {historyEntries.map((entry) => (
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
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
            {['{nombre}', '{vendedor}'].map((variable) => (
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
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', alignSelf: 'center' }}>
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
