import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { supabase } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'

type PerfilRecord = {
  nombre: string | null
  apellido: string | null
  email: string | null
  rol: string | null
  foto_url: string | null
  ciudad: string | null
  estado_region: string | null
  pais: string | null
  timezone: string | null
}

const PAISES = [
  { value: 'US', label: 'Estados Unidos' },
  { value: 'CO', label: 'Colombia' },
]

const ESTADOS_US = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' }, { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' }, { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' }, { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' }, { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' }, { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' }, { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
]

const DEPARTAMENTOS_CO = [
  { value: 'BOG', label: 'Bogotá D.C.' }, { value: 'ANT', label: 'Antioquia' },
  { value: 'VAC', label: 'Valle del Cauca' }, { value: 'ATL', label: 'Atlántico' },
  { value: 'BOL', label: 'Bolívar' }, { value: 'CUN', label: 'Cundinamarca' },
  { value: 'SAN', label: 'Santander' }, { value: 'COR', label: 'Córdoba' },
  { value: 'NAR', label: 'Nariño' }, { value: 'TOL', label: 'Tolima' },
  { value: 'CAU', label: 'Cauca' }, { value: 'HUI', label: 'Huila' },
  { value: 'MAG', label: 'Magdalena' }, { value: 'CAQ', label: 'Caquetá' },
  { value: 'NSA', label: 'Norte de Santander' }, { value: 'RIS', label: 'Risaralda' },
  { value: 'SUC', label: 'Sucre' }, { value: 'CES', label: 'Cesar' },
  { value: 'CAL', label: 'Caldas' }, { value: 'MET', label: 'Meta' },
  { value: 'CHO', label: 'Chocó' }, { value: 'QUI', label: 'Quindío' },
  { value: 'ARU', label: 'Arauca' }, { value: 'COL', label: 'Colombia' },
]

const TIMEZONE_MAP: Record<string, string> = {
  FL: 'America/New_York', NY: 'America/New_York',
  CA: 'America/Los_Angeles',
  TX: 'America/Chicago', IL: 'America/Chicago',
  CO: 'America/Denver',
  AZ: 'America/Phoenix',
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
  COL: 'America/Bogota',
}

function getTimezone(estado: string): string {
  return TIMEZONE_MAP[estado] ?? 'America/New_York'
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

  // Location form state
  const [pais, setPais] = useState('US')
  const [estadoRegion, setEstadoRegion] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [savingLocation, setSavingLocation] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationSuccess, setLocationSuccess] = useState(false)

  const regionOptions = pais === 'CO' ? DEPARTAMENTOS_CO : ESTADOS_US

  useEffect(() => {
    const loadPerfil = async () => {
      if (!session?.user.id) return
      setLoading(true)
      const { data } = await supabase
        .from('usuarios')
        .select('nombre, apellido, email, rol, foto_url, ciudad, estado_region, pais, timezone')
        .eq('id', session.user.id)
        .maybeSingle()
      const record = (data as PerfilRecord | null) ?? null
      setPerfil(record)
      setPhotoPreview(record?.foto_url ?? null)
      setPais(record?.pais ?? 'US')
      setEstadoRegion(record?.estado_region ?? '')
      setCiudad(record?.ciudad ?? '')
      setLoading(false)
    }

    loadPerfil()
  }, [session?.user.id])

  const handlePaisChange = (newPais: string) => {
    setPais(newPais)
    setEstadoRegion('')
  }

  const handleEstadoChange = (newEstado: string) => {
    setEstadoRegion(newEstado)
  }

  const handleSaveLocation = async () => {
    if (!session?.user.id) return
    setSavingLocation(true)
    setLocationError(null)
    setLocationSuccess(false)
    const timezone = getTimezone(estadoRegion)
    const { error } = await supabase
      .from('usuarios')
      .update({ ciudad, estado_region: estadoRegion, pais, timezone })
      .eq('id', session.user.id)
    if (error) {
      setLocationError(error.message)
    } else {
      setLocationSuccess(true)
      setPerfil((prev) => prev ? { ...prev, ciudad, estado_region: estadoRegion, pais, timezone } : prev)
    }
    setSavingLocation(false)
  }

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

      <div className="card detail-card">
        <p className="detail-label" style={{ marginBottom: '1rem', fontWeight: 600 }}>
          {t('profile.fields.location')}
        </p>
        <div className="form-stack">
          <div className="form-group">
            <label className="form-label">{t('profile.fields.pais')}</label>
            <select
              className="form-input"
              value={pais}
              onChange={(e) => handlePaisChange(e.target.value)}
            >
              {PAISES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{t('profile.fields.estadoRegion')}</label>
            <select
              className="form-input"
              value={estadoRegion}
              onChange={(e) => handleEstadoChange(e.target.value)}
            >
              <option value="">{t('common.select')}</option>
              {regionOptions.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{t('profile.fields.ciudad')}</label>
            <input
              type="text"
              className="form-input"
              value={ciudad}
              onChange={(e) => setCiudad(e.target.value)}
            />
          </div>

          {locationError && <div className="form-error">{locationError}</div>}
          {locationSuccess && (
            <div className="form-success">{t('profile.actions.locationSaved')}</div>
          )}

          <Button
            type="button"
            onClick={handleSaveLocation}
            disabled={savingLocation}
          >
            {savingLocation ? t('common.saving') : t('profile.actions.saveLocation')}
          </Button>
        </div>
      </div>

      <div className="perfil-actions">
        <Button type="button" variant="ghost" onClick={handleSignOut}>
          {t('common.signOut')}
        </Button>
      </div>
    </div>
  )
}
