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
}

export function PerfilPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [perfil, setPerfil] = useState<PerfilRecord | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadPerfil = async () => {
      if (!session?.user.id) return
      setLoading(true)
      const { data } = await supabase
        .from('usuarios')
        .select('nombre, apellido, email, rol')
        .eq('id', session.user.id)
        .maybeSingle()
      setPerfil((data as PerfilRecord | null) ?? null)
      setLoading(false)
    }

    loadPerfil()
  }, [session?.user.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const displayName = [perfil?.nombre, perfil?.apellido].filter(Boolean).join(' ') || '-'

  return (
    <div className="page-stack">
      <SectionHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <div className="card detail-card">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : (
          <div className="detail-grid">
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
