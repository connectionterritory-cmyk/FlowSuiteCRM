import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { supabase } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'

type PerfilRecord = {
  nombre: string | null
  apellido: string | null
  email: string | null
  rol: string | null
  foto_url: string | null
}

export function PerfilPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [perfil, setPerfil] = useState<PerfilRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  useEffect(() => {
    const loadPerfil = async () => {
      if (!session?.user.id) return
      setLoading(true)
      const { data } = await supabase
        .from('usuarios')
        .select('nombre, apellido, email, rol, foto_url')
        .eq('id', session.user.id)
        .maybeSingle()
      setPerfil((data as PerfilRecord | null) ?? null)
      setPhotoPreview(((data as PerfilRecord | null) ?? null)?.foto_url ?? null)
      setLoading(false)
    }

    loadPerfil()
  }, [session?.user.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const displayName = [perfil?.nombre, perfil?.apellido].filter(Boolean).join(' ') || '-'

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setPhotoFile(file)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  const handleSavePhoto = async () => {
    if (!session?.user.id || !photoFile) return
    setSavingPhoto(true)
    setPhotoError(null)
    const extension = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
    const fileName = `${session.user.id}-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase
      .storage
      .from('avatars')
      .upload(fileName, photoFile, { upsert: true })
    if (uploadError) {
      setPhotoError(uploadError.message)
      setSavingPhoto(false)
      return
    }
    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(fileName)
    const { error: updateError } = await supabase
      .from('usuarios')
      .update({ foto_url: publicUrl.publicUrl })
      .eq('id', session.user.id)
    if (updateError) {
      setPhotoError(updateError.message)
      setSavingPhoto(false)
      return
    }
    setPerfil((prev) => (prev ? { ...prev, foto_url: publicUrl.publicUrl } : prev))
    setPhotoFile(null)
    setSavingPhoto(false)
  }

  return (
    <div className="page-stack">
      <SectionHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <div className="card detail-card">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : (
          <div className="detail-grid">
            <div>
              <p className="detail-label">{t('profile.fields.avatar')}</p>
              <div className="profile-avatar-block">
                {photoPreview ? (
                  <img src={photoPreview} alt={displayName} className="profile-avatar" />
                ) : (
                  <div className="profile-avatar placeholder">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="profile-avatar-actions">
                  <input type="file" accept="image/*" onChange={handlePhotoChange} />
                  <Button type="button" onClick={handleSavePhoto} disabled={!photoFile || savingPhoto}>
                    {savingPhoto ? t('common.saving') : t('profile.actions.savePhoto')}
                  </Button>
                </div>
              </div>
              {photoError && <div className="form-error">{photoError}</div>}
            </div>
            <div>
              <p className="detail-label">{t('profile.fields.name')}</p>
              <p className="detail-value">{displayName}</p>
            </div>
            <div>
              <p className="detail-label">{t('profile.fields.email')}</p>
              <p className="detail-value">{perfil?.email ?? session?.user.email ?? '-'}</p>
            </div>
            <div>
              <p className="detail-label">{t('profile.fields.role')}</p>
              <p className="detail-value">{perfil?.rol ?? '-'}</p>
            </div>
          </div>
        )}
      </div>

      <div className="perfil-actions">
        <Button type="button" variant="ghost" onClick={handleSignOut}>
          {t('common.signOut')}
        </Button>
      </div>
    </div>
  )
}
