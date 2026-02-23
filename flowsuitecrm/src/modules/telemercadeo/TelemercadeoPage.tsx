import { Outlet } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'

export function TelemercadeoPage() {
  return (
    <div className="page-stack">
      <SectionHeader
        title="Telemercadeo"
        subtitle="Gestión de cartera, cumpleaños, filtros y referidos"
      />
      <Outlet />
    </div>
  )
}
