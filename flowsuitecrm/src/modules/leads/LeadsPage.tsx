import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { CalificacionPanel } from '../../components/CalificacionPanel'
import { EmptyState } from '../../components/EmptyState'
import { IconWhatsapp } from '../../components/icons'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useMessaging } from '../../hooks/useMessaging'

type LeadRecord = {
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
  fuente: string | null
  programa_id: string | null
  embajador_id: string | null
  owner_id: string | null
  estado_pipeline: string | null
  next_action: string | null
  next_action_date: string | null
  estado_civil: string | null
  nombre_conyuge: string | null
  telefono_conyuge: string | null
  situacion_laboral: string | null
  ninos_en_casa: boolean | null
  cantidad_ninos: number | null
  tiene_productos_rp: boolean | null
  tipo_vivienda: string | null
  created_at: string | null
}

const initialForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  fuente: '',
  programa_id: '',
  embajador_id: '',
  owner_id: '',
  estado_pipeline: 'nuevo',
  next_action: '',
  next_action_date: '',
}

const sourceOptions = [
  { value: 'toque_puerta', labelKey: 'leads.sources.toquePuerta' },
  { value: 'feria', labelKey: 'leads.sources.feria' },
  { value: 'familiares_amigos', labelKey: 'leads.sources.familiares' },
  { value: 'programa_canastas', labelKey: 'leads.sources.programaCanastas' },
  { value: 'redes_sociales', labelKey: 'leads.sources.redesSociales' },
  { value: 'exhibicion', labelKey: 'leads.sources.exhibicion' },
  { value: 'referido', labelKey: 'leads.sources.referido' },
  { value: 'conexiones_infinitas', labelKey: 'leads.sources.conexionesInfinitas' },
  { value: 'otro', labelKey: 'leads.sources.otro' },
]

