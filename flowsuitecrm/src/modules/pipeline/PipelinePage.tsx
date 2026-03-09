import { type ChangeEvent, type DragEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { Badge } from '../../components/Badge'
import { CalificacionPanel } from '../../components/CalificacionPanel'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { IconWhatsapp } from '../../components/icons'
import { useToast } from '../../components/Toast'
import { useUsers } from '../../data/UsersProvider'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { EmptyState } from '../../components/EmptyState'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useMessaging } from '../../hooks/useMessaging'
import { normalizeLeadStage } from '../../constants/pipeline'

type LeadCard = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  fecha_nacimiento: string | null
  estado_pipeline: string | null
  next_action: string | null
  next_action_date: string | null
  fuente: string | null
  programa_id: string | null
  embajador_id: string | null
  owner_id: string | null
  estado_civil: string | null
  nombre_conyuge: string | null
  telefono_conyuge: string | null
  situacion_laboral: string | null
  ninos_en_casa: boolean | null
  cantidad_ninos: number | null
  tiene_productos_rp: boolean | null
  tipo_vivienda: string | null
  vendedor_id: string | null
}

type ClienteOption = {
  id: string
  nombre: string | null
  apellido: string | null
}

type OportunidadForm = {
  lead_id: string
  cliente_id: string
  etapa: string
  valor: string
  probabilidad: string
  fecha_cierre_estimada: string
  notas: string
}

const initialOpportunityForm: OportunidadForm = {
  lead_id: '',
  cliente_id: '',
  etapa: 'nuevo',
  valor: '',
  probabilidad: '',
  fecha_cierre_estimada: '',
  notas: '',
}


const stageColors: Record<string, string> = {
  nuevo: '#6366f1',
  contactado: '#8b5cf6',
  cita: '#f59e0b',
  demo: '#f97316',
  cierre: '#10b981',
  descartado: '#6b7280',
}

