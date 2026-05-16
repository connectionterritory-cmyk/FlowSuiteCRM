import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isNavGroupItem, isNavLeafItem, navItems } from '../app/navigation'
import type { NavItem, NavLeafItem } from '../app/navigation'
import logoFull from '../assets/FlowSuiteCRM_Vector_Antigravity.svg'
import logoMark from '../assets/FlowSuiteCRM_Isotype_48px.png'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useAuth } from '../auth/useAuth'
import { useViewMode } from '../data/useViewMode'

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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let active = true
    if (!configured || !session?.user.id) return
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

  const effectiveRole = session?.user.id ? role : null
  const isAdminLike = effectiveRole === 'admin' || effectiveRole === 'distribuidor'
  const canUseTelemercadeo =
    effectiveRole === 'admin' ||
    effectiveRole === 'distribuidor' ||
    effectiveRole === 'telemercadeo' ||
    effectiveRole === 'supervisor_telemercadeo'

  const canShowItem = (item: NavLeafItem) => {
    if (viewMode === 'seller' && (item.key === 'usuarios' || item.key === 'importaciones')) {
      return false
    }
    if (item.key === 'telemercadeo' || item.key.startsWith('telemercadeo-')) {
      if (viewMode === 'seller') {
        return effectiveRole === 'telemercadeo' || effectiveRole === 'supervisor_telemercadeo'
      }
      return canUseTelemercadeo
    }
    if (item.key === 'importaciones' || item.key === 'usuarios') {
      return isAdminLike
    }
    if (item.key === 'productos') {
      if (viewMode === 'seller') return false
      return isAdminLike
    }
    return true
  }

  const filterVisibleItems = (items: NavItem[]): NavItem[] =>
    items.reduce<NavItem[]>((visibleItems, item) => {
      const children = item.children ? filterVisibleItems(item.children) : undefined

      if (isNavLeafItem(item)) {
        if (!canShowItem(item)) return visibleItems
        visibleItems.push({ ...item, children })
        return visibleItems
      }

      if (isNavGroupItem(item)) {
        if (children?.length) {
          visibleItems.push({ ...item, children })
        }
        return visibleItems
      }

      return visibleItems
    }, [])

  const isRouteActive = (item: NavItem): boolean => {
    if (isNavLeafItem(item)) {
      return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
    }
    if (isNavGroupItem(item)) {
      return item.children.some((child) => isRouteActive(child))
    }
    return false
  }

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const renderNavItem = (item: NavItem, depth = 0): ReactNode => {
    const Icon = item.icon
    const label = t(item.labelKey)
    const isActive = isRouteActive(item)
    const isOpen = openGroups[item.key] || isActive
    const hasChildren = Boolean(item.children?.length)

    if (hasChildren) {
      return (
        <div key={item.key} className={`nav-group nav-depth-${depth}`}>
          <button
            type="button"
            className={`nav-link nav-group-trigger ${isActive ? 'active' : ''}`}
            onClick={() => toggleGroup(item.key)}
            aria-expanded={isOpen}
            title={label}
          >
            <Icon className="nav-icon" />
            {isNavExpanded && <span className="nav-label">{label}</span>}
            {isNavExpanded && (
              <span className={`nav-arrow ${isOpen ? 'open' : ''}`}>▸</span>
            )}
          </button>
          {isNavExpanded && isOpen && (
            <div className="nav-subnav">
              {item.children?.map((child) => renderNavItem(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }

    if (!isNavLeafItem(item)) return null

    return (
      <NavLink
        key={item.key}
        to={item.path}
        end={item.path === '/dashboard'}
        title={label}
        onClick={mobileOpen ? onMobileClose : undefined}
        className={({ isActive }) =>
          `nav-link ${depth > 0 ? 'nav-sublink' : ''} ${isActive ? 'active' : ''}`
        }
      >
        <Icon className="nav-icon" />
        {isNavExpanded && <span className="nav-label">{label}</span>}
      </NavLink>
    )
  }

  const visibleNavItems = filterVisibleItems(navItems)

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
        {visibleNavItems.map((item) => renderNavItem(item))}
      </nav>
    </aside>
    </>
  )
}
