import React, { useEffect, useRef, useState } from 'react'
import './MessageModal.css'
import { Modal } from './Modal'
import { Button } from './Button'
import { MessagingProvider, useMessaging } from './messaging/MessagingProvider'
import { TemplatePanel } from './messaging/TemplatePanel'
import { MessageEditor } from './messaging/MessageEditor'
import { MessagePreview } from './messaging/MessagePreview'
import type { MessagingChannel, MessagingContact, MessagingContextType } from '../types/messaging'
import {
  WhatsappIcon,
  MailIcon,
  MessageSquareIcon,
} from './icons'

type MessageModalProps = {
  open: boolean
  channel: MessagingChannel
  contact: MessagingContact | null
  initialTemplateId?: string | null
  contextType?: MessagingContextType
  mkMessageId?: string | null
  ccEmails?: string[]
  onClose: () => void
}

function revealMobileField(target: EventTarget | null) {
  if (!window.matchMedia('(max-width: 767px)').matches || !(target instanceof HTMLElement)) return
  if (!target.matches('input, textarea, select')) return
  const scroller = target.closest<HTMLElement>('.message-editor-scroll')
  if (!scroller) return
  const field = target.getBoundingClientRect()
  const visible = scroller.getBoundingClientRect()
  if (field.top < visible.top || field.bottom > visible.bottom) {
    scroller.scrollTop += field.top - visible.top - 8
  }
}