export function PipelinePage() {
  const { t } = useTranslation()
  const configured = isSupabaseConfigured
  const { usersById, currentRole } = useUsers()
  const { session } = useAuth()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const { showToast } = useToast()

  const [leads, setLeads] = useState<LeadCard[]>([])
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<LeadCard | null>(null)
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialOpportunityForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Filters & UI state
  const [busqueda, setBusqueda] = useState('')
  const [filtroOwner, setFiltroOwner] = useState('')
  const [filtroFuente, setFiltroFuente] = useState('')
  const [filtrosVisible, setFiltrosVisible] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileStage, setMobileStage] = useState('nuevo')

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 720)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const stages = useMemo(
    () => ['nuevo', 'contactado', 'cita', 'demo', 'cierre', 'descartado'],
    []
  )

  const fuenteLabels = useMemo(
    () => ({
      toque_puerta: t('leads.sources.toquePuerta'),
      feria: t('leads.sources.feria'),
      familiares_amigos: t('leads.sources.familiares'),
      programa_canastas: t('leads.sources.programaCanastas'),
      redes_sociales: t('leads.sources.redesSociales'),
      exhibicion: t('leads.sources.exhibicion'),
      referido: t('leads.sources.referido'),
      conexiones_infinitas: t('leads.sources.conexionesInfinitas'),
      otro: t('leads.sources.otro'),
    }),
    [t]
  )

  const getFuenteLabel = useCallback(
    (fuente: string | null) => {
      if (!fuente) return null
      return (fuenteLabels as Record<string, string>)[fuente] ?? fuente
    },
    [fuenteLabels]
  )

  const getOwnerName = useCallback(
    (ownerId: string | null) => {
      if (!ownerId) return null
      return usersById[ownerId] ?? ownerId
    },
    [usersById]
  )

  const getInitials = useCallback((value?: string | null) => {
    if (!value) return ''
    const parts = value.split(' ').filter(Boolean)
    if (parts.length === 0) return ''
    const first = parts[0][0] ?? ''
    const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
    return `${first}${last}`.toUpperCase()
  }, [])

  const normalizeDateKey = useCallback((value: string | null) => {
    if (!value) return null
    return value.includes('T') ? value.split('T')[0] : value
  }, [])

  const getDateStatus = useCallback(
    (date: string | null): 'overdue' | 'today' | null => {
      const key = normalizeDateKey(date)
      if (!key) return null
      if (key < today) return 'overdue'
      if (key === today) return 'today'
      return null
    },
    [normalizeDateKey, today]
  )

  const loadLeads = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let query = supabase.from('leads').select('id, nombre, apellido, email, telefono, fecha_nacimiento, estado_pipeline, next_action, next_action_date, fuente, programa_id, embajador_id, owner_id, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda, vendedor_id').is('deleted_at', null)
    if ((currentRole === 'vendedor' || (hasDistribuidorScope && viewMode === 'seller')) && session?.user.id) {
      query = query.or(`owner_id.eq.${session.user.id},vendedor_id.eq.${session.user.id}`)
    }
    if (hasDistribuidorScope && viewMode === 'distributor') {
      if (distributionUserIds.length === 0) {
        setLeads([])
        setLoading(false)
        return
      }
      const ids = distributionUserIds.join(',')
      query = query.or(`owner_id.in.(${ids}),vendedor_id.in.(${ids})`)
    }
    const { data, error: fetchError } = await query
    if (fetchError) {
      setError(fetchError.message)
      setLeads([])
    } else {
      setLeads(data ?? [])
    }
    setLoading(false)
  }, [configured, currentRole, distributionUserIds, hasDistribuidorScope, session?.user.id, viewMode])

  useEffect(() => {
    if (configured) {
      loadLeads()
      supabase
        .from('clientes')
        .select('id, nombre, apellido')
        .then(({ data }) => setClientes((data as ClienteOption[]) ?? []))
    }
  }, [configured, loadLeads])

  const normalizeStage = (stage: string | null): string => {
    let s = normalizeLeadStage(stage)
    if (!s || s === 'otro') s = 'nuevo'
    if (!['nuevo', 'contactado', 'cita', 'demo', 'cierre', 'descartado'].includes(s)) s = 'descartado'
    return s
  }

  const groupedLeads = useMemo(() => {
    const groups: Record<string, LeadCard[]> = {}
    stages.forEach((stage) => { groups[stage] = [] })
    leads.forEach((lead) => {
      const stage = normalizeStage(lead.estado_pipeline)
      groups[stage].push(lead)
    })
    return groups
  }, [leads, stages])

  // --- Filters ---
  const ownersUnicos = useMemo(
    () => [...new Set(leads.map((l) => l.owner_id).filter(Boolean) as string[])],
    [leads]
  )
  const fuentesUnicas = useMemo(
    () => [...new Set(leads.map((l) => l.fuente).filter(Boolean) as string[])],
    [leads]
  )

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ').toLowerCase()
      const phone = (lead.telefono ?? '').toLowerCase()
      if (busqueda && !fullName.includes(busqueda.toLowerCase()) && !phone.includes(busqueda.toLowerCase())) return false
      if (filtroOwner && lead.owner_id !== filtroOwner) return false
      if (filtroFuente && lead.fuente !== filtroFuente) return false
      return true
    })
  }, [leads, busqueda, filtroOwner, filtroFuente])

  const filteredGroupedLeads = useMemo(() => {
    const groups: Record<string, LeadCard[]> = {}
    stages.forEach((stage) => { groups[stage] = [] })
    filteredLeads.forEach((lead) => {
      const stage = normalizeStage(lead.estado_pipeline)
      groups[stage].push(lead)
    })
    return groups
  }, [filteredLeads, stages])

  const cantFiltrosActivos = [busqueda, filtroOwner, filtroFuente].filter(Boolean).length

  const limpiarFiltros = () => {
    setBusqueda('')
    setFiltroOwner('')
    setFiltroFuente('')
  }

  // --- Stats (based on all leads) ---
  const stats = useMemo(() => {
    const overdueCount = leads.filter((l) => {
      const dateKey = normalizeDateKey(l.next_action_date)
      return Boolean(dateKey) && dateKey! < today && normalizeStage(l.estado_pipeline) !== 'descartado'
    }).length
    const byStage: Record<string, number> = {}
    stages.forEach((s) => { byStage[s] = groupedLeads[s]?.length ?? 0 })
    return { total: leads.length, overdue: overdueCount, byStage }
  }, [leads, groupedLeads, stages, today])

  // --- Drag & drop ---
  const handleDragStart = (event: DragEvent<HTMLDivElement>, leadId: string) => {
    event.dataTransfer.setData('text/plain', leadId)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingId(leadId)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverStage(null)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>, stage: string) => {
    event.preventDefault()
    setDragOverStage(stage)
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDragLeave = (stage: string) => {
    if (dragOverStage === stage) setDragOverStage(null)
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>, stage: string) => {
    event.preventDefault()
    setDragOverStage(null)
    setDraggingId(null)
    const leadId = event.dataTransfer.getData('text/plain')
    if (!leadId) return
    setLeads((prev) =>
      prev.map((lead) => (lead.id === leadId ? { ...lead, estado_pipeline: stage } : lead))
    )
    const { error: updateError } = await supabase
      .from('leads')
      .update({ estado_pipeline: stage })
      .eq('id', leadId)
    if (updateError) {
      setError(updateError.message)
      loadLeads()
    }
  }

  // --- Quick move (← →) ---
  const handleMoveCard = useCallback(
    async (leadId: string, currentStage: string, direction: 'left' | 'right') => {
      const currentIndex = stages.indexOf(currentStage)
      const newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1
      if (newIndex < 0 || newIndex >= stages.length) return
      const newStage = stages[newIndex]
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, estado_pipeline: newStage } : l))
      )
      const { error: updateError } = await supabase
        .from('leads')
        .update({ estado_pipeline: newStage })
        .eq('id', leadId)
      if (updateError) {
        setError(updateError.message)
        loadLeads()
      } else {
        if (isMobile) setMobileStage(newStage)
      }
    },
    [stages, loadLeads, isMobile]
  )

  // --- Opportunity form ---
  const handleOpenForm = () => {
    setFormValues(initialOpportunityForm)
    setFormError(null)
    setFormOpen(true)
  }

  const handleFormChange =
    (field: keyof OportunidadForm) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setFormValues((prev) => ({ ...prev, [field]: event.target.value }))
      }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const ownerId = session?.user.id ?? null
    const payload = {
      lead_id: toNull(formValues.lead_id),
      cliente_id: toNull(formValues.cliente_id),
      owner_id: ownerId,
      etapa: formValues.etapa,
      valor: formValues.valor === '' ? 0 : Number(formValues.valor),
      probabilidad: formValues.probabilidad === '' ? null : Number(formValues.probabilidad),
      fecha_cierre_estimada: formValues.fecha_cierre_estimada || null,
      notas: toNull(formValues.notas),
    }
    const { error: insertError } = await supabase.from('oportunidades').insert(payload)
    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  // --- Card renderer ---
  const renderCard = (lead: LeadCard, stage: string) => {
    const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
    const fuenteLabel = getFuenteLabel(lead.fuente)
    const ownerName = getOwnerName(lead.owner_id)
    const initials = getInitials(ownerName)
    const stageIndex = stages.indexOf(stage)
    const dateStatus = getDateStatus(lead.next_action_date)

    return (
      <div
        key={lead.id}
        className="pipeline-card"
        draggable
        onDragStart={(event) => handleDragStart(event, lead.id)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (draggingId) return
          setSelectedLead(lead)
        }}
      >
        {/* Move buttons */}
        <div className="pipeline-card-moves">
          {stageIndex > 0 && (
            <button
              type="button"
              className="pipeline-move-btn"
              title={t('pipeline.moveLeft')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                handleMoveCard(lead.id, stage, 'left')
              }}
            >
              ←
            </button>
          )}
          {stageIndex < stages.length - 1 && (
            <button
              type="button"
              className="pipeline-move-btn"
              title={t('pipeline.moveRight')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                handleMoveCard(lead.id, stage, 'right')
              }}
            >
              →
            </button>
          )}
        </div>

        <div className="pipeline-card-title">{fullName}</div>
        {fuenteLabel && (
          <Badge label={fuenteLabel} tone="blue" className="badge-tiny pipeline-badge" />
        )}
        <div className="pipeline-card-meta">{lead.telefono ?? '-'}</div>
        {ownerName && (
          <div className="pipeline-card-owner">
            <span className="owner-avatar">{initials || '-'}</span>
            <span className="owner-name">{ownerName}</span>
          </div>
        )}
        <div className="pipeline-card-next">
          <span>{t('pipeline.nextAction')}</span>
          <strong>{lead.next_action ?? t('pipeline.noAction')}</strong>
        </div>
        {lead.next_action_date && (
          <div className="pipeline-card-date">
            {dateStatus && <span className={`pipeline-date-dot ${dateStatus}`} />}
            <span>{lead.next_action_date}</span>
            {dateStatus === 'overdue' && (
              <span style={{ color: '#f87171', fontSize: '0.7rem', fontWeight: 600 }}>
                {t('pipeline.overdue')}
              </span>
            )}
            {dateStatus === 'today' && (
              <span style={{ color: '#fbbf24', fontSize: '0.7rem', fontWeight: 600 }}>
                {t('pipeline.dueSoon')}
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          className="whatsapp-button pipeline-whatsapp"
          aria-label={t('whatsapp.open')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            openWhatsapp({
              nombre: fullName,
              telefono: lead.telefono ?? '',
              email: lead.email ?? '',
              vendedor: ownerName ?? '',
              leadId: lead.id,
            })
          }}
        >
          <IconWhatsapp className="whatsapp-icon" />
        </button>
      </div>
    )
  }

  if (!configured) {
    return (
      <EmptyState
        title={t('dashboard.missingConfigTitle')}
        description={t('dashboard.missingConfigDescription')}
      />
    )
  }

  const statCards = [
    { label: 'Total', value: stats.total, color: '#3b82f6' },
    ...stages
      .filter((s) => s !== 'descartado')
      .map((s) => ({ label: t(`pipeline.columns.${s}`), value: stats.byStage[s] ?? 0, color: stageColors[s] ?? '#6b7280' })),
    { label: t('pipeline.overdue'), value: stats.overdue, color: '#f87171' },
  ]

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('pipeline.title')}
        subtitle={t('pipeline.subtitle')}
        action={<Button onClick={handleOpenForm}>{t('oportunidades.new')}</Button>}
      />

      {error && <div className="form-error">{error}</div>}

      {/* STATS */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
          gap: '0.6rem',
        }}
      >
        {statCards.map((s) => (
          <div
            key={s.label}
            style={{
              padding: '0.75rem 0.5rem',
              background: 'var(--color-surface, #f9fafb)',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border, #e5e7eb)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted, #6b7280)', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* FILTERS */}
      <div
        style={{
          background: 'var(--color-surface, #f9fafb)',
          borderRadius: '0.75rem',
          border: '1px solid var(--color-border, #e5e7eb)',
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFiltrosVisible((v) => !v)}
          onKeyDown={(e) => e.key === 'Enter' && setFiltrosVisible((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--color-text-muted, #6b7280)',
                letterSpacing: '0.05em',
              }}
            >
              FILTROS
            </span>
            {cantFiltrosActivos > 0 && (
              <span
                style={{
                  background: '#2563eb',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.45rem',
                  borderRadius: '9999px',
                  lineHeight: 1.4,
                }}
              >
                {cantFiltrosActivos}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {filteredLeads.length} de {leads.length} leads
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>
              {filtrosVisible ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {filtrosVisible && (
          <div
            style={{
              padding: '0 1rem 1rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'flex-end',
              borderTop: '1px solid var(--color-border, #e5e7eb)',
            }}
          >
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '4px', marginTop: '12px' }}>
                Buscar
              </label>
              <input
                style={{ width: '100%', fontSize: '0.875rem' }}
                placeholder={t('pipeline.filterSearch')}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <div style={{ minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '4px', marginTop: '12px' }}>
                Vendedor
              </label>
              <select
                style={{ width: '100%', fontSize: '0.875rem' }}
                value={filtroOwner}
                onChange={(e) => setFiltroOwner(e.target.value)}
              >
                <option value="">{t('pipeline.allOwners')}</option>
                {ownersUnicos.map((id) => (
                  <option key={id} value={id}>
                    {getOwnerName(id) ?? id}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)', marginBottom: '4px', marginTop: '12px' }}>
                Fuente
              </label>
              <select
                style={{ width: '100%', fontSize: '0.875rem' }}
                value={filtroFuente}
                onChange={(e) => setFiltroFuente(e.target.value)}
              >
                <option value="">{t('pipeline.allSources')}</option>
                {fuentesUnicas.map((f) => (
                  <option key={f} value={f}>
                    {getFuenteLabel(f) ?? f}
                  </option>
                ))}
              </select>
            </div>
            {cantFiltrosActivos > 0 && (
              <button
                type="button"
                className="btn ghost"
                onClick={limpiarFiltros}
                style={{ alignSelf: 'flex-end', marginTop: '12px' }}
              >
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {/* BOARD */}
      {isMobile ? (
        <div>
          {/* Stage tabs */}
          <div className="pipeline-mobile-tabs">
            {stages.map((stage) => (
              <button
                key={stage}
                type="button"
                className={`pipeline-mobile-tab${mobileStage === stage ? ' active' : ''}`}
                onClick={() => setMobileStage(stage)}
              >
                {t(`pipeline.columns.${stage}`)}
                <span style={{ opacity: 0.65 }}>({filteredGroupedLeads[stage]?.length ?? 0})</span>
              </button>
            ))}
          </div>
          {/* Cards for active stage */}
          {loading && <div className="pipeline-empty">{t('common.loading')}</div>}
          {!loading && filteredGroupedLeads[mobileStage]?.length === 0 && (
            <div className="pipeline-empty">{t('pipeline.emptyColumn')}</div>
          )}
          {filteredGroupedLeads[mobileStage]?.map((lead) => renderCard(lead, mobileStage))}
        </div>
      ) : (
        <div className="pipeline-board">
          {stages.map((stage) => (
            <div
              className={`pipeline-column${stage === 'descartado' ? ' discard' : ''}${dragOverStage === stage ? ' drag-over' : ''}`}
              key={stage}
              onDragOver={(event) => handleDragOver(event, stage)}
              onDragLeave={() => handleDragLeave(stage)}
              onDrop={(event) => handleDrop(event, stage)}
            >
              <h4 className="pipeline-column-title">
                <span>{t(`pipeline.columns.${stage}`).toUpperCase()}</span>
                <span className="pipeline-column-count">({filteredGroupedLeads[stage]?.length ?? 0})</span>
              </h4>
              {loading && <div className="pipeline-empty">{t('common.loading')}</div>}
              {!loading && filteredGroupedLeads[stage]?.length === 0 && (
                <div className="pipeline-empty">{t('pipeline.emptyColumn')}</div>
              )}
              {filteredGroupedLeads[stage]?.map((lead) => renderCard(lead, stage))}
            </div>
          ))}
        </div>
      )}

      <CalificacionPanel
        open={Boolean(selectedLead)}
        lead={selectedLead}
        ownerName={selectedLead ? getOwnerName(selectedLead.owner_id) : undefined}
        fuenteLabel={selectedLead ? getFuenteLabel(selectedLead.fuente) ?? undefined : undefined}
        onClose={() => setSelectedLead(null)}
        onSaved={loadLeads}
      />
      <ModalRenderer />
      <Modal
        open={formOpen}
        title={t('oportunidades.form.title')}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="oportunidad-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="oportunidad-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('oportunidades.form.lead')}</span>
            <select value={formValues.lead_id} onChange={handleFormChange('lead_id')}>
              <option value="">{t('common.select')}</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {[lead.nombre, lead.apellido].filter(Boolean).join(' ') || lead.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.cliente')}</span>
            <select value={formValues.cliente_id} onChange={handleFormChange('cliente_id')}>
              <option value="">{t('common.select')}</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {[cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.etapa')}</span>
            <select value={formValues.etapa} onChange={handleFormChange('etapa')}>
              <option value="nuevo">{t('pipeline.columns.nuevo')}</option>
              <option value="contactado">{t('pipeline.columns.contactado')}</option>
              <option value="cita">{t('pipeline.columns.cita')}</option>
              <option value="demo">{t('pipeline.columns.demo')}</option>
              <option value="cierre">{t('pipeline.columns.cierre')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.valor')}</span>
            <input type="number" value={formValues.valor} onChange={handleFormChange('valor')} />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.probabilidad')}</span>
            <input
              type="number"
              value={formValues.probabilidad}
              onChange={handleFormChange('probabilidad')}
            />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.fecha')}</span>
            <input
              type="date"
              value={formValues.fecha_cierre_estimada}
              onChange={handleFormChange('fecha_cierre_estimada')}
            />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.notas')}</span>
            <textarea rows={3} value={formValues.notas} onChange={handleFormChange('notas')} />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
    </div>
  )
}
