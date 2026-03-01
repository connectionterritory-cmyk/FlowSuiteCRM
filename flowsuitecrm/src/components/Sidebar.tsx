import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { navItems, programSubItems, telemercadeoSubItems } from '../app/navigation'
import logoFull from '../assets/FlowSuiteCRM_Vector_Antigravity.svg'
import logoMark from '../assets/FlowSuiteCRM_Isotype_48px.png'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'
import { useViewMode } from '../data/ViewModeProvider'

type SidebarProps = {
  collapsed: boolean
  onToggle: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const isNavExpanded = !collapsed || mobileOpen
  const { t } = useTranslation()
  const location = useLocation()
  const { session } = useAuth()
  const { viewMode } = useViewMode()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const isProgramRoute =
    location.pathname === '/programas' ||
    location.pathname.startsWith('/4en14') ||
    location.pathname.startsWith('/conexiones-infinitas')
  const isTelemercadeoRoute = location.pathname.startsWith('/telemercadeo')
  const [programsOpen, setProgramsOpen] = useState(isProgramRoute)
  const [telemercadeoOpen, setTelemercadeoOpen] = useState(isTelemercadeoRoute)

  useEffect(() => {
    if (isProgramRoute) {
      setProgramsOpen(true)
    }
  }, [isProgramRoute])

  useEffect(() => {
    if (isTelemercadeoRoute) {
      setTelemercadeoOpen(true)
    }
  }, [isTelemercadeoRoute])

  useEffect(() => {
    let active = true
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setRole((data as { rol?: string } | null)?.rol ?? null)
      })
    return () => {
      active = false
    }
  }, [configured, session?.user.id])

  const handleProgramsToggle = () => {
    setProgramsOpen((prev) => !prev)
  }

  const handleTelemercadeoToggle = () => {
    setTelemercadeoOpen((prev) => !prev)
  }

  return (
    <>
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={onMobileClose} aria-hidden="true" />
      )}
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <img
            src={isNavExpanded ? logoFull : logoMark}
            alt={t('app.name')}
            className={isNavExpanded ? 'logo-full' : 'logo-mark'}
          />
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={mobileOpen ? onMobileClose : onToggle}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>
      <nav className="sidebar-nav">
        {navItems
          .filter((item) => {
            if (viewMode !== 'seller') return true
            return item.key !== 'usuarios' && item.key !== 'importaciones'
          })
          .filter((item) => {
            if (item.key !== 'hoy') return true
            return viewMode === 'seller'
          })
          .filter((item) => {
            if (item.key !== 'telemercadeo') return true
            if (viewMode === 'seller') {
              return role === 'telemercadeo' || role === 'supervisor_telemercadeo'
            }
            return role === 'admin' || role === 'distribuidor' || role === 'telemercadeo' || role === 'supervisor_telemercadeo'
          })
          .filter((item) => {
            if (item.key !== 'importaciones') return true
            return role === 'admin' || role === 'distribuidor'
          })
          .filter((item) => {
            if (item.key !== 'usuarios') return true
            return role === 'admin' || role === 'distribuidor'
          })
          .map((item) => {
          const Icon = item.icon

          if (item.key === 'programas') {
            return (
              <div key={item.key} className="nav-group">
                <button
                  type="button"
                  className={`nav-link nav-group-trigger ${isProgramRoute ? 'active' : ''}`}
                  onClick={handleProgramsToggle}
                  aria-expanded={programsOpen}
                >
                  <Icon className="nav-icon" />
                  {isNavExpanded && (
                    <span className="nav-label">{t(item.labelKey)}</span>
                  )}
                  {isNavExpanded && (
                    <span className={`nav-arrow ${programsOpen ? 'open' : ''}`}>
                      ▸
                    </span>
                  )}
                </button>
                {isNavExpanded && programsOpen && (
                  <div className="nav-subnav">
                    {programSubItems.map((subItem) => (
                      <NavLink
                        key={subItem.key}
                        to={subItem.path}
                        className={({ isActive }) =>
                          `nav-link nav-sublink ${isActive ? 'active' : ''}`
                        }
                      >
                        <span className="nav-label">{t(subItem.labelKey)}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          if (item.key === 'telemercadeo') {
            return (
              <div key={item.key} className="nav-group">
                <button
                  type="button"
                  className={`nav-link nav-group-trigger ${isTelemercadeoRoute ? 'active' : ''}`}
                  onClick={handleTelemercadeoToggle}
                  aria-expanded={telemercadeoOpen}
                >
                  <Icon className="nav-icon" />
                  {isNavExpanded && (
                    <span className="nav-label">{t(item.labelKey)}</span>
                  )}
                  {isNavExpanded && (
                    <span className={`nav-arrow ${telemercadeoOpen ? 'open' : ''}`}>
                      ▸
                    </span>
                  )}
                </button>
                {isNavExpanded && telemercadeoOpen && (
                  <div className="nav-subnav">
                    {telemercadeoSubItems.map((subItem) => (
                      <NavLink
                        key={subItem.key}
                        to={subItem.path}
                        className={({ isActive }) =>
                          `nav-link nav-sublink ${isActive ? 'active' : ''}`
                        }
                      >
                        <span className="nav-label">{t(subItem.labelKey)}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          return (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/dashboard'}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Icon className="nav-icon" />
              {isNavExpanded && (
                <span className="nav-label">{t(item.labelKey)}</span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </aside>
    </>
  )
}