function MessageModalContent({ onClose, initialTemplateId }: { onClose: () => void; initialTemplateId?: string | null }) {
  const [step, setStep] = useState<'templates' | 'editor'>(initialTemplateId ? 'editor' : 'templates')
  const containerRef = useRef<HTMLDivElement>(null)
  const stepTitleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const backdrop = containerRef.current?.closest<HTMLElement>('.message-modal-backdrop')
    const viewport = window.visualViewport
    if (!backdrop || !viewport) return
    let frame = 0
    const update = () => {
      backdrop.style.setProperty('--message-viewport-height', `${viewport.height}px`)
      backdrop.style.setProperty('--message-viewport-top', `${viewport.offsetTop}px`)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => revealMobileField(document.activeElement))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  const navigate = (next: 'templates' | 'editor') => {
    setStep(next)
    if (window.matchMedia('(max-width: 767px)').matches) {
      requestAnimationFrame(() => stepTitleRef.current?.focus())
    }
  }
  const { 
    activeChannel, 
    setActiveChannel, 
    sendMessage, 
    sending,
    missingVariables,
    contact 
  } = useMessaging()

  // Estilos adaptados al proyecto FlowSuiteCRM
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '80vh',
    maxHeight: '850px',
    overflow: 'hidden',
    backgroundColor: 'var(--card-bg, #1e2d3d)',
    color: 'var(--text-primary, #f1f5f9)',
    borderRadius: '0.75rem',
    position: 'relative'
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid var(--card-border, rgba(255,255,255,0.08))',
    background: 'var(--color-surface-strong, rgba(30,41,59,0.6))',
  }

  const mainContentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  }

  const editorSectionStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem',
    background: 'var(--content-bg, #0f1923)',
    overflowY: 'auto',
    minWidth: '450px'
  }

  const channelToggleStyle: React.CSSProperties = {
    display: 'flex',
    background: 'var(--color-input, rgba(255,255,255,0.08))',
    padding: '0.25rem',
    borderRadius: '0.75rem',
    gap: '4px'
  }

  return (
    <div ref={containerRef} className="message-workspace" data-step={step} style={containerStyle}>
      {/* Mini-Header Interno (Canales) */}
      <div className="message-channel-header" style={headerStyle}>
        <div className="message-recipient-row" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={channelToggleStyle}>
            <ChannelButton 
              active={activeChannel === 'whatsapp'} 
              channel="whatsapp" 
              icon={<WhatsappIcon style={{ width: 16, height: 16 }} />} 
              onClick={() => setActiveChannel('whatsapp')} 
            />
            <ChannelButton 
              active={activeChannel === 'email'} 
              channel="email" 
              icon={<MailIcon style={{ width: 16, height: 16 }} />} 
              onClick={() => setActiveChannel('email')} 
            />
            <ChannelButton 
              active={activeChannel === 'sms'} 
              channel="sms" 
              icon={<MessageSquareIcon style={{ width: 16, height: 16 }} />} 
              onClick={() => setActiveChannel('sms')} 
            />
          </div>
          <div style={{ width: 1, height: 16, background: 'var(--card-border)', margin: '0 0.5rem' }} />
          <div className="message-recipient-info" style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="message-mobile-only">Destinatario</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.2 }}>
              {contact?.nombre || 'Nuevo Mensaje'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
              {activeChannel === 'email' ? (contact?.email || 'Sin destino') : (contact?.telefono || 'Sin destino')}
            </span>
          </div>
        </div>
      </div>

      <nav className="message-mobile-nav" aria-label="Pasos del mensaje">
        <h4 ref={stepTitleRef} tabIndex={-1}>
          {step === 'templates' ? '1. Elige una plantilla' : '2. Revisa y edita'}
        </h4>
        <Button type="button" variant="ghost" onClick={() => navigate(step === 'templates' ? 'editor' : 'templates')}>
          {step === 'templates' ? 'Continuar al mensaje →' : '← Volver a plantillas'}
        </Button>
      </nav>

      {/* Main Content */}
      <div className="message-main" style={mainContentStyle}>
        {/* Left: Templates */}
        <TemplatePanel onSelect={() => navigate('editor')} />

        {/* Center: Editor */}
        <div className="message-editor-section" style={editorSectionStyle}>
          <div className="message-editor-scroll" onFocusCapture={(event) => revealMobileField(event.target)}>
            <MessageEditor />
            <details className="message-mobile-preview">
              <summary>Vista previa del envío</summary>
              <MessagePreview />
            </details>
          </div>
          
          {missingVariables.length > 0 && (
            <p className="message-missing-variables" role="alert" id="message-missing-variables">
              No se puede enviar. Completa o reemplaza: {missingVariables.map(name => `{${name}}`).join(', ')}.
            </p>
          )}
          <div className="message-send-actions" style={{ marginTop: 'auto', paddingTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button 
              style={{ padding: '0 2rem' }}
              onClick={sendMessage}
              disabled={sending || missingVariables.length > 0}
              aria-describedby={missingVariables.length ? 'message-missing-variables' : undefined}
            >
              {sending ? 'Enviando...' : (activeChannel === 'sms' ? 'Abrir Mensajes' : 'Enviar Mensaje')}
            </Button>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="message-desktop-preview"><MessagePreview /></div>
      </div>
    </div>
  )
}

function ChannelButton({ 
  active, 
  channel, 
  icon, 
  onClick 
}: { 
  active: boolean; 
  channel: string; 
  icon: React.ReactNode; 
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      title={channel.toUpperCase()}
      aria-label={channel.toUpperCase()}
      aria-pressed={active}
      type="button"
      style={{
        padding: '0.5rem',
        borderRadius: '0.6rem',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: active ? 'var(--card-bg)' : 'transparent',
        boxShadow: active ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
        color: active ? 'var(--accent, #2563eb)' : 'var(--text-muted)',
        transition: 'all 0.2s'
      }}
    >
      {icon}
    </button>
  )
}

export function MessageModal(props: MessageModalProps) {
  if (!props.open) return null

  return (
    <Modal 
      open={props.open} 
      onClose={props.onClose} 
      size="xl"
      className="message-modal"
      bodyClassName="message-modal-body"
      backdropClassName="message-modal-backdrop"
      title="Gestión de Mensajería"
    >
      <MessagingProvider
        initialChannel={props.channel}
        initialContact={props.contact}
        initialTemplateId={props.initialTemplateId ?? null}
        contextType={props.contextType}
        mkMessageId={props.mkMessageId ?? null}
        ccEmails={props.ccEmails}
        onClose={props.onClose}
      >
        <MessageModalContent onClose={props.onClose} initialTemplateId={props.initialTemplateId} />
      </MessagingProvider>
    </Modal>
  )
}
