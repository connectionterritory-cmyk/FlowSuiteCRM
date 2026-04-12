import React from 'react'
import { useMessaging } from './MessagingProvider'
import { 
  SendIcon,
  UserIcon
} from '../icons'

export function MessagePreview() {
  const { 
    message, 
    subject,
    activeChannel, 
    resolveMessage, 
    attachmentUrls,
    contact,
    variables
  } = useMessaging()

  const resolved = resolveMessage(message)

  // Estilos adaptados
  const previewContainerStyle: React.CSSProperties = {
    width: '350px',
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid var(--color-border)',
    background: 'var(--color-surface, rgba(15,23,42,0.12))',
    padding: '1.5rem',
    overflowY: 'auto'
  }

  const phoneMockupStyle: React.CSSProperties = {
    flex: 1,
    background: 'var(--card-bg)',
    borderRadius: '1.5rem',
    border: '6px solid var(--color-border)',
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '600px'
  }

  const outgoingBubbleStyle: React.CSSProperties = {
    padding: '0.75rem',
    borderRadius: '0.75rem 0 0.75rem 0.75rem',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
    maxWidth: '90%',
    alignSelf: 'flex-end',
    background: activeChannel === 'whatsapp' ? '#dcf8c6' : (activeChannel === 'email' ? 'var(--color-surface-strong)' : 'var(--accent)'),
    color: (activeChannel === 'whatsapp' || activeChannel === 'email') ? '#000' : '#fff'
  }

  return (
    <div style={previewContainerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>
        <div style={{ width: '2rem', height: '2rem', borderRadius: '50%', background: 'var(--color-surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SendIcon style={{ width: 14, height: 14 }} />
        </div>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vista Previa</span>
      </div>

      {/* Device Mockup */}
      <div style={phoneMockupStyle}>
        {/* Header Mockup */}
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-strong)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '2rem', height: '2rem', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>
            {contact?.nombre?.charAt(0) || <UserIcon style={{ width: 16, height: 16 }} />}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {contact?.nombre || 'Destinatario'}
            </p>
            <p style={{ margin: 0, fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
              {activeChannel}
            </p>
          </div>
        </div>

        {/* Content Mockup */}
        <div style={{ flex: 1, padding: '1rem', background: activeChannel === 'whatsapp' ? '#e5ddd5' : 'var(--content-bg)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Incoming bubble (placeholder) */}
          <div style={{ alignSelf: 'flex-start', background: '#fff', padding: '0.5rem', borderRadius: '0 0.5rem 0.5rem 0.5rem', fontSize: '0.75rem', maxWidth: '80%', color: '#000' }}>
            <div style={{ fontSize: '0.6rem', color: '#999', marginBottom: '2px' }}>9:00 AM</div>
            Hola, ¿cómo estás?
          </div>

          {/* Outgoing bubble (The actual preview) */}
          <div style={outgoingBubbleStyle}>
            {/* Subject if Email */}
            {activeChannel === 'email' && subject && (
              <div style={{ marginBottom: '8px', fontWeight: 700, fontSize: '0.75rem', borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: '4px' }}>
                Asunto: {subject}
              </div>
            )}

            {/* Attachments Preview */}
            {attachmentUrls.map((url, i) => (
              <div key={i} style={{ marginBottom: '8px', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
                {/\.(jpg|jpeg|png|webp|gif)$/i.test(url) ? (
                  <img src={url} alt="attached" style={{ width: '100%', display: 'block' }} />
                ) : (
                  <div style={{ padding: '8px', background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.65rem' }}>
                    📎 Archivo {i+1}
                  </div>
                )}
              </div>
            ))}

            {/* Resolved Message */}
            <div style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {resolved || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Sin contenido...</span>}
            </div>
            
            <div style={{ fontSize: '0.6rem', textAlign: 'right', marginTop: '4px', opacity: 0.6 }}>
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
            </div>
          </div>
        </div>
      </div>

      {/* Variables Section */}
      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Campos Resueltos</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {Object.entries(variables).filter(([_, v]) => v).map(([k, v]) => {
            // Protección contra objetos (como errores de i18n o de base de datos)
            const displayValue = (v && typeof v === 'object') 
              ? (v as any).text || JSON.stringify(v) 
              : String(v);

            return (
              <div key={k} style={{ padding: '4px 8px', background: 'var(--card-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>{k}</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayValue}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  )
}
