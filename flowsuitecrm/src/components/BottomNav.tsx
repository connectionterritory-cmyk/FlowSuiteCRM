import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconCustomers, IconDashboard, IconLeads, IconMoreHorizontal } from './icons'
import { QuickActionsSheet } from './QuickActionsSheet'
import type { ActionKey } from './QuickActionsSheet'

type BottomNavProps = {
  onOpenMenu: () => void
  menuOpen: boolean
}

export function BottomNav({ onOpenMenu, menuOpen }: BottomNavProps) {
  const { t } = useTranslation()
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickInitial, setQuickInitial] = useState<ActionKey | null>(null)

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: ActionKey | null }>).detail
      setQuickInitial(detail?.action ?? null)
      setQuickOpen(true)
    }
    window.addEventListener('quick-actions:open', handleOpen)
    return () => window.removeEventListener('quick-actions:open', handleOpen)
  }, [])

  return (
    <nav className="bottom-nav" aria-label="Mobile">
      <NavLink
        to="/hub"
        className={({ isActive }) =>
          `bottom-nav-link ${isActive ? 'active' : ''}`
        }
      >
        <IconDashboard className="bottom-nav-icon" />
        <span>{t('nav.hub')}</span>
      </NavLink>
      <NavLink
        to="/leads"
        className={({ isActive }) =>
          `bottom-nav-link ${isActive ? 'active' : ''}`
        }
      >
        <IconLeads className="bottom-nav-icon" />
        <span>{t('nav.leads')}</span>
      </NavLink>
      <button
        type="button"
        className="bottom-nav-create"
        aria-label={t('quickActions.title')}
        onClick={() => setQuickOpen(true)}
      >
        +
      </button>
      <NavLink
        to="/clientes"
        className={({ isActive }) =>
          `bottom-nav-link ${isActive ? 'active' : ''}`
        }
      >
        <IconCustomers className="bottom-nav-icon" />
        <span>{t('nav.clientes')}</span>
      </NavLink>
      <button
        type="button"
        className={`bottom-nav-link bottom-nav-menu-trigger ${menuOpen ? 'active' : ''}`}
        onClick={onOpenMenu}
      >
        <IconMoreHorizontal className="bottom-nav-icon" />
        <span>{t('nav.mas')}</span>
      </button>
      <QuickActionsSheet
        open={quickOpen}
        initialAction={quickInitial}
        onClose={() => {
          setQuickOpen(false)
          setQuickInitial(null)
        }}
      />
    </nav>
  )
}
