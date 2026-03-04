import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../auth/AuthProvider'
import { useMessaging } from '../../hooks/useMessaging'
import { useUsers } from '../../data/UsersProvider'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'

type LeadRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  estado_pipeline: string | null
  next_action: string | null
  next_action_date: string | null
  updated_at: string | null
  created_at: string | null
}

type OpportunityRow = {
  id: string
  nombre: string | null
  etapa: string | null
  valor: number | null
  probabilidad: number | null
  fecha_cierre_estimada: string | null
  updated_at: string | null
}

type LastActivityRow = {
  lead_id: string
  last_activity_at: string | null
}


type SalesSummary = {
  total: number
  count: number
}

type ClienteCobranzaRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  monto_moroso: number | null
  dias_atraso: number | null
  estado_morosidad: string | null
}

type ClienteBirthdayRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  fecha_nacimiento: string | null
}

type ClienteReactivacionRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  fecha_ultimo_pedido: string | null
}

type MantenimientoRow = {
  id: string
  nombre_componente: string | null
  fecha_proximo_cambio: string | null
  ciclo_meses: number | null
  equipo: {
    cliente: {
      id: string
      nombre: string | null
      apellido: string | null
      telefono: string | null
      vendedor_id: string | null
    } | null
  } | null
}

const REFERIDOS_ACTIVOS_ESTADOS = ['contactado', 'cita_agendada', 'presentacion_hecha']
const REFERIDOS_EN_PROCESO_ESTADOS = ['cita_agendada', 'presentacion_hecha']


