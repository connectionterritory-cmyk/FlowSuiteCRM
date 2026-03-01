import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from './layouts/AppShell'
import { DashboardPage } from '../modules/dashboard/DashboardPage'
import { PipelinePage } from '../modules/pipeline/PipelinePage'
import { LeadsPage } from '../modules/leads/LeadsPage'
import { ClientesPage } from '../modules/clientes/ClientesPage'
import { VentasPage } from '../modules/ventas/VentasPage'
import { ProductosPage } from '../modules/productos/ProductosPage'
import { ProgramasPage } from '../modules/programas/ProgramasPage'
import { HoyPage } from '../modules/hoy/HoyPage'
import { CierresPage } from '../modules/cierres/CierresPage'
import { ConexionesInfinitasPage } from '../modules/conexiones-infinitas/ConexionesInfinitasPage'
import { Programa4en14Page } from '../modules/4en14/Programa4en14Page'
import { ServicioClientePage } from '../modules/servicio-cliente/ServicioClientePage'
import { UsuariosPage } from '../modules/usuarios/UsuariosPage'
import { TelemercadeoPage } from '../modules/telemercadeo/TelemercadeoPage'
import { TelemercadeoCarteraPage } from '../modules/telemercadeo/TelemercadeoCarteraPage'
import { TelemercadeoCumpleanosPage } from '../modules/telemercadeo/TelemercadeoCumpleanosPage'
import { TelemercadeoFiltrosPage } from '../modules/telemercadeo/TelemercadeoFiltrosPage'
import { TelemercadeoReferidosPage } from '../modules/telemercadeo/TelemercadeoReferidosPage'
import { ImportacionesPage } from '../modules/importaciones/ImportacionesPage'
import { PerfilPage } from '../modules/perfil/PerfilPage'
import { LoginPage } from '../modules/auth/LoginPage'
import { ResetPasswordPage } from '../modules/auth/ResetPasswordPage'
import { useAuth } from '../auth/AuthProvider'

function ProtectedRoute() {
  const { t } = useTranslation()
  const { session, loading } = useAuth()

  if (loading) {
    return <div className="page">{t('common.loading')}</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

export default function App() {
  const { t } = useTranslation()
  const { session, loading } = useAuth()
  const defaultPath = session ? '/dashboard' : '/login'
  if (loading) {
    return <div className="page">{t('common.loading')}</div>
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/hoy" element={<HoyPage />} />
          <Route path="/cierres" element={<CierresPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/clientes" element={<ClientesPage />} />
          <Route path="/ventas" element={<VentasPage />} />
          <Route path="/productos" element={<ProductosPage />} />
          <Route path="/programas" element={<ProgramasPage />} />
          <Route path="/conexiones-infinitas" element={<ConexionesInfinitasPage />} />
          <Route path="/4en14" element={<Programa4en14Page />} />
          <Route path="/servicio-cliente" element={<ServicioClientePage />} />
          <Route path="/telemercadeo" element={<TelemercadeoPage />}>
            <Route index element={<Navigate to="/telemercadeo/cartera" replace />} />
            <Route path="cartera" element={<TelemercadeoCarteraPage />} />
            <Route path="cumpleanos" element={<TelemercadeoCumpleanosPage />} />
            <Route path="filtros" element={<TelemercadeoFiltrosPage />} />
            <Route path="referidos" element={<TelemercadeoReferidosPage />} />
          </Route>
          <Route path="/importaciones" element={<ImportacionesPage />} />
          <Route path="/usuarios" element={<UsuariosPage />} />
          <Route path="/perfil" element={<PerfilPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to={defaultPath} replace />} />
      <Route path="*" element={<Navigate to={defaultPath} replace />} />
    </Routes>
  )
}
