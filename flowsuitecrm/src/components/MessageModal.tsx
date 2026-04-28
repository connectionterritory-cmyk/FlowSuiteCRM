import React from 'react'
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
  onClose: () => void
}

function MessageModalContent({ onClose }: { onClose: () => void }) {
  const { 
    activeChannel, 
    setActiveChannel, 
    sendMessage, 
    sending,
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
    <div style={containerStyle}>
      {/* Mini-Header Interno (Canales) */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.2 }}>
              {contact?.nombre || 'Nuevo Mensaje'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
              {activeChannel === 'email' ? contact?.email : (contact?.telefono || 'Sin destino')}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={mainContentStyle}>
        {/* Left: Templates */}
        <TemplatePanel />

        {/* Center: Editor */}
        <div style={editorSectionStyle}>
          <MessageEditor />
          
          <div style={{ marginTop: 'auto', paddingTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button 
              style={{ padding: '0 2rem' }}
              onClick={sendMessage}
              disabled={sending}
            >
              {sending ? 'Enviando...' : (activeChannel === 'sms' ? 'Abrir Mensajes' : 'Enviar Mensaje')}
            </Button>
          </div>
        </div>

        {/* Right: Preview */}
        <MessagePreview />
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
      title="Gestión de Mensajería"
    >
      <MessagingProvider
        initialChannel={props.channel}
        initialContact={props.contact}
        initialTemplateId={props.initialTemplateId ?? null}
        contextType={props.contextType}
        mkMessageId={props.mkMessageId ?? null}
        onClose={props.onClose}
      >
        <MessageModalContent onClose={props.onClose} />
      </MessagingProvider>
    </Modal>
  )
}
