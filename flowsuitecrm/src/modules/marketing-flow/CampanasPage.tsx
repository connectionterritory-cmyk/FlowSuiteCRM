import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { fetchSegmentTargets, getSegmentsByFuente, type Fuente } from './segments'
import type { LeadScope } from './leadSegments'

type CampaignRecord = {
  id: string
  nombre: string | null
  canal: string | null
  segmento_key: string | null
  estado: string | null
  created_at: string | null
  owner_id: string | null
  template_key: string | null
  descripcion: string | null
  segment_params?: Record<string, unknown> | null
}

const initialForm = {
  nombre: '',
  canal: 'whatsapp',
  fuente: 'leads' as Fuente,
  segmento_key: 'nuevos',
  month: 'current' as 'current' | string,
  template_key: '',
  descripcion: '',
}

export function CampanasPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const { viewMode, hasDistribuidorScope, distributionUserIds } = useViewMode()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [estadoFilter, setEstadoFilter] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadRole = useCallback(async () => {
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    const { data } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .maybeSingle()
    setRole((data as { rol?: string } | null)?.rol ?? null)
  }, [configured, session?.user.id])

  const loadCampaigns = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('mk_campaigns')
      .select('id, nombre, canal, segmento_key, estado, created_at, owner_id, template_key, descripcion, segment_params')
      .order('created_at', { ascending: false })
      .limit(200)
    if (fetchError) {
      setError(fetchError.message)
      setCampaigns([])
    } else {
      setCampaigns((data as CampaignRecord[] | null) ?? [])
    }
    setLoading(false)
  }, [configured])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    if (configured) loadRole()
  }, [configured, loadRole])

  const handleOpenForm = () => {
    setFormValues((prev) => ({
      ...initialForm,
      fuente: prev.fuente,
      segmento_key: getSegmentsByFuente(prev.fuente)[0]?.key ?? initialForm.segmento_key,
    }))
    setFormError(null)
    setFormOpen(true)
  }

  const segmentsForFuente = useMemo(
    () => getSegmentsByFuente(formValues.fuente),
    [formValues.fuente]
  )

  const monthOptions = useMemo(() => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ]
    const currentLabel = `Este mes (${months[new Date().getMonth()]})`
    return [
      { value: 'current', label: currentLabel },
      ...months.map((label, index) => ({ value: String(index + 1), label })),
    ]
  }, [])

  const scope = useMemo<LeadScope>(() => ({
    role,
    viewMode,
    hasDistribuidorScope,
    distributionUserIds,
    userId: session?.user.id ?? null,
  }), [distributionUserIds, hasDistribuidorScope, role, session?.user.id, viewMode])

  const materializeCampaignTargets = useCallback(async (campaign: CampaignRecord, fuente: Fuente, segmentKey: string, segmentParams?: { month?: number }) => {
    const targets = await fetchSegmentTargets({ fuente, segmentKey, scope, segmentParams })
    const validTargets = targets.filter((target) => Boolean(target.telefono))
    if (validTargets.length === 0) return
    const messages = validTargets.map((target, index) => ({
      campaign_id: campaign.id,
      owner_id: campaign.owner_id ?? session?.user.id ?? null,
      contacto_tipo: fuente === 'leads' ? 'lead' : 'cliente',
      contacto_id: target.id,
      telefono: target.telefono ?? null,
      nombre: target.nombre ?? null,
      mensaje_texto: campaign.descripcion ?? null,
      canal: campaign.canal ?? 'whatsapp',
      orden: index + 1,
      status: 'pendiente',
    }))
    const { error: insertError } = await supabase
      .from('mk_messages')
      .upsert(messages, { onConflict: 'campaign_id,telefono', ignoreDuplicates: true })
    if (insertError) {
      showToast(insertError.message, 'error')
    }
  }, [scope, session?.user.id, showToast])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError('Configura Supabase para guardar cambios.')
      return
    }
    if (!formValues.nombre.trim()) {
      setFormError('Nombre requerido.')
      return
    }
    if (!segmentsForFuente.some((segment) => segment.key === formValues.segmento_key)) {
      setFormError('Segmento invalido.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    const monthParam = formValues.segmento_key === 'cumpleanos_clientes'
      ? (formValues.month === 'current'
          ? new Date().getUTCMonth() + 1
          : Number(formValues.month))
      : null
    const payload = {
      nombre: formValues.nombre.trim(),
      canal: formValues.canal,
      segmento_key: formValues.segmento_key,
      template_key: formValues.template_key.trim() || null,
      descripcion: formValues.descripcion.trim() || null,
      segment_params: monthParam ? { month: monthParam } : {},
      estado: 'borrador',
      owner_id: session?.user.id ?? null,
    }
    const { data, error: insertError } = await supabase
      .from('mk_campaigns')
      .insert(payload)
      .select('id, canal, owner_id, descripcion')
      .maybeSingle()
    if (insertError || !data) {
      const message = insertError?.message ?? 'No se pudo crear la campana.'
      setFormError(message)
      showToast(message, 'error')
    } else {
      await materializeCampaignTargets(
        data as CampaignRecord,
        formValues.fuente,
        formValues.segmento_key,
        monthParam ? { month: monthParam } : undefined
      )
      setFormOpen(false)
      await loadCampaigns()
      showToast('Campana creada')
      navigate(`/marketing-flow/envios?campana=${data.id}`)
    }
    setSubmitting(false)
  }

  const updateCampaignState = useCallback(
    async (campaignId: string, nextEstado: string) => {
      if (!configured) return
      const { error: updateError } = await supabase
        .from('mk_campaigns')
        .update({ estado: nextEstado })
        .eq('id', campaignId)
      if (updateError) {
        showToast(updateError.message, 'error')
        return
      }
      await loadCampaigns()
      showToast('Campana actualizada')
    },
    [configured, loadCampaigns, showToast]
  )

  const rows = useMemo<DataTableRow[]>(() => {
    const filtered = estadoFilter === 'all'
      ? campaigns
      : campaigns.filter((row) => (row.estado ?? 'borrador') === estadoFilter)
    return filtered.map((row) => ({
      id: row.id,
      cells: [
        row.nombre ?? '-',
        row.canal ?? '-',
        row.segmento_key ?? '-',
        row.template_key ?? '-',
        <Badge key={`${row.id}-estado`} label={row.estado ?? 'borrador'} />,
        row.created_at ? new Date(row.created_at).toLocaleDateString('es') : '-',
        <div key={`${row.id}-actions`} style={{ display: 'flex', gap: '0.35rem' }}>
          {row.estado !== 'activa' && (
            <Button variant="ghost" onClick={() => updateCampaignState(row.id, 'activa')}>
              Activar
            </Button>
          )}
          {row.estado === 'activa' && (
            <Button variant="ghost" onClick={() => updateCampaignState(row.id, 'pausada')}>
              Pausar
            </Button>
          )}
          {row.estado !== 'completada' && (
            <Button variant="ghost" onClick={() => updateCampaignState(row.id, 'completada')}>
              Completar
            </Button>
          )}
        </div>,
      ],
    }))
  }, [campaigns, estadoFilter, updateCampaignState])

  const hasResults = rows.length > 0

  return (
    <div className="page-stack">
      <SectionHeader
        title="Campanas"
        subtitle="Crear y gestionar campanas"
        action={<Button onClick={handleOpenForm}>Nueva campana</Button>}
      />

      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
          Estado
        </label>
        <select
          value={estadoFilter}
          onChange={(event) => setEstadoFilter(event.target.value)}
          style={{
            height: '36px',
            padding: '0 0.6rem',
            borderRadius: '0.4rem',
            border: '1px solid var(--color-border, #e5e7eb)',
            background: 'var(--color-input)',
            color: 'var(--color-text)',
            fontSize: '0.85rem',
          }}
        >
          <option value="all">Todos</option>
          <option value="borrador">Borrador</option>
          <option value="activa">Activa</option>
          <option value="pausada">Pausada</option>
          <option value="completada">Completada</option>
        </select>
      </div>

      {loading && <div className="card" style={{ padding: '1rem' }}>Cargando campanas...</div>}
      {!loading && !hasResults && (
        <EmptyState
          title="Sin campanas"
          description="Crea tu primera campana para comenzar los envios."
        />
      )}
      {hasResults && (
        <DataTable
        columns={['Nombre', 'Canal', 'Segmento', 'Template', 'Estado', 'Creada', 'Acciones']}
        rows={rows}
      />
      )}

      <Modal
        open={formOpen}
        title="Nueva campana"
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="mk-campaign-form" disabled={submitting}>
              {submitting ? 'Guardando...' : 'Guardar'}
            </Button>
          </>
        }
      >
        <form id="mk-campaign-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Nombre</span>
            <input
              value={formValues.nombre}
              onChange={(e) => setFormValues((prev) => ({ ...prev, nombre: e.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Canal</span>
            <select
              value={formValues.canal}
              onChange={(e) => setFormValues((prev) => ({ ...prev, canal: e.target.value }))}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label className="form-field">
            <span>Template key</span>
            <input
              value={formValues.template_key}
              onChange={(e) => setFormValues((prev) => ({ ...prev, template_key: e.target.value }))}
              placeholder="template_key"
            />
          </label>
          <label className="form-field">
            <span>Descripcion</span>
            <textarea
              rows={3}
              value={formValues.descripcion}
              onChange={(e) => setFormValues((prev) => ({ ...prev, descripcion: e.target.value }))}
              placeholder="Notas de la campana"
            />
          </label>
          <label className="form-field">
            <span>Fuente</span>
            <select
              value={formValues.fuente}
              onChange={(e) => setFormValues((prev) => ({ ...prev, fuente: e.target.value as Fuente, segmento_key: getSegmentsByFuente(e.target.value as Fuente)[0]?.key ?? '' }))}
            >
              <option value="leads">Prospectos</option>
              <option value="clientes">Clientes</option>
            </select>
          </label>
          <label className="form-field">
            <span>Segmento</span>
            <select
              value={formValues.segmento_key}
              onChange={(e) => setFormValues((prev) => ({ ...prev, segmento_key: e.target.value }))}
            >
              {segmentsForFuente.map((segment) => (
                <option key={segment.key} value={segment.key}>
                  {segment.label}
                </option>
              ))}
            </select>
          </label>
          {formValues.segmento_key === 'cumpleanos_clientes' && (
            <label className="form-field">
              <span>Mes</span>
              <select
                value={formValues.month}
                onChange={(e) => setFormValues((prev) => ({ ...prev, month: e.target.value }))}
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
    </div>
  )
}
