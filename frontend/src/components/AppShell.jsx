import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/auth'
import { useOrg } from '../contexts/org'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

const navItems = [
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/cliente-360', label: 'Cliente 360' },
  { to: '/servicio', label: 'Servicio' },
  { to: '/agua', label: 'Agua' },
  { to: '/cartera', label: 'Cartera' },
  { to: '/team-hub', label: 'Team Hub' },
]

export default function AppShell() {
  const { user, signOut } = useAuth()
  const { orgName, branding, role } = useOrg()

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        <aside className="w-64 border-r border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-ink text-white flex items-center justify-center font-bold">F</div>
            <div>
              <p className="text-lg font-semibold font-display">FlowSuiteCRM</p>
              <p className="text-xs text-slate-600">MVP v2</p>
            </div>
          </div>

          <nav className="mt-8 flex flex-col gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                    isActive ? 'bg-ink text-white' : 'text-ink hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-10 rounded-lg border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500">Org activa</p>
            <p className="mt-2 text-sm font-semibold text-ink">{orgName ?? 'FlowSuiteCRM'}</p>
            {role ? <Badge className="mt-2" variant="accent">{role}</Badge> : null}
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
            <div className="flex items-center gap-4">
              {branding?.logo_url ? (
                <img
                  src={branding.logo_url}
                  alt="Logo org"
                  className="h-10 w-10 rounded-md border border-slate-200 object-contain"
                />
              ) : (
                <div className="h-10 w-10 rounded-md border border-slate-200 bg-slate-100" />
              )}
              <div>
                <p className="text-sm text-slate-500">Organizacion</p>
                <p className="text-lg font-semibold text-ink">{orgName ?? 'FlowSuiteCRM'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-semibold text-ink">{user?.email ?? 'usuario'}</p>
                <p className="text-xs text-slate-500">Powered by FlowSuiteCRM</p>
              </div>
              <Button variant="outline" size="sm" onClick={signOut}>
                Salir
              </Button>
            </div>
          </header>

          <main className="flex-1 bg-canvas px-8 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
