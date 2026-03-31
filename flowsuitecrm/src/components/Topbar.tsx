import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from './Button'
import { supabase } from '../lib/supabase/client'
import { Modal } from './Modal'
import { useAuth } from '../auth/AuthProvider'
import { getOrganizationName } from '../lib/whatsappTemplates'
import { useToast } from './Toast'
import { useViewMode } from '../data/ViewModeProvider'
import { useUsers } from '../data/UsersProvider'

type TopbarProps = {
  title: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onMobileNavToggle: () => void
}

export function Topbar({ title, theme, onToggleTheme, onMobileNavToggle }: TopbarProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { viewMode, setViewMode, hasDistribuidorScope } = useViewMode()
  const { currentUser } = useUsers()
  const isMasterAdmin = session?.user?.email === 'royalflorida@gmail.com'
  const [signingOut, setSigningOut] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!orgOpen) return
    const current = getOrganizationName(session?.user?.user_metadata)
    setOrgName(current)
    setOrgError(null)
  }, [orgOpen, session?.user?.user_metadata])

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) return
      if (menuRef.current.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

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
      <button
        type="button"
        className="icon-button topbar-hamburger"
        onClick={onMobileNavToggle}
        aria-label={t('sidebar.expand')}
      >
        ☰
      </button>
      <div>
        <p className="topbar-kicker">{t('app.tagline')}</p>
        <h1 className="topbar-title">{title}</h1>
      </div>
      <div className="topbar-actions">
        {isMasterAdmin ? (
          <div className="topbar-segment" role="status" aria-label="Administrador master">
            <span style={{ fontWeight: 600 }}>ADMINISTRADOR MASTER</span>
          </div>
        ) : (
          hasDistribuidorScope && (currentUser?.rol === 'admin' || currentUser?.rol === 'distribuidor') && (
            <div className="topbar-segment" role="group" aria-label={t('common.modeLabel')}>
              <button
                type="button"
                className={viewMode === 'seller' ? 'active' : ''}
                onClick={() => setViewMode('seller')}
              >
                {t('common.modeSeller')}
              </button>
              <button
                type="button"
                className={viewMode === 'distributor' ? 'active' : ''}
                onClick={() => setViewMode('distributor')}
              >
                {t('common.modeDistributor')}
              </button>
            </div>
          )
        )}
        <button
          type="button"
          className="icon-button theme-toggle"
          onClick={onToggleTheme}
          aria-label={t('common.toggleTheme')}
          title={t(theme === 'dark' ? 'common.themeLight' : 'common.themeDark')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <div className="topbar-menu" ref={menuRef}>
          <button
            type="button"
            className="topbar-avatar"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={t('profile.title')}
            title={t('profile.title')}
          >
            {currentUser?.foto_url ? (
              <img src={currentUser.foto_url} alt={t('profile.title')} />
            ) : (
              <span>{(currentUser?.nombre?.[0] || session?.user.email?.[0] || '?').toUpperCase()}</span>
            )}
          </button>
          {menuOpen && (
            <div className="topbar-menu-card">
              <button
                type="button"
                className="topbar-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/perfil')
                }}
              >
                {t('profile.title')}
              </button>
              <div className="topbar-menu-item">
                <span>{t('common.language')}</span>
                <select
                  value={i18n.language}
                  onChange={(event) => i18n.changeLanguage(event.target.value)}
                >
                  <option value="es">{t('languages.es')}</option>
                  <option value="en">{t('languages.en')}</option>
                  <option value="pt">{t('languages.pt')}</option>
                </select>
              </div>
              <button
                type="button"
                className="topbar-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setOrgOpen(true)
                }}
              >
                {t('organization.action')}
              </button>
              <button
                type="button"
                className="topbar-menu-item danger"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? t('common.signingOut') : t('common.signOut')}
              </button>
            </div>
          )}
        </div>
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
