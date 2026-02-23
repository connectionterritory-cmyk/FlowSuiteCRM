import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconConnections, IconCustomers, IconDashboard, IconUsers } from './icons'

export function BottomNav() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <nav className="bottom-nav" aria-label="Mobile">
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
      <NavLink
        to="/perfil"
        className={({ isActive }) =>
          `bottom-nav-link ${isActive ? 'active' : ''}`
        }
      >
        <IconUsers className="bottom-nav-icon" />
        <span>{t('nav.perfil')}</span>
      </NavLink>
    </nav>
  )
}
