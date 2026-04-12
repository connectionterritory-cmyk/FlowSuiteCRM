import React, { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { useMessaging } from './MessagingProvider'
import { useToast } from '../useToast'
import { Button } from '../Button'
import { 
  PaperclipIcon, 
  FileIcon, 
  XIcon, 
  LoaderIcon
} from '../icons'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function AttachmentManager() {
  const { attachmentUrls, setAttachmentUrls } = useMessaging()
  const { showToast } = useToast()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          showToast(`Archivo demasiado grande (${file.name}). Máx 10MB`, 'error')
          continue
        }

        const fileExt = file.name.split('.').pop()
        const fileName = `${crypto.randomUUID()}.${fileExt}`
        const filePath = fileName

        const { error: uploadError } = await supabase.storage
          .from('messaging_attachments')
          .upload(filePath, file)

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage
          .from('messaging_attachments')
          .getPublicUrl(filePath)

        setAttachmentUrls([...attachmentUrls, publicUrl])
      }
    } catch (err) {
      console.error('Upload error:', err)
      showToast('Error al subir archivo', 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    const newUrls = [...attachmentUrls]
    newUrls.splice(index, 1)
    setAttachmentUrls(newUrls)
  }

  const isImage = (url: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(url)

  return (
    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PaperclipIcon style={{ width: 16, height: 16 }} />
          Adjuntos
        </label>
        <Button
          variant="ghost"
          style={{ height: '32px', fontSize: '0.75rem' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <LoaderIcon style={{ width: 14, height: 14, marginRight: '6px' }} />
          ) : (
            <PaperclipIcon style={{ width: 14, height: 14, marginRight: '6px' }} />
          )}
          Subir archivo
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          multiple
          onChange={handleFileChange}
        />
      </div>

      {attachmentUrls.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {attachmentUrls.map((url, i) => (
            <div 
              key={i} 
              style={{
                position: 'relative',
                background: 'var(--color-surface-strong)',
                borderRadius: '0.5rem',
                padding: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingRight: '2rem',
                minWidth: '130px',
                border: '1px solid var(--color-border)'
              }}
            >
              {isImage(url) ? (
                <div style={{ width: '2rem', height: '2rem', borderRadius: '4px', overflow: 'hidden', background: 'var(--color-surface)' }}>
                  <img src={url} alt="adjunto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{ width: '2rem', height: '2rem', borderRadius: '4px', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileIcon style={{ width: 16, height: 16, color: 'var(--text-muted)' }} />
                </div>
              )}
              <span style={{ fontSize: '0.7rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80px' }}>
                Archivo {i + 1}
              </span>
              <button
                onClick={() => removeAttachment(i)}
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px'
                }}
              >
                <XIcon style={{ width: 14, height: 14 }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
