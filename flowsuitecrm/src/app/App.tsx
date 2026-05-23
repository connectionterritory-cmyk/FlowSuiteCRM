import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from './layouts/AppShell'
import { useAuth } from '../auth/useAuth'

const DashboardPage = lazy(async () => ({ default: (await import('../modules/dashboard/DashboardPage')).DashboardPage }))
const PipelinePage = lazy(async () => ({ default: (await import('../modules/pipeline/PipelinePage')).PipelinePage }))
const LeadsPage = lazy(async () => ({ default: (await import('../modules/leads/LeadsPage')).LeadsPage }))
const ClientesPage = lazy(async () => ({ default: (await import('../modules/clientes/ClientesPage')).ClientesPage }))
const VentasPage = lazy(async () => ({ default: (await import('../modules/ventas/VentasPage')).VentasPage }))
const ProductosPage = lazy(async () => ({ default: (await import('../modules/productos/ProductosPage')).ProductosPage }))
const ProgramasPage = lazy(async () => ({ default: (await import('../modules/programas/ProgramasPage')).ProgramasPage }))
const HoyPage = lazy(async () => ({ default: (await import('../modules/hoy/HoyPage')).HoyPage }))
const CierresPage = lazy(async () => ({ default: (await import('../modules/cierres/CierresPage')).CierresPage }))
const ConexionesInfinitasPage = lazy(async () => ({
  default: (await import('../modules/conexiones-infinitas/ConexionesInfinitasPage')).ConexionesInfinitasPage,
}))
const Programa4en14Page = lazy(async () => ({ default: (await import('../modules/4en14/Programa4en14Page')).Programa4en14Page }))
const ServicioClientePage = lazy(async () => ({
  default: (await import('../modules/servicio-cliente/ServicioClientePage')).ServicioClientePage,
}))
const CitasPage = lazy(async () => ({ default: (await import('../modules/citas/CitasPage')).CitasPage }))
const UsuariosPage = lazy(async () => ({ default: (await import('../modules/usuarios/UsuariosPage')).UsuariosPage }))
const TelemercadeoPage = lazy(async () => ({ default: (await import('../modules/telemercadeo/TelemercadeoPage')).TelemercadeoPage }))
const TelemercadeoGestionesPage = lazy(async () => ({
  default: (await import('../modules/telemercadeo/TelemercadeoGestionesPage')).TelemercadeoGestionesPage,
}))
const TelemercadeoCarteraPage = lazy(async () => ({
  default: (await import('../modules/telemercadeo/TelemercadeoCarteraPage')).TelemercadeoCarteraPage,
}))
const TelemercadeoCumpleanosPage = lazy(async () => ({
  default: (await import('../modules/telemercadeo/TelemercadeoCumpleanosPage')).TelemercadeoCumpleanosPage,
}))
const TelemercadeoFiltrosPage = lazy(async () => ({
  default: (await import('../modules/telemercadeo/TelemercadeoFiltrosPage')).TelemercadeoFiltrosPage,
}))
const TelemercadeoReferidosPage = lazy(async () => ({
  default: (await import('../modules/telemercadeo/TelemercadeoReferidosPage')).TelemercadeoReferidosPage,
}))
const ImportacionesPage = lazy(async () => ({
  default: (await import('../modules/importaciones/ImportacionesPage')).ImportacionesPage,
}))
const PerfilPage = lazy(async () => ({ default: (await import('../modules/perfil/PerfilPage')).PerfilPage }))
const MarketingFlowPage = lazy(async () => ({ default: (await import('../modules/marketing-flow/MarketingFlowPage')).MarketingFlowPage }))
const SegmentosPage = lazy(async () => ({ default: (await import('../modules/marketing-flow/SegmentosPage')).SegmentosPage }))
const CampanasPage = lazy(async () => ({ default: (await import('../modules/marketing-flow/CampanasPage')).CampanasPage }))
const EnviosPage = lazy(async () => ({ default: (await import('../modules/marketing-flow/EnviosPage')).EnviosPage }))
const CampoPage = lazy(async () => ({ default: (await import('../modules/campo/CampoPage')).CampoPage }))
const CarteraPage = lazy(async () => ({ default: (await import('../modules/cartera/CarteraPage')).CarteraPage }))
const InboxPage = lazy(async () => ({ default: (await import('../modules/inbox/InboxPage')).InboxPage }))
const LoginPage = lazy(async () => ({ default: (await import('../modules/auth/LoginPage')).LoginPage }))
const ResetPasswordPage = lazy(async () => ({
  default: (await import('../modules/auth/ResetPasswordPage')).ResetPasswordPage,
}))
const CatalogoProductosPage = lazy(async () => ({
  default: (await import('../modules/catalogo-productos/CatalogoProductosPage')).CatalogoProductosPage,
}))

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
    <Suspense fallback={<div className="page">{t('common.loading')}</div>}>
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
            <Route path="/marketing-flow" element={<MarketingFlowPage />}>
              <Route index element={<Navigate to="/marketing-flow/segmentos" replace />} />
              <Route path="segmentos" element={<SegmentosPage />} />
              <Route path="campanas" element={<CampanasPage />} />
              <Route path="envios" element={<EnviosPage />} />
            </Route>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/citas" element={<CitasPage />} />
            <Route path="/campo" element={<CampoPage />} />
            <Route path="/clientes" element={<ClientesPage />} />
            <Route path="/cartera" element={<CarteraPage />} />
            <Route path="/ventas" element={<VentasPage />} />
            <Route path="/catalogo" element={<CatalogoProductosPage />} />
            <Route path="/productos" element={<ProductosPage />} />
            <Route path="/catalogo-productos" element={<CatalogoProductosPage />} />
            <Route path="/programas" element={<ProgramasPage />} />
            <Route path="/conexiones-infinitas" element={<ConexionesInfinitasPage />} />
            <Route path="/4en14" element={<Programa4en14Page />} />
            <Route path="/servicio-cliente" element={<ServicioClientePage />} />
            <Route path="/citas" element={<CitasPage />} />
            <Route path="/telemercadeo" element={<TelemercadeoPage />}>
              <Route index element={<Navigate to="/telemercadeo/cartera" replace />} />
              <Route path="gestiones" element={<TelemercadeoGestionesPage />} />
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
    </Suspense>
  )
}
