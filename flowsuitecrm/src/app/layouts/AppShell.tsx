import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from '../../components/Sidebar'
import { Topbar } from '../../components/Topbar'
import { BottomNav } from '../../components/BottomNav'
import { navItems, programSubItems } from '../navigation'
import { ViewModeProvider } from '../../data/ViewModeProvider'
import { ModalProvider } from '../../modals/ModalProvider'

const STORAGE_KEY = 'flowsuite.sidebar.collapsed'
const THEME_KEY = 'flowsuite.theme'

export function AppShell() {
  const { t } = useTranslation()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setCollapsed(saved === 'true')
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('theme-light', theme === 'light')
    document.body.classList.toggle('theme-dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  const handleThemeToggle = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const currentTitle = useMemo(() => {
    const titleItems = [
      ...navItems.map((item) => ({ labelKey: item.labelKey, path: item.path })),
      ...programSubItems,
      { labelKey: 'nav.perfil', path: '/perfil' },
    ]
    const match = titleItems.find((item) => location.pathname.startsWith(item.path))
    if (!match) {
      return t('nav.dashboard')
    }
    return t(match.labelKey)
  }, [location.pathname, t])

  return (
    <div
      className="app-shell"
      style={
        {
          '--sidebar-width': collapsed ? '86px' : '260px',
        } as React.CSSProperties
      }
    >
      <ViewModeProvider>
        <ModalProvider>
          <Sidebar
            collapsed={collapsed}
            onToggle={handleToggle}
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
          />
          <div className="app-main">
            <Topbar
              title={currentTitle}
              theme={theme}
              onToggleTheme={handleThemeToggle}
              onMobileNavToggle={() => setMobileNavOpen(true)}
            />
            <main className="page">
              <Outlet />
            </main>
          </div>
          <BottomNav />
        </ModalProvider>
      </ViewModeProvider>
    </div>
  )
}
