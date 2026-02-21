import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from './Button'
import { supabase } from '../lib/supabase/client'
import { Modal } from './Modal'
import { useAuth } from '../auth/AuthProvider'
import { getOrganizationName } from '../lib/whatsappTemplates'
import { useToast } from './Toast'

type TopbarProps = {
  title: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function Topbar({ title, theme, onToggleTheme }: TopbarProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { showToast } = useToast()
  const [signingOut, setSigningOut] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgOpen) return
    const current = getOrganizationName(session?.user?.user_metadata)
    setOrgName(current)
    setOrgError(null)
  }, [orgOpen, session?.user?.user_metadata])

  const handleSignOut = async () => {
    setSigningOut(true)
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
    setSigningOut(false)
  }

  const handleSaveOrg = async () => {
    if (!session) return
    setOrgSaving(true)
    setOrgError(null)
    const value = orgName.trim() || getOrganizationName(null)
    const { error } = await supabase.auth.updateUser({
      data: { organization_name: value },
    })
    if (error) {
      setOrgError(error.message)
      showToast(error.message, 'error')
    } else {
      setOrgOpen(false)
      showToast(t('toast.success'))
    }
    setOrgSaving(false)
  }

  return (
    <header className="topbar">
      <div>
        <p className="topbar-kicker">{t('app.tagline')}</p>
        <h1 className="topbar-title">{title}</h1>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="icon-button theme-toggle"
          onClick={onToggleTheme}
          aria-label={t('common.toggleTheme')}
          title={t(theme === 'dark' ? 'common.themeLight' : 'common.themeDark')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <label className="lang-select">
          <span>{t('common.language')}</span>
          <select
            value={i18n.language}
            onChange={(event) => i18n.changeLanguage(event.target.value)}
          >
            <option value="es">{t('languages.es')}</option>
            <option value="en">{t('languages.en')}</option>
            <option value="pt">{t('languages.pt')}</option>
          </select>
        </label>
        <Button variant="ghost" type="button" onClick={() => setOrgOpen(true)}>
          {t('organization.action')}
        </Button>
        <Button variant="ghost" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? t('common.signingOut') : t('common.signOut')}
        </Button>
      </div>
      <Modal
        open={orgOpen}
        title={t('organization.title')}
        description={t('organization.subtitle')}
        onClose={() => setOrgOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setOrgOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleSaveOrg} disabled={orgSaving}>
              {orgSaving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="form-field">
            <span>{t('organization.field')}</span>
            <input
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              placeholder={t('organization.placeholder')}
            />
          </label>
        </div>
        {orgError && <div className="form-error">{orgError}</div>}
      </Modal>
    </header>
  )
}