export function HoyPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { currentUser } = useUsers()
  const configured = isSupabaseConfigured
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lead sections
  const [overdueLeads, setOverdueLeads] = useState<LeadRow[]>([])
  const [todayLeads, setTodayLeads] = useState<LeadRow[]>([])
  const [newLeads, setNewLeads] = useState<LeadRow[]>([])
  const [closingOpps, setClosingOpps] = useState<OpportunityRow[]>([])
  const [salesSummary, setSalesSummary] = useState<SalesSummary>({ total: 0, count: 0 })
  const [referidosStats, setReferidosStats] = useState({ activos: 0, enProceso: 0 })
  const [lastActivityMap, setLastActivityMap] = useState<Record<string, string | null>>({})
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionsLead, setActionsLead] = useState<LeadRow | null>(null)
  const [checkinSaving, setCheckinSaving] = useState(false)

  // Client sections
  const [cobranzas, setCobranzas] = useState<ClienteCobranzaRow[]>([])
  const [birthdays, setBirthdays] = useState<ClienteBirthdayRow[]>([])
  const [reactivacion, setReactivacion] = useState<ClienteReactivacionRow[]>([])
  const [mantenimientos, setMantenimientos] = useState<MantenimientoRow[]>([])

  // Collapsible modals
  const [cobranzasOpen, setCobranzasOpen] = useState(false)
  const [mantenimientosOpen, setMantenimientosOpen] = useState(false)
  const [reactivacionOpen, setReactivacionOpen] = useState(false)

  // Note modal

  // Reschedule modal
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleLead, setRescheduleLead] = useState<LeadRow | null>(null)
  const [rescheduleAction, setRescheduleAction] = useState('')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleSaving, setRescheduleSaving] = useState(false)

  const today = useMemo(() => new Date(), [])
  const todayIso = useMemo(() => today.toISOString().split('T')[0], [today])

  const greetingName = useMemo(
    () => currentUser?.nombre?.split(' ')[0] || session?.user.email?.split('@')[0] || '',
    [currentUser, session]
  )


  const allClear = useMemo(
    () =>
      !loading &&
      overdueLeads.length === 0 &&
      todayLeads.length === 0 &&
      closingOpps.length === 0 &&
      newLeads.length === 0 &&
      cobranzas.length === 0 &&
      birthdays.length === 0,
    [loading, overdueLeads, todayLeads, closingOpps, newLeads, cobranzas, birthdays]
  )

  const totalMoroso = useMemo(
    () => cobranzas.reduce((sum, c) => sum + (c.monto_moroso ?? 0), 0),
    [cobranzas]
  )

  const threeDaysAgo = useMemo(() => {
    const date = new Date(today)
    date.setDate(date.getDate() - 3)
    return date
  }, [today])

  const getMonthRange = useCallback(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    }
  }, [today])

  const getLeadName = useCallback(
    (lead: LeadRow) => {
      return [lead.nombre, lead.apellido].filter(Boolean).join(' ').trim() || t('common.noData')
    },
    [t]
  )

  const getClientName = useCallback(
    (row: { nombre: string | null; apellido: string | null }) =>
      [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || t('common.noData'),
    [t]
  )

  const timeZone = 'America/Los_Angeles'

  const formatDateKey = useCallback(
    (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date),
    [timeZone]
  )

  const dateKeyToUtc = useCallback((dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }, [])

  const relativeDayLabel = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      const todayKey = formatDateKey(new Date())
      const diffDays = Math.round((dateKeyToUtc(value) - dateKeyToUtc(todayKey)) / 86400000)
      if (diffDays === 0) return t('hoy.todayLabel')
      if (diffDays === -1) return t('hoy.yesterday')
      if (diffDays === 1) return t('hoy.tomorrow')
      if (diffDays > 1) return t('hoy.inDays', { count: diffDays })
      return t('hoy.daysAgo', { count: Math.abs(diffDays) })
    },
    [dateKeyToUtc, formatDateKey, t]
  )

  const getAtrasoBucket = useCallback((dias?: number | null) => {
    if (dias == null) return null
    if (dias <= 30) return '0-30'
    if (dias <= 60) return '31-60'
    return '60+'
  }, [])

  const isUrgent = useCallback(
    (lastActivityAt?: string | null) => {
      if (!lastActivityAt) return false
      const activity = new Date(lastActivityAt)
      return activity.getTime() <= threeDaysAgo.getTime()
    },
    [threeDaysAgo]
  )

  const resolveLastActivityAt = useCallback(
    (lead: LeadRow) => lastActivityMap[lead.id] ?? lead.updated_at ?? lead.created_at ?? null,
    [lastActivityMap]
  )

  const loadLastActivity = useCallback(
    async (leadIds: string[]) => {
      if (!configured || leadIds.length === 0) return
      const { data, error: activityError } = await supabase
        .from('v_lead_last_activity')
        .select('lead_id, last_activity_at')
        .in('lead_id', leadIds)

      if (activityError) {
        console.error('Error loading last activity:', activityError.message)
        setLastActivityMap({})
        return
      }

      const nextMap: Record<string, string | null> = {}
      ;(data as LastActivityRow[] | null)?.forEach((row) => {
        nextMap[row.lead_id] = row.last_activity_at
      })
      setLastActivityMap(nextMap)
    },
    [configured]
  )


  const loadData = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setLoading(true)
    setError(null)

    const baseLeadSelect = 'id, nombre, apellido, telefono, estado_pipeline, next_action, next_action_date, updated_at, created_at'
    const vendedorId = session.user.id

    const { start, end } = getMonthRange()
    const todayPlus7 = new Date(today)
    todayPlus7.setDate(todayPlus7.getDate() + 7)
    const todayPlus7Iso = todayPlus7.toISOString().split('T')[0]

    // Birthday date pattern: match %-MM-DD across any year
    const birthMonth = String(today.getMonth() + 1).padStart(2, '0')
    const birthDay = String(today.getDate()).padStart(2, '0')
    const birthPattern = `%-${birthMonth}-${birthDay}`

    // 90 days ago for reactivation
    const ninetyDaysAgo = new Date(today)
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const ninetyDaysAgoIso = ninetyDaysAgo.toISOString().split('T')[0]

    const [
      overdueRes,
      todayRes,
      newRes,
      oppsRes,
      salesRes,
      referidosRes,
      cobranzasRes,
      birthdaysRes,
      reactivacionRes,
      mantenimientosRes,
    ] = await Promise.all([
      // ── Leads ─────────────────────────────────────────────
      supabase
        .from('leads')
        .select(baseLeadSelect)
        .eq('vendedor_id', vendedorId)
        .not('next_action_date', 'is', null)
        .lt('next_action_date', todayIso)
        .is('deleted_at', null)
        .order('next_action_date', { ascending: true }),
      supabase
        .from('leads')
        .select(baseLeadSelect)
        .eq('vendedor_id', vendedorId)
        .eq('next_action_date', todayIso)
        .is('deleted_at', null)
        .order('next_action_date', { ascending: true }),
      supabase
        .from('leads')
        .select(baseLeadSelect)
        .eq('vendedor_id', vendedorId)
        .eq('estado_pipeline', 'nuevo')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('oportunidades')
        .select('id, nombre, etapa, valor, probabilidad, fecha_cierre_estimada, updated_at')
        .eq('owner_id', vendedorId)
        .gte('fecha_cierre_estimada', todayIso)
        .lte('fecha_cierre_estimada', todayPlus7Iso)
        .order('fecha_cierre_estimada', { ascending: true }),
      supabase
        .from('ventas')
        .select('monto')
        .eq('vendedor_id', vendedorId)
        .gte('fecha_venta', start)
        .lte('fecha_venta', end),
      supabase
        .from('ci_referidos')
        .select('estado, activacion:ci_activaciones!inner(representante_id)')
        .eq('activacion.representante_id', vendedorId),
      // ── Clients ───────────────────────────────────────────
      supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono, monto_moroso, dias_atraso, estado_morosidad')
        .eq('vendedor_id', vendedorId)
        .or('monto_moroso.gt.0,dias_atraso.gt.0')
        .order('dias_atraso', { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono, fecha_nacimiento')
        .eq('vendedor_id', vendedorId)
        .like('fecha_nacimiento', birthPattern),
      supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono, fecha_ultimo_pedido')
        .eq('vendedor_id', vendedorId)
        .eq('activo', true)
        .or(`fecha_ultimo_pedido.is.null,fecha_ultimo_pedido.lt.${ninetyDaysAgoIso}`)
        .order('fecha_ultimo_pedido', { ascending: true, nullsFirst: true })
        .limit(8),
      supabase
        .from('componentes_equipo')
        .select('id, nombre_componente, fecha_proximo_cambio, ciclo_meses, equipo:equipos_instalados(cliente:clientes(id, nombre, apellido, telefono, vendedor_id))')
        .eq('activo', true)
        .lte('fecha_proximo_cambio', todayIso)
        .order('fecha_proximo_cambio', { ascending: true })
        .limit(50),
    ])

    if (overdueRes.error || todayRes.error || newRes.error || oppsRes.error || salesRes.error) {
      setError(
        overdueRes.error?.message ||
        todayRes.error?.message ||
        newRes.error?.message ||
        oppsRes.error?.message ||
        salesRes.error?.message ||
        t('common.noData')
      )
      setLoading(false)
      return
    }

    if (referidosRes.error) {
      setReferidosStats({ activos: 0, enProceso: 0 })
    } else {
      const referidosRows = (referidosRes.data as { estado: string | null }[] | null) ?? []
      const activosCount = referidosRows.filter((row) => row.estado && REFERIDOS_ACTIVOS_ESTADOS.includes(row.estado)).length
      const enProcesoCount = referidosRows.filter((row) => row.estado && REFERIDOS_EN_PROCESO_ESTADOS.includes(row.estado)).length
      setReferidosStats({ activos: activosCount, enProceso: enProcesoCount })
    }

    const overdue = (overdueRes.data as LeadRow[] | null) ?? []
    const todayLeadsData = (todayRes.data as LeadRow[] | null) ?? []
    const newLeadsData = (newRes.data as LeadRow[] | null) ?? []
    const oppsData = (oppsRes.data as OpportunityRow[] | null) ?? []
    const ventasRows = (salesRes.data as { monto: number }[] | null) ?? []

    setOverdueLeads(overdue)
    setTodayLeads(todayLeadsData)
    setNewLeads(newLeadsData)
    setClosingOpps(oppsData)
    setSalesSummary({
      total: ventasRows.reduce((acc, row) => acc + (row.monto ?? 0), 0),
      count: ventasRows.length,
    })

    // Client sections — silent fail if not available
    setCobranzas((cobranzasRes.data as ClienteCobranzaRow[] | null) ?? [])
    setBirthdays((birthdaysRes.data as ClienteBirthdayRow[] | null) ?? [])
    setReactivacion((reactivacionRes.data as ClienteReactivacionRow[] | null) ?? [])

    const mantRaw = (mantenimientosRes.data as MantenimientoRow[] | null) ?? []
    const mantFiltered = mantRaw
      .filter((row) => {
        const cliente = Array.isArray(row.equipo) ? row.equipo[0]?.cliente : row.equipo?.cliente
        const c = Array.isArray(cliente) ? cliente[0] : cliente
        return c?.vendedor_id === vendedorId
      })
      .slice(0, 8)
    setMantenimientos(mantFiltered)

    const leadIds = [...overdue, ...todayLeadsData, ...newLeadsData].map((lead) => lead.id)
    await loadLastActivity(leadIds)

    setLoading(false)
  }, [configured, session?.user.id, getMonthRange, today, todayIso, loadLastActivity, t])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCall = (telefono?: string | null) => {
    if (!telefono) {
      showToast(t('messaging.phoneMissing'), 'error')
      return
    }
    window.location.href = `tel:${telefono}`
  }
  const handleWhatsapp = (lead: LeadRow) => {
    if (!lead.telefono) {
      showToast(t('messaging.phoneMissing'), 'error')
      return
    }
    openWhatsapp({
      nombre: getLeadName(lead),
      telefono: lead.telefono,
      leadId: lead.id,
    })
  }

  const handleWhatsappCliente = useCallback(
    (cliente: { id: string; nombre: string; telefono: string | null }) => {
      if (!cliente.telefono) {
        showToast(t('messaging.phoneMissing'), 'error')
        return
      }
      openWhatsapp({ nombre: cliente.nombre, telefono: cliente.telefono, clienteId: cliente.id })
    },
    [openWhatsapp, showToast, t]
  )

  const openActions = (lead: LeadRow) => {
    setActionsLead(lead)
    setActionsOpen(true)
  }

  const closeActions = () => {
    setActionsOpen(false)
    setActionsLead(null)
  }

  const handleCheckIn = async (lead: LeadRow) => {
    if (!session?.user.id) {
      showToast(t('common.noData'), 'error')
      return
    }
    setCheckinSaving(true)
    const { error } = await supabase.from('lead_notas').insert({
      lead_id: lead.id,
      usuario_id: session.user.id,
      nota: `📍 Check-in — ${new Date().toLocaleString()}`,
      tipo: 'checkin',
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('Check-in guardado')
      const nowIso = new Date().toISOString()
      setLastActivityMap((prev) => ({ ...prev, [lead.id]: nowIso }))
      closeActions()
    }
    setCheckinSaving(false)
  }

  const openReschedule = (lead: LeadRow) => {
    setRescheduleLead(lead)
    setRescheduleAction(lead.next_action ?? '')
    setRescheduleDate(lead.next_action_date ?? '')
    setRescheduleOpen(true)
  }


  const submitReschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!rescheduleLead) return
    if (!rescheduleDate) {
      showToast(t('common.noData'), 'error')
      return
    }
    setRescheduleSaving(true)
    const previousOverdue = overdueLeads
    const previousToday = todayLeads
    const previousNew = newLeads
    const updatedLead = {
      ...rescheduleLead,
      next_action: rescheduleAction.trim() || null,
      next_action_date: rescheduleDate,
    }
    setOverdueLeads((prev) => prev.filter((l) => l.id !== rescheduleLead.id))
    setTodayLeads((prev) => prev.filter((l) => l.id !== rescheduleLead.id))
    setNewLeads((prev) => prev.map((l) => (l.id === rescheduleLead.id ? updatedLead : l)))
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        next_action: rescheduleAction.trim() || null,
        next_action_date: rescheduleDate,
      })
      .eq('id', rescheduleLead.id)
    if (updateError) {
      setOverdueLeads(previousOverdue)
      setTodayLeads(previousToday)
      setNewLeads(previousNew)
      showToast(updateError.message, 'error')
    } else {
      showToast(t('hoy.rescheduled'))
      setRescheduleOpen(false)
      await loadData()
    }
    setRescheduleSaving(false)
  }

  const renderLeadListItem = (lead: LeadRow, icon: string, iconClass: string) => {
    const lastActivityAt = resolveLastActivityAt(lead)
    const urgent = isUrgent(lastActivityAt)
    return (
      <div key={lead.id} className={`hoy-list-item ${urgent ? 'alert' : ''}`.trim()} onClick={() => openActions(lead)}>
        <div className={`hoy-item-avatar ${iconClass}`}>{icon}</div>
        <div className="hoy-item-content">
          <div className="hoy-item-title">{getLeadName(lead)}</div>
          <div className="hoy-item-subtitle">
            {lead.next_action || t('hoy.noAction')} - {relativeDayLabel(lead.next_action_date)}
          </div>
        </div>
        <div className="hoy-item-chevron">›</div>
      </div>
    )
  }

  const renderTaskItem = (lead: LeadRow) => {
    const lastActivityAt = resolveLastActivityAt(lead)
    const urgent = isUrgent(lastActivityAt)
    return (
      <div key={lead.id} className={`hoy-task-item ${urgent ? 'alert' : ''}`.trim()} onClick={() => openActions(lead)}>
        <div className={`hoy-task-checkbox ${lead.estado_pipeline === 'cierre' ? 'checked' : ''}`} />
        <div className="hoy-item-content">
          <div className="hoy-item-title">{getLeadName(lead)}</div>
          <div className="hoy-item-subtitle">{lead.next_action || t('hoy.noAction')}</div>
        </div>
        <div className="hoy-item-chevron">
          <input type="checkbox" checked={lead.estado_pipeline === 'cierre'} readOnly style={{ opacity: 0, position: 'absolute' }} />
        </div>
      </div>
    )
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)

  return (
    <div className="page-stack seller-home">
      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}

      {/* ── Premium Header ───────────────────────────────── */}
      <header className="hoy-premium-header">
        <div>
          <h2>{greetingName ? `Hola, ${greetingName}` : t('hoy.title')}</h2>
          <p>{t('hoy.subtitle') || 'Resumen de Hoy'}</p>
        </div>
        <div className="hoy-notification-bell" onClick={loadData} style={{ cursor: 'pointer' }}>
          🔔
        </div>
      </header>

      {/* ── Hero Action Grid ─────────────────────────────── */}
      <div className="hoy-hero-grid">
        <div className="hoy-action-card orange">
          <div className="hoy-action-card-icon-wrapper">
            <span className="hoy-action-card-icon">📅</span>
          </div>
          <span className="hoy-action-card-count">{todayLeads.length}</span>
          <span className="hoy-action-card-label">{t('hoy.statsActions') || 'Acciones'}</span>
        </div>
        <div className="hoy-action-card green">
          <div className="hoy-action-card-icon-wrapper">
            <span className="hoy-action-card-icon">👥</span>
          </div>
          <span className="hoy-action-card-count">{newLeads.length}</span>
          <span className="hoy-action-card-label">{t('hoy.newLeads') || 'Nuevos prospectos'}</span>
        </div>
        <div className="hoy-action-card blue">
          <div className="hoy-action-card-icon-wrapper">
            <span className="hoy-action-card-icon">🚩</span>
          </div>
          <span className="hoy-action-card-count">{closingOpps.length}</span>
          <span className="hoy-action-card-label">{t('hoy.statsClosing') || 'Cierres'}</span>
        </div>
      </div>

      {/* ── KPI Row ──────────────────────────────────────── */}
      <div className="hoy-premium-kpi-row">
        <div className="hoy-premium-kpi-card">
          <span className="hoy-kpi-label">{t('hoy.monthlyProduction') || 'Produccion del mes'}</span>
          <span className="hoy-kpi-value">{formatCurrency(salesSummary.total)}</span>
          <div className="hoy-kpi-trend">
            <div style={{ marginLeft: 'auto', opacity: 0.5 }}>📈</div>
          </div>
        </div>
        <div className="hoy-premium-kpi-card">
          <span className="hoy-kpi-label">{t('hoy.referidosActivos') || 'Referidos Activos'}</span>
          <span className="hoy-kpi-value">{loading ? '...' : referidosStats.activos}</span>
          <div className="hoy-item-subtitle" style={{ fontSize: '0.7rem' }}>
            <span style={{ color: '#2563eb', fontWeight: 700 }}>{loading ? '...' : referidosStats.enProceso}</span> en Proceso
          </div>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* ── Loading skeletons ─────────────────────────────── */}
      {loading && (
        <div className="seller-skeleton-grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="seller-card skeleton-card">
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
            </div>
          ))}
        </div>
      )}

      {/* ── All clear ─────────────────────────────────────── */}
      {allClear && (
        <div className="hoy-allclear">
          <div className="hoy-allclear-icon">✓</div>
          <div className="hoy-allclear-title">{t('hoy.allClear')}</div>
          <div className="hoy-allclear-sub">{t('hoy.allClearSub')}</div>
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent('quick-actions:open', { detail: { action: 'newLead' } }))
            }
          >
            {t('hoy.emptyNewLead')}
          </Button>
        </div>
      )}

      {/* ── Cumpleaños hoy ────────────────────────────────── */}
      {!loading && birthdays.length > 0 && (
        <section className="seller-section">
          <div className="seller-section-header">
            <h3>{t('hoy.birthdays')}</h3>
            <span className="seller-count">{birthdays.length}</span>
          </div>
          {birthdays.map((c) => {
            const name = getClientName(c)
            return (
              <div key={c.id} className="seller-card seller-lead birthday">
                <div className="seller-lead-main">
                  <div>
                    <div className="seller-lead-name">{name}</div>
                    <div className="seller-lead-meta">
                      <span className="seller-pill variant-info">{t('hoy.birthdayToday')}</span>
                    </div>
                  </div>
                </div>
                <div className="seller-lead-actions">
                  <Button variant="ghost" onClick={() => handleCall(c.telefono)}>
                    {t('hoy.call')}
                  </Button>
                  <Button variant="ghost" onClick={() => handleWhatsappCliente({ id: c.id, nombre: name, telefono: c.telefono })}>
                    {t('hoy.whatsapp')}
                  </Button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* ── Cobranzas List Item ──────────────────────────── */}
      {!loading && cobranzas.length > 0 && (
        <div className="hoy-list-item" onClick={() => setCobranzasOpen(true)} style={{ marginTop: '16px' }}>
          <div className="hoy-list-item-icon orange">💸</div>
          <div className="hoy-item-content">
            <div className="hoy-item-title">{t('hoy.cobranzas')}</div>
            <div className="hoy-item-subtitle">
              {cobranzas.length} {t('hoy.statsCobranzas')} · {formatCurrency(totalMoroso || 0)}
            </div>
          </div>
          <div className="hoy-item-badge pink">{cobranzas.length}</div>
          <div className="hoy-item-chevron">›</div>
        </div>
      )}

      {/* ── Reactivación List Item ────────────────────────── */}
      {!loading && reactivacion.length > 0 && (
        <div className="hoy-list-item" onClick={() => setReactivacionOpen(true)}>
          <div className="hoy-list-item-icon blue">🔁</div>
          <div className="hoy-item-content">
            <div className="hoy-item-title">{t('hoy.reactivacion') || 'Sin pedido reciente'}</div>
            <div className="hoy-item-subtitle">{t('hoy.reactivacionSub') || 'Clientes sin pedido en 90+ días'}</div>
          </div>
          <div className="hoy-item-badge">{reactivacion.length}</div>
          <div className="hoy-item-chevron">›</div>
        </div>
      )}

      {/* ── Próximas Citas ────────────────────────────────── */}
      {!loading && todayLeads.length > 0 && (
        <section className="hoy-list-section">
          <div className="hoy-list-header">
            <h3>{t('hoy.upcomingCitas') || 'Próximas Citas'}</h3>
            <span className="hoy-view-all">{t('common.viewAll') || 'Ver Todas'} ›</span>
          </div>
          <div className="hoy-list-container">
            {todayLeads.map((lead) => renderLeadListItem(lead, '👤', 'blue'))}
          </div>
        </section>
      )}

      {/* ── Tareas Pendientes ─────────────────────────────── */}
      {!loading && overdueLeads.length > 0 && (
        <section className="hoy-list-section">
          <div className="hoy-list-header">
            <h3>{t('hoy.pendingTasks') || 'Tareas Pendientes'}</h3>
          </div>
          <div className="hoy-list-container">
            {overdueLeads.map(renderTaskItem)}
          </div>
        </section>
      )}

      {/* ── Closing soon ──────────────────────────────────── */}
      {!loading && closingOpps.length > 0 && (
        <section className="seller-section">
          <div className="seller-section-header">
            <h3>{t('hoy.closingSoon')}</h3>
            <span className="seller-count">{closingOpps.length}</span>
          </div>
          <div className="seller-opps">
            {closingOpps.map((opp) => (
              <div key={opp.id} className="seller-card seller-opportunity">
                <div>
                  <div className="seller-lead-name">{opp.nombre ?? t('common.noData')}</div>
                  <div className="seller-lead-meta">
                    <span className="seller-pill">{opp.etapa ?? '-'}</span>
                    <span>{formatCurrency(opp.valor ?? 0)}</span>
                  </div>
                </div>
                <div className="seller-lead-dates">
                  <span className="seller-date">{relativeDayLabel(opp.fecha_cierre_estimada)}</span>
                  <span className="seller-last">
                    {t('hoy.probability')} {opp.probabilidad ?? 0}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Mantenimientos List Item ─────────────────────── */}
      {!loading && mantenimientos.length > 0 && (
        <div className="hoy-list-item" onClick={() => setMantenimientosOpen(true)}>
          <div className="hoy-list-item-icon yellow">🔧</div>
          <div className="hoy-item-content">
            <div className="hoy-item-title">{t('hoy.mantenimientos')}</div>
            <div className="hoy-item-subtitle">
              {mantenimientos.length} {t('hoy.mantenimientos').toLowerCase()}
            </div>
          </div>
          <div className="hoy-item-badge">{mantenimientos.length}</div>
          <div className="hoy-item-chevron">›</div>
        </div>
      )}

      {/* ── New leads ─────────────────────────────────────── */}
      {!loading && newLeads.length > 0 && (
        <section className="hoy-list-section">
          <div className="hoy-list-header">
            <h3>{t('hoy.newLeads')}</h3>
          </div>
          <div className="hoy-list-container">
            {newLeads.map((lead) => renderLeadListItem(lead, '✨', 'green'))}
          </div>
        </section>
      )}


      {/* ── Cobranzas modal ───────────────────────────────── */}
      <Modal
        open={cobranzasOpen}
        title={`${t('hoy.cobranzas')} (${cobranzas.length})`}
        onClose={() => setCobranzasOpen(false)}
        actions={
          <Button variant="ghost" type="button" onClick={() => setCobranzasOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="hoy-modal-list">
          {cobranzas.map((c) => {
            const name = getClientName(c)
            return (
              <div key={c.id} className="hoy-modal-row cobranza">
                <div className="hoy-modal-row-info">
                  <div className="hoy-modal-row-name">{name}</div>
                  <div className="hoy-modal-row-meta">
                    {c.dias_atraso != null && c.dias_atraso > 0 && (
                      <span className="seller-pill variant-danger">
                        {`${getAtrasoBucket(c.dias_atraso)} de atraso`}
                      </span>
                    )}
                    {c.monto_moroso != null && c.monto_moroso > 0 && (
                      <span className="hoy-modal-row-amount">{formatCurrency(c.monto_moroso)}</span>
                    )}
                  </div>
                </div>
                <div className="hoy-modal-row-actions">
                  <Button variant="ghost" onClick={() => handleCall(c.telefono)}>📞</Button>
                  <Button variant="ghost" onClick={() => handleWhatsappCliente({ id: c.id, nombre: name, telefono: c.telefono })}>💬</Button>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      {/* ── Mantenimientos modal ──────────────────────────── */}
      <Modal
        open={mantenimientosOpen}
        title={`${t('hoy.mantenimientos')} (${mantenimientos.length})`}
        onClose={() => setMantenimientosOpen(false)}
        actions={
          <Button variant="ghost" type="button" onClick={() => setMantenimientosOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="hoy-modal-list">
          {mantenimientos.map((m) => {
            const clienteRaw = Array.isArray(m.equipo) ? m.equipo[0]?.cliente : m.equipo?.cliente
            const cliente = Array.isArray(clienteRaw) ? clienteRaw[0] : clienteRaw
            const name = cliente ? getClientName(cliente) : t('common.noData')
            return (
              <div key={m.id} className="hoy-modal-row mantenimiento">
                <div className="hoy-modal-row-info">
                  <div className="hoy-modal-row-name">{name}</div>
                  <div className="hoy-modal-row-meta">
                    <span className="seller-pill variant-warning">{m.nombre_componente ?? '-'}</span>
                    <span className="hoy-modal-row-date">{relativeDayLabel(m.fecha_proximo_cambio)}</span>
                  </div>
                </div>
                <div className="hoy-modal-row-actions">
                  <Button variant="ghost" onClick={() => handleCall(cliente?.telefono ?? null)}>📞</Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleWhatsappCliente({ id: cliente?.id ?? '', nombre: name, telefono: cliente?.telefono ?? null })}
                    disabled={!cliente?.id}
                  >
                    💬
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      {/* ── Reactivación modal ────────────────────────────── */}
      <Modal
        open={reactivacionOpen}
        title={`${t('hoy.reactivacion')} (${reactivacion.length})`}
        onClose={() => setReactivacionOpen(false)}
        actions={
          <Button variant="ghost" type="button" onClick={() => setReactivacionOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="hoy-modal-list">
          {reactivacion.map((c) => {
            const name = getClientName(c)
            return (
              <div key={c.id} className="hoy-modal-row reactivacion">
                <div className="hoy-modal-row-info">
                  <div className="hoy-modal-row-name">{name}</div>
                  <div className="hoy-modal-row-meta">
                    <span className="seller-pill variant-neutral">
                      {c.fecha_ultimo_pedido
                        ? `${t('hoy.ultimoPedido')} ${relativeDayLabel(c.fecha_ultimo_pedido)}`
                        : t('hoy.sinPedido')}
                    </span>
                  </div>
                </div>
                <div className="hoy-modal-row-actions">
                  <Button variant="ghost" onClick={() => handleCall(c.telefono)}>📞</Button>
                  <Button variant="ghost" onClick={() => handleWhatsappCliente({ id: c.id, nombre: name, telefono: c.telefono })}>💬</Button>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      <ModalRenderer />

      {actionsOpen && actionsLead && (
        <div className="drawer-backdrop" onClick={closeActions} role="presentation">
          <div
            className="hoy-actions-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="hoy-actions-header">
              <div>
                <h3>{getLeadName(actionsLead)}</h3>
                <p>{actionsLead.next_action || t('hoy.noAction')}</p>
              </div>
              <button type="button" className="icon-button" onClick={closeActions} aria-label="Close">
                x
              </button>
            </header>
            <div className="hoy-actions-body">
              <Button
                variant="ghost"
                onClick={() => {
                  handleCall(actionsLead.telefono)
                  closeActions()
                }}
              >
                📞 {t('hoy.call')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  handleWhatsapp(actionsLead)
                  closeActions()
                }}
              >
                💬 {t('hoy.whatsapp')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  openReschedule(actionsLead)
                  closeActions()
                }}
              >
                🗓️ {t('hoy.reschedule')}
              </Button>
              <Button variant="primary" onClick={() => handleCheckIn(actionsLead)} disabled={checkinSaving}>
                📍 {checkinSaving ? t('common.saving') : 'Check-in'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={rescheduleOpen}
        title={t('hoy.rescheduleTitle')}
        onClose={() => setRescheduleOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setRescheduleOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="hoy-reschedule-form" disabled={rescheduleSaving}>
              {rescheduleSaving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="hoy-reschedule-form" className="form-grid" onSubmit={submitReschedule}>
          <label className="form-field">
            <span>{t('hoy.nextAction')}</span>
            <input value={rescheduleAction} onChange={(event) => setRescheduleAction(event.target.value)} />
          </label>
          <label className="form-field">
            <span>{t('hoy.nextDate')}</span>
            <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
          </label>
        </form>
      </Modal>
    </div>
  )
}
