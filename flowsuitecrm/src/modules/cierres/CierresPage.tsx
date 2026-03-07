import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../auth/AuthProvider'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { LEAD_PIPELINE_FALLBACK_STAGES, getLeadStageBadgeVariant, getLeadStageLabel } from '../../constants/pipeline'
import { getOpportunityStageBadgeVariant, getOpportunityStageLabel } from '../../constants/opportunities'

type OpportunityRow = {
  id: string
  nombre: string | null
  etapa: string | null
  valor: number | null
  probabilidad: number | null
  fecha_cierre_estimada: string | null
  updated_at: string | null
  notas: string | null
}

type LeadFallbackRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  estado_pipeline: string | null
  next_action_date: string | null
  updated_at: string | null
}

type OpportunityForm = {
  etapa: string
  valor: string
  probabilidad: string
  fecha_cierre_estimada: string
  notas: string
}

const initialForm: OpportunityForm = {
  etapa: 'nuevo',
  valor: '',
  probabilidad: '',
  fecha_cierre_estimada: '',
  notas: '',
}

export function CierresPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [fallbackLeads, setFallbackLeads] = useState<LeadFallbackRow[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editOpp, setEditOpp] = useState<OpportunityRow | null>(null)
  const [formValues, setFormValues] = useState<OpportunityForm>(initialForm)
  const [saving, setSaving] = useState(false)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const formatDateKey = useCallback(
    (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date),
    []
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

  const formatCurrency = useCallback((value: number) => {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }, [])

  const stageOptions = useMemo(
    () => [
      { value: 'nuevo', label: t('pipeline.columns.nuevo') },
      { value: 'contactado', label: t('pipeline.columns.contactado') },
      { value: 'cita', label: t('pipeline.columns.cita') },
      { value: 'demo', label: t('pipeline.columns.demo') },
      { value: 'cierre', label: t('pipeline.columns.cierre') },
      { value: 'descartado', label: t('pipeline.columns.descartado') },
    ],
    [t]
  )

  const loadData = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setLoading(true)
    setError(null)
    const ownerId = session.user.id

    const { data: opps, error: oppError } = await supabase
      .from('oportunidades')
      .select('id, nombre, etapa, valor, probabilidad, fecha_cierre_estimada, updated_at, notas')
      .eq('owner_id', ownerId)
      .order('fecha_cierre_estimada', { ascending: true, nullsFirst: false })

    if (oppError) {
      setError(oppError.message)
      setOpportunities([])
      setFallbackLeads([])
      setLoading(false)
      return
    }

    const oppRows = (opps as OpportunityRow[] | null) ?? []
    setOpportunities(oppRows)

    if (oppRows.length === 0) {
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, nombre, apellido, telefono, estado_pipeline, next_action_date, updated_at')
        .eq('vendedor_id', ownerId)
        .is('deleted_at', null)
        .in('estado_pipeline', [...LEAD_PIPELINE_FALLBACK_STAGES])
        .order('next_action_date', { ascending: true, nullsFirst: false })

      if (leadsError) {
        setError(leadsError.message)
        setFallbackLeads([])
      } else {
        setFallbackLeads((leads as LeadFallbackRow[] | null) ?? [])
      }
    } else {
      setFallbackLeads([])
    }
    setLoading(false)
  }, [configured, session?.user.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  const openEdit = (opp: OpportunityRow) => {
    setEditOpp(opp)
    setFormValues({
      etapa: opp.etapa ?? 'nuevo',
      valor: opp.valor?.toString() ?? '',
      probabilidad: opp.probabilidad?.toString() ?? '',
      fecha_cierre_estimada: opp.fecha_cierre_estimada ?? '',
      notas: opp.notas ?? '',
    })
    setEditOpen(true)
  }

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editOpp) return
    setSaving(true)
    const previousOpps = opportunities
    const optimisticOpp = {
      ...editOpp,
      etapa: formValues.etapa,
      valor: Number(formValues.valor || 0),
      probabilidad: formValues.probabilidad ? Number(formValues.probabilidad) : null,
      fecha_cierre_estimada: formValues.fecha_cierre_estimada || null,
      notas: formValues.notas.trim() || null,
      updated_at: new Date().toISOString(),
    }
    setOpportunities((prev) => prev.map((opp) => (opp.id === editOpp.id ? optimisticOpp : opp)))
    const payload = {
      etapa: formValues.etapa,
      valor: Number(formValues.valor || 0),
      probabilidad: formValues.probabilidad ? Number(formValues.probabilidad) : null,
      fecha_cierre_estimada: formValues.fecha_cierre_estimada || null,
      notas: formValues.notas.trim() || null,
    }
    const { error: updateError } = await supabase.from('oportunidades').update(payload).eq('id', editOpp.id)
    if (updateError) {
      setOpportunities(previousOpps)
      showToast(updateError.message, 'error')
    } else {
      showToast(t('hoy.updated'))
      setEditOpen(false)
      await loadData()
    }
    setSaving(false)
  }

  if (!configured) {
    return <EmptyState title={t('dashboard.missingConfigTitle')} description={t('dashboard.missingConfigDescription')} />
  }

  return (
    <div className="page-stack seller-home">
      <SectionHeader title={t('cierres.title')} subtitle={t('cierres.subtitle')} />

      {error && <div className="form-error">{error}</div>}

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

      {!loading && opportunities.length === 0 && fallbackLeads.length === 0 && (
        <div className="empty-mini">
          <p>{t('cierres.empty')}</p>
          <div className="empty-actions">
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('quick-actions:open', { detail: { action: 'opportunity' } }))
              }
            >
              {t('cierres.create')}
            </Button>
            <Button variant="ghost" type="button" onClick={() => window.location.assign('/leads')}>
              {t('cierres.viewLeads')}
            </Button>
          </div>
        </div>
      )}

      {!loading && opportunities.length > 0 && (
        <div className="seller-opps">
          {opportunities.map((opp) => (
            <div key={opp.id} className="seller-card seller-opportunity">
              <div className="seller-lead-main">
                <div>
                  <div className="seller-lead-name">{opp.nombre ?? t('common.noData')}</div>
                  <div className="seller-lead-meta">
                    <span className={`seller-pill variant-${getOpportunityStageBadgeVariant(opp.etapa)}`.trim()}>
                      {getOpportunityStageLabel(opp.etapa, t)}
                    </span>
                    <span>{formatCurrency(opp.valor ?? 0)}</span>
                  </div>
                </div>
                <div className="seller-lead-dates">
                  <span className="seller-date">{relativeDayLabel(opp.fecha_cierre_estimada)}</span>
                  <span className="seller-last">
                    {t('cierres.lastActivity')} {timeAgo(opp.updated_at)}
                  </span>
                </div>
              </div>
              <div className="seller-lead-actions">
                <Button variant="ghost" onClick={() => openEdit(opp)}>
                  {t('cierres.update')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && opportunities.length === 0 && fallbackLeads.length > 0 && (
        <section className="seller-section">
          <div className="seller-section-header">
            <h3>{t('cierres.fallbackTitle')}</h3>
            <span className="seller-count">{fallbackLeads.length}</span>
          </div>
          <div className="seller-opps">
            {fallbackLeads.map((lead) => (
              <div key={lead.id} className="seller-card seller-opportunity">
                <div className="seller-lead-main">
                  <div>
                    <div className="seller-lead-name">
                      {[lead.nombre, lead.apellido].filter(Boolean).join(' ').trim() || t('common.noData')}
                    </div>
                    <div className="seller-lead-meta">
                      <span className={`seller-pill variant-${getLeadStageBadgeVariant(lead.estado_pipeline)}`.trim()}>
                        {getLeadStageLabel(lead.estado_pipeline, t)}
                      </span>
                      <span>{lead.telefono ?? '-'}</span>
                    </div>
                  </div>
                  <div className="seller-lead-dates">
                    <span className="seller-date">{relativeDayLabel(lead.next_action_date)}</span>
                    <span className="seller-last">
                      {t('cierres.lastActivity')} {timeAgo(lead.updated_at)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal
        open={editOpen}
        title={t('cierres.updateTitle')}
        onClose={() => setEditOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="cierres-form" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="cierres-form" className="form-grid" onSubmit={submitEdit}>
          <label className="form-field">
            <span>{t('oportunidades.form.etapa')}</span>
            <select value={formValues.etapa} onChange={(event) => setFormValues((prev) => ({ ...prev, etapa: event.target.value }))}>
              {stageOptions.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.valor')}</span>
            <input type="number" value={formValues.valor} onChange={(event) => setFormValues((prev) => ({ ...prev, valor: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.probabilidad')}</span>
            <input type="number" value={formValues.probabilidad} onChange={(event) => setFormValues((prev) => ({ ...prev, probabilidad: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.fecha')}</span>
            <input type="date" value={formValues.fecha_cierre_estimada} onChange={(event) => setFormValues((prev) => ({ ...prev, fecha_cierre_estimada: event.target.value }))} />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.notas')}</span>
            <textarea rows={3} value={formValues.notas} onChange={(event) => setFormValues((prev) => ({ ...prev, notas: event.target.value }))} />
          </label>
        </form>
      </Modal>
    </div>
  )
}
