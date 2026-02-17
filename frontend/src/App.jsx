import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/auth'
import { OrgProvider } from './contexts/org'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Pipeline from './pages/Pipeline'
import Cliente360 from './pages/Cliente360'
import Servicio from './pages/Servicio'
import Agua from './pages/Agua'
import Cartera from './pages/Cartera'
import TeamHub from './pages/TeamHub'

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <p className="text-sm font-semibold text-slate-600">Cargando...</p>
    </div>
  )
}

function AppRoutes() {
  const { session, loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <OrgProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/pipeline" replace />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/cliente-360" element={<Cliente360 />} />
          <Route path="/servicio" element={<Servicio />} />
          <Route path="/agua" element={<Agua />} />
          <Route path="/cartera" element={<Cartera />} />
          <Route path="/team-hub" element={<TeamHub />} />
        </Route>
        <Route path="*" element={<Navigate to="/pipeline" replace />} />
      </Routes>
    </OrgProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
