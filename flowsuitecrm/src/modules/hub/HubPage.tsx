import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { AgendaHoy } from '../../components/AgendaHoy'
import { Badge } from '../../components/Badge'
import { StatCard } from '../../components/StatCard'
import {
  IconDashboard,
  IconFinance,
  IconInsurance,
  IconTelecom,
} from '../../components/icons'
import { BusinessUnitGrid } from './BusinessUnitGrid'
import { HubHeader } from './HubHeader'
import { QuickActionsGrid } from './QuickActionsGrid'
import type { BusinessUnit, HubStat, QuickAction } from './hub.types'
import { useHubStats } from './useHubStats'

export function HubPage() {
  const navigate = useNavigate()
  const { metrics, loading, error, scopePending } = useHubStats()
  const { session } = useAuth()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)

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
    return () => { active = false }
  }, [configured, session?.user.id])

  const isAdminLike = role === 'admin' || role === 'distribuidor'

  const statValue = (value: number) => {
    if (scopePending) return 'Resolviendo alcance...'
    if (loading) return 'Cargando...'
    if (error) return '—'
    return new Intl.NumberFormat('es-US').format(value)
  }

  const operationalStats = useMemo<HubStat[]>(
    () => [
      {
        key: 'leads',
        label: 'Leads nuevos',
        value: statValue(metrics.leadsNew),
        hint: 'Pipeline inicial del dia',
        to: '/leads',
      },
      {
        key: 'citas',
        label: 'Citas hoy',
        value: statValue(metrics.citasToday),
        hint: 'Agenda operativa actual',
        to: '/citas',
      },
      {
        key: 'tareas',
        label: 'Tareas pendientes',
        value: statValue(metrics.tareasPending),
        hint: 'Seguimientos por completar',
        to: '/hoy',
      },
    ],
    [metrics.citasToday, metrics.leadsNew, metrics.tareasPending, loading, error, scopePending],
  )

  const commissionStats = useMemo<HubStat[]>(
    () => [
      {
        key: 'estimadas',
        label: 'Comisiones estimadas',
        value: '—',
        hint: 'Disponible pronto',
        accent: 'gold',
      },
      {
        key: 'aprobadas',
        label: 'Comisiones aprobadas',
        value: '—',
        hint: 'Disponible pronto',
        accent: 'gold',
      },
      {
        key: 'pagadas',
        label: 'Comisiones pagadas',
        value: '—',
        hint: 'Disponible pronto',
        accent: 'gold',
      },
    ],
    [],
  )

  const allBusinessUnits = useMemo<BusinessUnit[]>(
    () => [
      {
        title: 'Royal Prestige',
        subtitle: 'Connection Worldwide Group',
        description: ['Clientes y cartera', 'Ventas y cobranza', 'Programas y marketing'],
        status: 'active',
        theme: 'emerald',
        badge: 'Activo',
        icon: IconDashboard,
        links: [{ label: 'Ir a RP', to: '/dashboard' }],
      },
      {
        title: 'Telecom',
        subtitle: 'Izzy Communications',
        description: ['Leads y ordenes', 'Cotizador y call center', 'Integracion futura'],
        status: 'coming_soon',
        theme: 'teal',
        badge: 'Proximamente',
        icon: IconTelecom,
        links: [{ label: 'Disponible pronto', disabled: true }],
      },
      {
        title: 'Seguros',
        subtitle: 'Izzy Financial & Business Services',
        description: ['Requiere licencia activa', 'Accesos por negocio', 'Activacion futura'],
        status: 'requires_license',
        theme: 'navy',
        badge: '🔒 Requiere licencia',
        icon: IconInsurance,
        links: [{ label: 'Solicitar acceso', disabled: true }],
      },
      {
        title: 'Servicios Financieros',
        subtitle: 'Nuevas lineas CWG',
        description: ['Cobros y planes', 'Compensacion futura', 'Expansiones del portal'],
        status: 'coming_soon',
        theme: 'gold',
        badge: 'Proximamente',
        icon: IconFinance,
        links: [{ label: 'Ver mas', disabled: true }],
      },
    ],
    [],
  )

  const businessUnits = useMemo(
    () => isAdminLike ? allBusinessUnits : allBusinessUnits.filter((u) => u.status === 'active'),
    [isAdminLike, allBusinessUnits],
  )

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        key: 'lead',
        label: 'Nuevo Lead',
        description: 'Abre alta rapida de prospecto',
        variant: 'primary',
        eventAction: 'newLead',
      },
      {
        key: 'cita',
        label: 'Nueva Cita',
        description: 'Ir a agenda comercial',
        variant: 'primary',
        to: '/citas',
      },
      {
        key: 'venta',
        label: 'Registrar Venta',
        description: 'Abrir modulo de ventas',
        variant: 'primary',
        to: '/ventas',
      },
      {
        key: 'inbox',
        label: 'Ver Inbox',
        description: 'Mensajes y pendientes',
        to: '/inbox',
      },
      {
        key: 'campo',
        label: 'Mi Campo',
        description: 'Ruta y visitas del dia',
        to: '/campo',
      },
      {
        key: 'cartera',
        label: 'Cartera',
        description: 'Seguimiento financiero',
        to: '/cartera',
      },
    ],
    [],
  )

  return (
    <div className="page-stack">
      <HubHeader />

      <section className="page-stack">
        <div className="hub-section-heading">
          <p className="hub-section-kicker">Resumen de hoy</p>
          <h3>Indicadores operativos</h3>
        </div>
        <div className="stat-grid hub-stat-grid hub-stat-grid-operational">
          {operationalStats.map((stat) => (
            <StatCard
              key={stat.key}
              label={stat.label}
              value={stat.value}
              hint={stat.hint}
              accent={stat.accent}
              onClick={stat.to ? () => navigate(stat.to as string) : undefined}
            />
          ))}
        </div>
      </section>

      {isAdminLike && (
        <section className="page-stack">
          <div className="hub-section-heading">
            <p className="hub-section-kicker">Compensacion</p>
            <h3>Comisiones</h3>
            <div className="hub-inline-badges">
              <Badge label="Fase 1" tone="gold" />
              <Badge label="Disponible pronto" tone="gold" className="hub-commission-badge" />
            </div>
          </div>
          <div className="stat-grid hub-stat-grid hub-stat-grid-commission">
            {commissionStats.map((stat) => (
              <StatCard
                key={stat.key}
                label={stat.label}
                value={stat.value}
                hint={stat.hint}
                accent={stat.accent}
              />
            ))}
          </div>
        </section>
      )}

      <BusinessUnitGrid units={businessUnits} />

      <section className="page-stack">
        <div className="hub-section-heading">
          <p className="hub-section-kicker">Agenda de hoy</p>
          <h3>Seguimiento inmediato</h3>
        </div>
        <AgendaHoy />
      </section>

      <QuickActionsGrid actions={quickActions} />

    </div>
  )
}