export function LeadsPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [fuenteOtro, setFuenteOtro] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null)
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const configured = isSupabaseConfigured

  const loadRole = useCallback(async () => {
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    const { data, error: roleError } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .maybeSingle()
    if (roleError) {
      setRole(null)
    } else {
      setRole((data as { rol?: string } | null)?.rol ?? null)
    }
  }, [configured, session?.user.id])

  const loadLeads = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (role === 'telemercadeo') {
      query = query.eq('estado_pipeline', 'nuevo')
    }
    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setLeads([])
    } else {
      setLeads(data ?? [])
    }
    setLoading(false)
  }, [configured, role])

  useEffect(() => {
    if (configured) {
      loadRole()
    }
  }, [configured, loadRole])

  useEffect(() => {
    if (configured) {
      loadLeads()
    }
  }, [configured, loadLeads, role])

  const normalizeStage = useCallback((stage: string | null) => {
    if (stage === 'calificado') return 'cita'
    if (stage === 'demostracion') return 'demo'
    return stage ?? 'nuevo'
  }, [])

  const getFuenteLabel = useCallback(
    (fuente: string | null) => {
      if (!fuente) return '-'
      const option = sourceOptions.find((item) => item.value === fuente)
      if (option) return t(option.labelKey)
      return fuente
    },
    [t]
  )

  const getOwnerName = useCallback(
    (ownerId: string | null) => {
      if (!ownerId) return '-'
      return usersById[ownerId] ?? ownerId
    },
    [usersById]
  )

  const rows = useMemo<DataTableRow[]>(() => {
    return leads.map((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
      const estado = normalizeStage(lead.estado_pipeline)
      const estadoLabel = t(`pipeline.columns.${estado}`)
      const whatsappAction = (
        <button
          type="button"
          className="whatsapp-button"
          aria-label={t('whatsapp.open')}
          onClick={(event) => {
            event.stopPropagation()
            const ownerName = getOwnerName(lead.owner_id)
            openWhatsapp({
              nombre: fullName,
              telefono: lead.telefono ?? '',
              email: lead.email ?? '',
              vendedor: ownerName === '-' ? '' : ownerName,
              leadId: lead.id,
            })
          }}
        >
          <IconWhatsapp className="whatsapp-icon" />
        </button>
      )
      return {
        id: lead.id,
        cells: [
          fullName,
          lead.telefono ?? '-',
          getFuenteLabel(lead.fuente),
          getOwnerName(lead.owner_id),
          estadoLabel,
          lead.next_action ?? '-',
          whatsappAction,
        ],
        detail: [],
      }
    })
  }, [getFuenteLabel, getOwnerName, leads, normalizeStage, session?.user?.user_metadata, t])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const handleOpenForm = () => {
    setFormValues({
      ...initialForm,
      owner_id: session?.user.id ?? '',
    })
    setFuenteOtro('')
    setFormError(null)
    setFormOpen(true)
  }

  const ownerName = session?.user.id ? (usersById[session.user.id] ?? session.user.id) : '-'

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
    const fuenteValue =
      formValues.fuente === 'otro'
        ? fuenteOtro.trim() || t('leads.sources.otro')
        : formValues.fuente
    const payload = {
      nombre: toNull(formValues.nombre),
      apellido: toNull(formValues.apellido),
      email: toNull(formValues.email),
      telefono: toNull(formValues.telefono),
      fuente: toNull(fuenteValue),
      programa_id: toNull(formValues.programa_id),
      embajador_id: toNull(formValues.embajador_id),
      owner_id: ownerId,
      vendedor_id: ownerId,
      estado_pipeline: formValues.estado_pipeline,
      next_action: toNull(formValues.next_action),
      next_action_date: formValues.next_action_date || null,
    }

    const { error: insertError } = await supabase.from('leads').insert(payload)

    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
      await loadLeads()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleChange = (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormValues((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleFuenteChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    setFormValues((prev) => ({ ...prev, fuente: value }))
    if (value !== 'otro') {
      setFuenteOtro('')
    }
  }

  const leadMap = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])

  const handleRowClick = (row: DataTableRow) => {
    const lead = leadMap.get(row.id)
    if (lead) {
      setSelectedLead(lead)
    }
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('leads.title')}
        subtitle={t('leads.subtitle')}
        action={<Button onClick={handleOpenForm}>{t('common.newLead')}</Button>}
      />
      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}
      <DataTable
        columns={[
          t('leads.columns.nombre'),
          t('leads.columns.telefono'),
          t('leads.columns.fuente'),
          t('leads.columns.owner'),
          t('leads.columns.estado'),
          t('leads.columns.nextAction'),
          t('whatsapp.column'),
        ]}
        rows={rows}
        emptyLabel={emptyLabel}
        onRowClick={handleRowClick}
      />
      <Modal
        open={formOpen}
        title={t('leads.form.title')}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="lead-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="lead-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('leads.fields.nombre')}</span>
            <input value={formValues.nombre} onChange={handleChange('nombre')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.apellido')}</span>
            <input value={formValues.apellido} onChange={handleChange('apellido')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.email')}</span>
            <input type="email" value={formValues.email} onChange={handleChange('email')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.telefono')}</span>
            <input value={formValues.telefono} onChange={handleChange('telefono')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.fuente')}</span>
            <select value={formValues.fuente} onChange={handleFuenteChange}>
              <option value="">{t('common.select')}</option>
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          {formValues.fuente === 'otro' && (
            <label className="form-field">
              <span>{t('leads.fields.fuenteOtro')}</span>
              <input value={fuenteOtro} onChange={(event) => setFuenteOtro(event.target.value)} />
            </label>
          )}
          <label className="form-field">
            <span>{t('leads.fields.programaId')}</span>
            <input value={formValues.programa_id} onChange={handleChange('programa_id')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.embajadorId')}</span>
            <input value={formValues.embajador_id} onChange={handleChange('embajador_id')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.ownerId')}</span>
            <input value={ownerName} readOnly />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.estadoPipeline')}</span>
            <select value={formValues.estado_pipeline} onChange={handleChange('estado_pipeline')}>
              <option value="nuevo">{t('pipeline.columns.nuevo')}</option>
              <option value="contactado">{t('pipeline.columns.contactado')}</option>
              <option value="cita">{t('pipeline.columns.cita')}</option>
              <option value="demo">{t('pipeline.columns.demo')}</option>
              <option value="cierre">{t('pipeline.columns.cierre')}</option>
              <option value="descartado">{t('pipeline.columns.descartado')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('leads.fields.nextAction')}</span>
            <input value={formValues.next_action} onChange={handleChange('next_action')} />
          </label>
          <label className="form-field">
            <span>{t('leads.fields.nextActionDate')}</span>
            <input type="date" value={formValues.next_action_date} onChange={handleChange('next_action_date')} />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <CalificacionPanel
        open={Boolean(selectedLead)}
        lead={selectedLead}
        ownerName={selectedLead ? getOwnerName(selectedLead.owner_id) : undefined}
        fuenteLabel={selectedLead ? getFuenteLabel(selectedLead.fuente) : undefined}
        onClose={() => setSelectedLead(null)}
        onSaved={loadLeads}
      />
      <ModalRenderer />
    </div>
  )
}
