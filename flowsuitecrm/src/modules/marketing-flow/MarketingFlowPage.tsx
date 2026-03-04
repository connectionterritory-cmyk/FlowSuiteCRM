import { NavLink, Outlet } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'

const tabs = [
  { key: 'segmentos', label: 'Segmentos', path: '/marketing-flow/segmentos' },
  { key: 'campanas', label: 'Campanas', path: '/marketing-flow/campanas' },
  { key: 'envios', label: 'Envios', path: '/marketing-flow/envios' },
]

export function MarketingFlowPage() {
  return (
    <div className="page-stack">
      <SectionHeader
        title="MarketingFlow"
        subtitle="Segmentos, campanas y envios"
      />
      <div className="template-tabs" style={{ gap: '0.5rem' }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.path}
            className={({ isActive }) => `template-tab ${isActive ? 'active' : ''}`.trim()}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  )
}
