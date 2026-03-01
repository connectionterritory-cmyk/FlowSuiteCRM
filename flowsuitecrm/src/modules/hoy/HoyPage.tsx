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
import { getLeadStageBadgeVariant, getLeadStageLabel } from '../../constants/pipeline'

type LeadRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  estado_pipeline: string | null
  next_action: string | null
  next_action_date: string | null
  updated_at: string | null
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

const NOTE_DEFAULT = 'seguimiento'

export function HoyPage() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { currentUser } = useUsers()
  const configured = isSupabaseConfigured
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overdueLeads, setOverdueLeads] = useState<LeadRow[]>([])
  const [todayLeads, setTodayLeads] = useState<LeadRow[]>([])
  const [newLeads, setNewLeads] = useState<LeadRow[]>([])
  const [closingOpps, setClosingOpps] = useState<OpportunityRow[]>([])
  const [salesSummary, setSalesSummary] = useState<SalesSummary>({ total: 0, count: 0 })
  const [lastActivityMap, setLastActivityMap] = useState<Record<string, string | null>>({})

  const [noteOpen, setNoteOpen] = useState(false)
  const [noteLead, setNoteLead] = useState<LeadRow | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

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

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language || 'es', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(today),
    [today, i18n.language]
  )

  const allClear = useMemo(
    () =>
      !loading &&
      overdueLeads.length === 0 &&
      todayLeads.length === 0 &&
      closingOpps.length === 0 &&
      newLeads.length === 0,
    [loading, overdueLeads, todayLeads, closingOpps, newLeads]
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

  const timeAgo = useCallback(
    (value?: string | null) => {
      if (!value) return '-'
      const now = Date.now()
      const date = new Date(value).getTime()
      const diff = Math.max(0, now - date)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)
      if (days >= 1) return t('hoy.timeAgoDays', { count: days })
      return t('hoy.timeAgoHours', { count: Math.max(1, hours) })
    },
    [t]
  )

  const isUrgent = useCallback(
    (lastActivityAt?: string | null) => {
      if (!lastActivityAt) return true
      const activity = new Date(lastActivityAt)
      return activity.getTime() <= threeDaysAgo.getTime()
    },
    [threeDaysAgo]
  )

  const loadLastActivity = useCallback(
    async (leadIds: string[]) => {
      if (!configured || leadIds.length === 0) return
      const { data, error: activityError } = await supabase
        .from('v_lead_last_activity')
        .select('lead_id, last_activity_at')
        .in('lead_id', leadIds)

      if (activityError) {
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

    const baseLeadSelect = 'id, nombre, apellido, telefono, estado_pipeline, next_action, next_action_date, updated_at'
    const vendedorId = session.user.id
    const { start, end } = getMonthRange()
    const todayPlus7 = new Date(today)
    todayPlus7.setDate(todayPlus7.getDate() + 7)
    const todayPlus7Iso = todayPlus7.toISOString().split('T')[0]

    const [overdueRes, todayRes, newRes, oppsRes, salesRes] = await Promise.all([
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
    })
  }

  const openNote = (lead: LeadRow) => {
    setNoteLead(lead)
    setNoteText('')
    setNoteOpen(true)
  }

  const openReschedule = (lead: LeadRow) => {
    setRescheduleLead(lead)
    setRescheduleAction(lead.next_action ?? '')
    setRescheduleDate(lead.next_action_date ?? '')
    setRescheduleOpen(true)
  }

  const submitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!noteLead || !session?.user.id) return
    if (!noteText.trim()) {
      showToast(t('common.noData'), 'error')
      return
    }
    setNoteSaving(true)
    const previousMap = { ...lastActivityMap }
    const optimisticTime = new Date().toISOString()
    setLastActivityMap((prev) => ({ ...prev, [noteLead.id]: optimisticTime }))
    const { error: insertError } = await supabase.from('lead_notas').insert({
      lead_id: noteLead.id,
      usuario_id: session.user.id,
      nota: noteText.trim(),
      tipo: NOTE_DEFAULT,
    })
    if (insertError) {
      setLastActivityMap(previousMap)
      showToast(insertError.message, 'error')
    } else {
      showToast(t('hoy.saved'))
      setNoteOpen(false)
      await loadData()
    }
    setNoteSaving(false)
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

  const renderLeadCard = (lead: LeadRow, variant: 'overdue' | 'today' | 'new') => {
    const lastActivityAt = lastActivityMap[lead.id] ?? lead.updated_at
    const urgent = isUrgent(lastActivityAt)
    const statusLabel = variant === 'overdue' ? t('hoy.overdueBadge') : variant === 'today' ? t('hoy.todayBadge') : null
    return (
      <div key={lead.id} className={`seller-card seller-lead ${variant} ${urgent ? 'urgent' : ''}`.trim()}>
        <div className="seller-lead-main">
          <div>
            <div className="seller-lead-name">{getLeadName(lead)}</div>
            <div className="seller-lead-meta">
              <span className={`seller-pill variant-${getLeadStageBadgeVariant(lead.estado_pipeline)}`.trim()}>
                {getLeadStageLabel(lead.estado_pipeline, t)}
              </span>
              <span>{lead.next_action || t('hoy.noAction')}</span>
            </div>
            <div className="seller-lead-status">
              {statusLabel && <span className="seller-badge">{statusLabel}</span>}
              {urgent && <span className="seller-badge danger">{t('hoy.urgentBadge')}</span>}
            </div>
          </div>
          <div className="seller-lead-dates">
            <span className="seller-date">{relativeDayLabel(lead.next_action_date)}</span>
            <span className="seller-last">
              {t('hoy.lastActivity')} {timeAgo(lastActivityAt)}
            </span>
          </div>
        </div>
        <div className="seller-lead-actions">
          <Button variant="ghost" onClick={() => handleCall(lead.telefono)}>
            {t('hoy.call')}
          </Button>
          <Button variant="ghost" onClick={() => handleWhatsapp(lead)}>
            {t('hoy.whatsapp')}
          </Button>
          <Button variant="ghost" onClick={() => openNote(lead)}>
            {t('hoy.note')}
          </Button>
          <Button variant="ghost" onClick={() => openReschedule(lead)}>
            {t('hoy.reschedule')}
          </Button>
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

      {/* ── Greeting ─────────────────────────────────────── */}
      <div className="hoy-greeting">
        <div>
          <div className="hoy-greeting-name">
            {greetingName ? `${t('hoy.title')}, ${greetingName}` : t('hoy.title')}
          </div>
          <div className="hoy-greeting-date">{dateLabel}</div>
        </div>
        <Button variant="ghost" type="button" onClick={loadData}>
          {t('hoy.refresh')}
        </Button>
      </div>

      {/* ── Quick stats ───────────────────────────────────── */}
      <div className="hoy-stats">
        <div className={`hoy-stat ${overdueLeads.length > 0 ? 'alert' : ''}`.trim()}>
          <span className="hoy-stat-value">{overdueLeads.length + todayLeads.length}</span>
          <span className="hoy-stat-label">{t('hoy.statsActions')}</span>
        </div>
        <div className="hoy-stat">
          <span className="hoy-stat-value">{newLeads.length}</span>
          <span className="hoy-stat-label">{t('hoy.statsLeads')}</span>
        </div>
        <div className="hoy-stat">
          <span className="hoy-stat-value">{closingOpps.length}</span>
          <span className="hoy-stat-label">{t('hoy.statsClosing')}</span>
        </div>
      </div>

      {/* ── Monthly production ───────────────────────────── */}
      <div className="seller-card seller-production">
        <div>
          <div className="seller-summary-meta">{t('hoy.monthlyProduction')}</div>
          <div className="seller-summary-value">{formatCurrency(salesSummary.total)}</div>
          <div className="seller-summary-meta">
            {t('hoy.salesCount', { count: salesSummary.count })}
          </div>
        </div>
        <div className="seller-production-icon">💰</div>
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

      {/* ── Overdue ───────────────────────────────────────── */}
      {!loading && overdueLeads.length > 0 && (
        <section className="seller-section">
          <div className="seller-section-header">
            <h3>{t('hoy.overdue')}</h3>
            <span className="seller-count alert">{overdueLeads.length}</span>
          </div>
          {overdueLeads.map((lead) => renderLeadCard(lead, 'overdue'))}
        </section>
      )}

      {/* ── Due today ─────────────────────────────────────── */}
      {!loading && todayLeads.length > 0 && (
        <section className="seller-section">
          <div className="seller-section-header">
            <h3>{t('hoy.today')}</h3>
            <span className="seller-count">{todayLeads.length}</span>
          </div>
          {todayLeads.map((lead) => renderLeadCard(lead, 'today'))}
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

      {/* ── New leads ─────────────────────────────────────── */}
      {!loading && newLeads.length > 0 && (
        <section className="seller-section">
          <div className="seller-section-header">
            <h3>{t('hoy.newLeads')}</h3>
            <span className="seller-count">{newLeads.length}</span>
          </div>
          {newLeads.map((lead) => renderLeadCard(lead, 'new'))}
        </section>
      )}

      <ModalRenderer />

      <Modal
        open={noteOpen}
        title={t('hoy.noteTitle')}
        onClose={() => setNoteOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setNoteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="hoy-note-form" disabled={noteSaving}>
              {noteSaving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="hoy-note-form" className="form-grid" onSubmit={submitNote}>
          <label className="form-field">
            <span>{t('hoy.noteLabel')}</span>
            <textarea rows={4} value={noteText} onChange={(event) => setNoteText(event.target.value)} />
          </label>
        </form>
      </Modal>

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
