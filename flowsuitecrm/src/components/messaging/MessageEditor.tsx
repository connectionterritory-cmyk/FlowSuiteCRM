import React, { useRef } from 'react'
import { useMessaging } from './MessagingProvider'
import { InsertFieldDropdown } from '../InsertFieldDropdown'
import { AttachmentManager } from './AttachmentManager'
import { EMAIL_SENDERS } from '../../lib/emailSenders'
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ClockIcon,
  SaveIcon
} from '../icons'

export function MessageEditor() {
  const {
    message,
    setMessage,
    subject,
    setSubject,
    activeChannel,
    scheduledFor,
    setScheduledFor,
    emailSender,
    setEmailSender,
    sendMessage,
  } = useMessaging()
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertText = (text: string) => {
    if (!textareaRef.current) {
      setMessage(message + text)
      return
    }

    const { selectionStart, selectionEnd } = textareaRef.current
    const newContent = 
      message.substring(0, selectionStart) + 
      text + 
      message.substring(selectionEnd)
    
    setMessage(newContent)
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const newCursorPos = selectionStart + text.length
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 10)
  }

  const applyFormat = (type: 'bold' | 'italic' | 'list') => {
    if (!textareaRef.current) return
    const { selectionStart, selectionEnd } = textareaRef.current
    const selected = message.substring(selectionStart, selectionEnd)
    
    let formatted = ''
    if (activeChannel === 'email') {
      if (type === 'bold') formatted = `<b>${selected}</b>`
      if (type === 'italic') formatted = `<i>${selected}</i>`
      if (type === 'list') formatted = `<ul>\n  <li>${selected}</li>\n</ul>`
    } else {
      if (type === 'bold') formatted = `*${selected}*`
      if (type === 'italic') formatted = `_${selected}_`
      if (type === 'list') formatted = `\n- ${selected}`
    }
    
    insertText(formatted)
  }

  // Estilos adaptados
  const editorContainerStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: '400px'
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--color-input)',
    border: '1px solid var(--color-border)',
    borderRadius: '0.75rem',
    padding: '0.75rem 1rem',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
    fontWeight: 500,
    outline: 'none',
    marginBottom: '1rem'
  }

  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface-strong)',
  }

  const toolbarButtonStyle: React.CSSProperties = {
    padding: '0.4rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '0.4rem',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }

  return (
    <div style={editorContainerStyle}>
      {activeChannel === 'email' && (
        <>
          {/* Selector de remitente */}
          <select
            value={emailSender.id}
            onChange={(e) => {
              const found = EMAIL_SENDERS.find(s => s.id === e.target.value)
              if (found) setEmailSender(found)
            }}
            style={{ ...inputStyle, marginBottom: '0.5rem', cursor: 'pointer' }}
          >
            {EMAIL_SENDERS.map(s => (
              <option key={s.id} value={s.id}>
                {s.label} — {s.fromEmail}
              </option>
            ))}
          </select>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.65rem', color: 'var(--text-muted)', paddingLeft: '4px' }}>
            Respuestas llegarán a: <strong>{emailSender.replyTo}</strong>
          </p>

          {/* Asunto */}
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Asunto del correo..."
            style={inputStyle}
          />
        </>
      )}

      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        background: 'var(--card-bg)', 
        border: '1px solid var(--color-border)', 
        borderRadius: '1rem', 
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
      }}>
        {/* Toolbar */}
        <div style={toolbarStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button type="button" onClick={() => applyFormat('bold')} style={toolbarButtonStyle} title="Negrita">
              <BoldIcon style={{ width: 16, height: 16 }} />
            </button>
            <button type="button" onClick={() => applyFormat('italic')} style={toolbarButtonStyle} title="Cursiva">
              <ItalicIcon style={{ width: 16, height: 16 }} />
            </button>
            <button type="button" onClick={() => applyFormat('list')} style={toolbarButtonStyle} title="Lista">
              <ListIcon style={{ width: 16, height: 16 }} />
            </button>
            <div style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 4px' }} />
            <InsertFieldDropdown onInsert={insertText} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-input)', padding: '4px 8px', borderRadius: '8px' }}>
            <ClockIcon style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.75rem', outline: 'none' }}
            />
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void sendMessage()
            }
          }}
          placeholder="Escribe tu mensaje aquí..."
          style={{
            flex: 1,
            width: '100%',
            padding: '1rem',
            resize: 'none',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            lineHeight: 1.6,
            fontFamily: 'inherit'
          }}
        />

        {/* Attachments Section */}
        <div style={{ padding: '0 1rem 1rem' }}>
          <AttachmentManager />
        </div>
      </div>
      
      <p style={{ marginTop: '0.5rem', fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', padding: '0 4px' }}>
        <SaveIcon style={{ width: 12, height: 12 }} />
        Atajo: Presiona Ctrl + Enter para enviar rápidamente.
      </p>
    </div>
  )
}
