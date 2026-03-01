import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconConnections, IconCustomers, IconDashboard, IconLeads, IconUsers } from './icons'
import { useViewMode } from '../data/ViewModeProvider'
import { useUsers } from '../data/UsersProvider'
import { QuickActionsSheet } from './QuickActionsSheet'
import type { ActionKey } from './QuickActionsSheet'

export function BottomNav() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { viewMode } = useViewMode()
  const { currentRole } = useUsers()
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickInitial, setQuickInitial] = useState<ActionKey | null>(null)
  const canTelemercadeo =
    currentRole === 'admin' ||
    currentRole === 'distribuidor' ||
    currentRole === 'telemercadeo' ||
    currentRole === 'supervisor_telemercadeo'
  const showTelemercadeo = viewMode === 'distributor' && canTelemercadeo
  const showSellerNav = viewMode === 'seller'

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
      {showSellerNav ? (
        <>
          <NavLink
            to="/hoy"
            className={({ isActive }) =>
              `bottom-nav-link ${isActive ? 'active' : ''}`
            }
          >
            <IconDashboard className="bottom-nav-icon" />
            <span>{t('nav.hoy')}</span>
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
            to="/cierres"
            className={({ isActive }) =>
              `bottom-nav-link ${isActive ? 'active' : ''}`
            }
          >
            <IconConnections className="bottom-nav-icon" />
            <span>{t('nav.cierres')}</span>
          </NavLink>
          <NavLink
            to="/clientes"
            className={({ isActive }) =>
              `bottom-nav-link ${isActive ? 'active' : ''}`
            }
          >
            <IconCustomers className="bottom-nav-icon" />
            <span>{t('nav.clientes')}</span>
          </NavLink>
        </>
      ) : (
        <>
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `bottom-nav-link ${isActive ? 'active' : ''}`
            }
          >
            <IconDashboard className="bottom-nav-icon" />
            <span>{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink
            to="/clientes"
            className={({ isActive }) =>
              `bottom-nav-link ${isActive ? 'active' : ''}`
            }
          >
            <IconCustomers className="bottom-nav-icon" />
            <span>{t('nav.clientes')}</span>
          </NavLink>
        </>
      )}
      {showTelemercadeo && (
        <>
          <button
            type="button"
            className="bottom-nav-create"
            aria-label={t('telemercadeo.actions.newActivation')}
            onClick={() => navigate('/telemercadeo?new=1')}
          >
            +
          </button>
          <NavLink
            to="/telemercadeo"
            className={({ isActive }) =>
              `bottom-nav-link ${isActive ? 'active' : ''}`
            }
          >
            <IconConnections className="bottom-nav-icon" />
            <span>{t('nav.telemercadeo')}</span>
          </NavLink>
        </>
      )}
      {!showSellerNav && (
        <NavLink
          to="/perfil"
          className={({ isActive }) =>
            `bottom-nav-link ${isActive ? 'active' : ''}`
          }
        >
          <IconUsers className="bottom-nav-icon" />
          <span>{t('nav.perfil')}</span>
        </NavLink>
      )}
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
