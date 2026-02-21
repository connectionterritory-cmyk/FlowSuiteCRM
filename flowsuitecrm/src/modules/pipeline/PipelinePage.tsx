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
import { EmptyState } from '../../components/EmptyState'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useMessaging } from '../../hooks/useMessaging'

type LeadCard = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  apartamento: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
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

export function PipelinePage() {
  const { t } = useTranslation()
  const configured = isSupabaseConfigured
  const { usersById } = useUsers()
  const { session } = useAuth()
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

  const loadLeads = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('leads')
      .select('*')

    if (fetchError) {
      setError(fetchError.message)
      setLeads([])
    } else {
      setLeads(data ?? [])
    }
    setLoading(false)
  }, [configured])

  useEffect(() => {
    if (configured) {
      loadLeads()
      supabase
        .from('clientes')
        .select('id, nombre, apellido')
        .then(({ data }) => setClientes((data as ClienteOption[]) ?? []))
    }
  }, [configured, loadLeads])

  const groupedLeads = useMemo(() => {
    const groups: Record<string, LeadCard[]> = {}
    stages.forEach((stage) => {
      groups[stage] = []
    })
    leads.forEach((lead) => {
      let stage = lead.estado_pipeline ?? 'nuevo'
      if (stage === 'calificado') stage = 'cita'
      if (stage === 'demostracion') stage = 'demo'
      if (!stages.includes(stage)) stage = 'descartado'
      if (!groups[stage]) {
        groups[stage] = []
      }
      groups[stage].push(lead)
    })
    return groups
  }, [leads, stages])

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
    if (dragOverStage === stage) {
      setDragOverStage(null)
    }
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>, stage: string) => {
    event.preventDefault()
    setDragOverStage(null)
    setDraggingId(null)
    const leadId = event.dataTransfer.getData('text/plain')
    if (!leadId) return

    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId ? { ...lead, estado_pipeline: stage } : lead
      )
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

  const handleOpenForm = () => {
    setFormValues(initialOpportunityForm)
    setFormError(null)
    setFormOpen(true)
  }

  const handleFormChange = (field: keyof OportunidadForm) =>
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

  const getInitials = useCallback((value?: string | null) => {
    if (!value) return ''
    const parts = value.split(' ').filter(Boolean)
    if (parts.length === 0) return ''
    const first = parts[0][0] ?? ''
    const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
    return `${first}${last}`.toUpperCase()
  }, [])

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('oportunidades.title')}
        subtitle={t('oportunidades.subtitle')}
        action={<Button onClick={handleOpenForm}>{t('oportunidades.new')}</Button>}
      />
      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="pipeline-board">
        {stages.map((stage) => (
          <div
            className={`pipeline-column ${stage === 'descartado' ? 'discard' : ''} ${dragOverStage === stage ? 'drag-over' : ''}`}
            key={stage}
            onDragOver={(event) => handleDragOver(event, stage)}
            onDragLeave={() => handleDragLeave(stage)}
            onDrop={(event) => handleDrop(event, stage)}
          >
            <h4 className="pipeline-column-title">
              <span>{t(`pipeline.columns.${stage}`).toUpperCase()}</span>
              <span className="pipeline-column-count">({groupedLeads[stage]?.length ?? 0})</span>
            </h4>
            {loading && <div className="pipeline-empty">{t('common.loading')}</div>}
            {!loading && groupedLeads[stage]?.length === 0 && (
              <div className="pipeline-empty">{t('pipeline.emptyColumn')}</div>
            )}
            {groupedLeads[stage]?.map((lead) => {
              const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
              const fuenteLabel = getFuenteLabel(lead.fuente)
              const ownerName = getOwnerName(lead.owner_id)
              const initials = getInitials(ownerName)
              let normalizedStage = lead.estado_pipeline ?? 'nuevo'
              if (normalizedStage === 'calificado') normalizedStage = 'cita'
              if (normalizedStage === 'demostracion') normalizedStage = 'demo'
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
            })}
          </div>
        ))}
      </div>
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
            <input type="number" value={formValues.probabilidad} onChange={handleFormChange('probabilidad')} />
          </label>
          <label className="form-field">
            <span>{t('oportunidades.form.fecha')}</span>
            <input type="date" value={formValues.fecha_cierre_estimada} onChange={handleFormChange('fecha_cierre_estimada')} />
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
