import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import { buildWhatsappUrl, replaceTemplateVariables } from '../lib/whatsappTemplates'
import { supabase } from '../lib/supabase/client'
import { useToast } from './Toast'
import type { MessagingChannel, MessagingContact } from '../types/messaging'

type MessageModalProps = {
  open: boolean
  channel: MessagingChannel
  contact: MessagingContact | null
  onClose: () => void
}

const templateIds = ['referido', 'seguimiento', 'recordatorio', 'personalizado'] as const

const sanitizePhone = (value: string) => value.replace(/\D/g, '')

export function MessageModal({ open, channel, contact, onClose }: MessageModalProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [selectedTemplateId, setSelectedTemplateId] = useState<(typeof templateIds)[number] | null>(null)
  const [message, setMessage] = useState('')
  const [activeChannel, setActiveChannel] = useState<MessagingChannel>(channel)
  const [sending, setSending] = useState(false)

  const templates = useMemo(() => {
    return templateIds.map((id) => ({
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
    const defaultTemplate = templates[0]
    if (!defaultTemplate) return
    setSelectedTemplateId(defaultTemplate.id)
    setMessage(replaceTemplateVariables(defaultTemplate.message, variables))
  }, [open, contact, templates, variables])

  useEffect(() => {
    if (!open) return
    setActiveChannel(channel)
  }, [channel, open])

  if (!open || !contact) return null

  const channelLabel = t(`messaging.channel.${activeChannel}`)
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null
  const canSendMessage = message.trim().length > 0
  const phoneValue = contact.telefono ? sanitizePhone(contact.telefono) : ''
  const hasPhone = phoneValue.length > 0
  const hasEmail = Boolean(contact.email?.trim())
  const channelTabs: MessagingChannel[] = ['whatsapp', 'sms', 'email']

  const warningMessage =
    activeChannel === 'email'
      ? !hasEmail
        ? t('messaging.emailMissing')
        : null
      : !hasPhone
        ? t('messaging.phoneMissing')
        : null

  const handleSelectTemplate = (id: (typeof templateIds)[number]) => {
    setSelectedTemplateId(id)
    const template = templates.find((item) => item.id === id)
    const nextMessage = template ? replaceTemplateVariables(template.message, variables) : ''
    setMessage(nextMessage)
  }

  const updateLeadContact = useCallback(async () => {
    if (!contact.leadId) return
    const { error } = await supabase
      .from('leads')
      .update({
        estado_pipeline: 'contactado',
        whatsapp_mensaje_enviado_at: new Date().toISOString(),
      })
      .eq('id', contact.leadId)
    if (error) {
      showToast(error.message, 'error')
    }
  }, [contact.leadId, showToast])

  const handleSend = async () => {
    if (!canSendMessage || warningMessage) return
    setSending(true)
    if (activeChannel === 'whatsapp') {
      const whatsappUrl = contact.telefono ? buildWhatsappUrl(contact.telefono, message) : null
      if (whatsappUrl) {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
      }
    }
    if (activeChannel === 'sms') {
      if (hasPhone) {
        const smsUrl = `sms:${phoneValue}?&body=${encodeURIComponent(message)}`
        window.open(smsUrl, '_blank', 'noopener,noreferrer')
      }
    }
    if (activeChannel === 'email') {
      if (hasEmail && contact.email) {
        const subject = t('messaging.emailSubject')
        const emailUrl = `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
        window.open(emailUrl, '_blank', 'noopener,noreferrer')
      }
    }
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
          <Button type="button" onClick={handleSend} disabled={!canSendMessage || Boolean(warningMessage) || sending}>
            {sending ? t('common.saving') : t('messaging.send')}
          </Button>
        </>
      }
    >
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
        <div className="template-list">
          {templates.map((template) => (
            <div
              key={template.id}
              className={`template-item ${selectedTemplateId === template.id ? 'active' : ''}`}
              onClick={() => handleSelectTemplate(template.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  handleSelectTemplate(template.id)
                }
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
        </div>
        <div className="template-preview">
          <h4>{t('messaging.editorTitle')}</h4>
          <label className="form-field template-message">
            <span>{t('messaging.messageLabel')}</span>
            <textarea
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t('messaging.messagePlaceholder')}
            />
          </label>
          <div className="template-variables">{t('messaging.variables')}</div>
          {selectedTemplate && !selectedTemplate.message && (
            <p className="template-preview-text muted">{t('messaging.customHint')}</p>
          )}
          {warningMessage && <p className="template-warning">{warningMessage}</p>}
        </div>
      </div>
    </Modal>
  )
}
