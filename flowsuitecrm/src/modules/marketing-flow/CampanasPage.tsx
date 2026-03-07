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
import { estimateSegmentTargets, fetchSegmentTargets, getSegmentsByFuente, type CampaignSegmentParams, type Fuente } from './segments'
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
  mensaje_base: string | null
  segment_params: Record<string, unknown> | null
}

type AudienceType = 'leads' | 'clientes'

type LeadFuenteOption = {
  norm: string
  label: string
  values: string[]
}

type UserOption = {
  id: string
  label: string
  rol: string | null
}

type ProgramaOption = {
  id: string
  nombre: string
}

const initialForm = {
  nombre: '',
  descripcion: '',
  canal: 'whatsapp',
  audiencia: 'leads' as AudienceType,
  lead_source: 'all',
  segmento_key: 'nuevos',
  mensaje_base: '',
  template_key: '',
  owner_id: '',
  vendedor_id: '',
  programa_id: '',
  distribuidor_id: '',
}

const mapSegmentToEstadoPipeline = (segmentoKey: string) => {
  if (segmentoKey === 'nuevos') return 'nuevo'
  if (segmentoKey === 'contactado') return 'contactado'
  if (segmentoKey === 'cita') return 'cita'
  if (segmentoKey === 'descartados') return 'descartado'
  return null
}

const mapLeadFilterType = (segmentoKey: string) => {
  if (segmentoKey === 'nuevos' || segmentoKey === 'contactado' || segmentoKey === 'cita' || segmentoKey === 'descartados') return 'estado_pipeline'
  if (segmentoKey === 'vencidos') return 'next_action_date'
  if (segmentoKey === 'sin_contacto') return 'no_activity_recent'
  return null
}

const mapClienteFilterType = (segmentoKey: string) => {
  if (segmentoKey === 'clientes_activos') return 'activo'
  if (segmentoKey === 'clientes_accion_vencida') return 'next_action_date'
  if (segmentoKey === 'clientes_sin_contacto') return 'no_recent_contact'
  if (segmentoKey === 'cumpleanos_clientes') return 'birthday_month'
  return null
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
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [leadSourceOptions, setLeadSourceOptions] = useState<LeadFuenteOption[]>([])
  const [leadSourcesLoading, setLeadSourcesLoading] = useState(false)
  const [leadSourcesError, setLeadSourcesError] = useState<string | null>(null)
  const [responsableOptions, setResponsableOptions] = useState<UserOption[]>([])
  const [vendedorOptions, setVendedorOptions] = useState<UserOption[]>([])
  const [distribuidorOptions, setDistribuidorOptions] = useState<UserOption[]>([])
  const [programOptions, setProgramOptions] = useState<ProgramaOption[]>([])
  const [estimate, setEstimate] = useState<{ count: number; isEstimate: boolean } | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [mensajeBaseAvailable, setMensajeBaseAvailable] = useState(true)

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

  const loadLeadSources = useCallback(async () => {
    if (!configured) return
    setLeadSourcesLoading(true)
    setLeadSourcesError(null)
    const { data, error: fetchError } = await supabase
      .from('v_lead_fuentes')
      .select('fuente_raw, fuente_norm')
    if (fetchError) {
      setLeadSourceOptions([])
      const message = fetchError.message || 'No se pudo cargar fuentes.'
      if (message.toLowerCase().includes('v_lead_fuentes') || message.toLowerCase().includes('relation')) {
        setLeadSourcesError('Falta migración: v_lead_fuentes')
      } else {
        setLeadSourcesError(message)
      }
      setLeadSourcesLoading(false)
      return
    }

    const rows = (data as { fuente_raw: string | null; fuente_norm: string | null }[] | null) ?? []
    const map = new Map<string, { values: string[] }>()
    rows.forEach((row) => {
      const raw = (row.fuente_raw ?? '').trim()
      const norm = (row.fuente_norm ?? '').trim()
      if (!raw || !norm) return
      if (!map.has(norm)) map.set(norm, { values: [] })
      map.get(norm)!.values.push(raw)
    })

    const options: LeadFuenteOption[] = Array.from(map.entries()).map(([norm, entry]) => {
      const values = Array.from(new Set(entry.values))
      const preferred = values.find((value) => /[A-Z]/.test(value) && /[a-z]/.test(value))
      return {
        norm,
        label: preferred ?? values[0] ?? norm,
        values,
      }
    })

    options.sort((a, b) => a.label.localeCompare(b.label, 'es'))
    setLeadSourceOptions(options)
    setLeadSourcesLoading(false)
  }, [configured])

  const loadUserOptions = useCallback(async () => {
    if (!configured) return
    const { data, error: fetchError } = await supabase
      .from('usuarios')
      .select('id, nombre, apellido, email, rol')
    if (fetchError) {
      setResponsableOptions([])
      setVendedorOptions([])
      setDistribuidorOptions([])
      return
    }
    const rows = ((data as { id: string; nombre: string | null; apellido: string | null; email: string | null; rol: string | null }[] | null) ?? [])
    const buildLabel = (user: { nombre: string | null; apellido: string | null; email: string | null; rol: string | null; id: string }) => {
      const name = [user.nombre, user.apellido].filter(Boolean).join(' ').trim() || user.email || user.id
      const rol = user.rol ?? 'sin_rol'
      const email = user.email ?? 'sin_email'
      return `${name} · ${rol} · ${email}`
    }
    const options = rows.map((user) => ({
      id: user.id,
      label: buildLabel(user),
      rol: user.rol,
    }))

    const responsableRoles = new Set(['admin', 'supervisor_telemercadeo', 'telemercadeo', 'distribuidor', 'vendedor'])
    const vendedorRoles = new Set(['vendedor', 'distribuidor'])
    const distribuidorRoles = new Set(['distribuidor'])

    const byLabel = (a: UserOption, b: UserOption) => a.label.localeCompare(b.label, 'es')
    setResponsableOptions(options.filter((opt) => opt.rol && responsableRoles.has(opt.rol)).sort(byLabel))
    setVendedorOptions(options.filter((opt) => opt.rol && vendedorRoles.has(opt.rol)).sort(byLabel))
    setDistribuidorOptions(options.filter((opt) => opt.rol && distribuidorRoles.has(opt.rol)).sort(byLabel))
  }, [configured])

  const loadProgramOptions = useCallback(async () => {
    if (!configured) return
    const { data, error: fetchError } = await supabase
      .from('programas')
      .select('id, nombre')
      .order('nombre', { ascending: true })
    if (fetchError) {
      setProgramOptions([])
      return
    }
    const options = ((data as { id: string; nombre: string | null }[] | null) ?? [])
      .filter((row) => Boolean(row.nombre))
      .map((row) => ({ id: row.id, nombre: row.nombre ?? row.id }))
    setProgramOptions(options)
  }, [configured])

  const loadCampaigns = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('mk_campaigns')
      .select('id, nombre, canal, segmento_key, estado, created_at, owner_id, template_key, descripcion, mensaje_base, segment_params')
      .order('created_at', { ascending: false })
      .limit(200)
    if (fetchError) {
      const message = fetchError.message || 'Error al cargar campañas.'
      if (message.toLowerCase().includes('mensaje_base')) {
        setMensajeBaseAvailable(false)
        const { data: fallback, error: fallbackError } = await supabase
          .from('mk_campaigns')
          .select('id, nombre, canal, segmento_key, estado, created_at, owner_id, template_key, descripcion, segment_params')
          .order('created_at', { ascending: false })
          .limit(200)
        if (fallbackError) {
          setError('Falta migración: mk_campaigns.mensaje_base')
          setCampaigns([])
        } else {
          setError('Falta migración: mk_campaigns.mensaje_base')
          setCampaigns((fallback as CampaignRecord[] | null) ?? [])
        }
      } else {
        setError(message)
        setCampaigns([])
      }
    } else {
      setMensajeBaseAvailable(true)
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
      audiencia: prev.audiencia,
      lead_source: 'all',
      segmento_key: getSegmentsByFuente(prev.audiencia)[0]?.key ?? initialForm.segmento_key,
    }))
    setFormError(null)
    setEstimate(null)
    setEstimateError(null)
    setAdvancedOpen(false)
    setFormOpen(true)
  }

  const segmentsForFuente = useMemo(
    () => getSegmentsByFuente(formValues.audiencia),
    [formValues.audiencia]
  )

  useEffect(() => {
    if (!formOpen) return
    void loadUserOptions()
    void loadProgramOptions()
    if (formValues.audiencia === 'leads') {
      void loadLeadSources()
    }
  }, [formOpen, formValues.audiencia, loadLeadSources, loadProgramOptions, loadUserOptions])

  useEffect(() => {
    if (!formOpen) return
    if (leadSourcesError && formValues.lead_source !== 'all') {
      setFormValues((prev) => ({ ...prev, lead_source: 'all' }))
    }
  }, [formOpen, leadSourcesError, formValues.lead_source])

  const scope = useMemo<LeadScope>(() => ({
    role,
    viewMode,
    hasDistribuidorScope,
    distributionUserIds,
    userId: session?.user.id ?? null,
  }), [distributionUserIds, hasDistribuidorScope, role, session?.user.id, viewMode])

  const getLeadSourceLabel = useCallback((norm: string) => {
    if (norm === 'all') return 'Todas las fuentes'
    const match = leadSourceOptions.find((option) => option.norm === norm)
    return match?.label ?? norm
  }, [leadSourceOptions])

  const buildSegmentParams = useCallback((): CampaignSegmentParams => {
    const isLead = formValues.audiencia === 'leads'
    const fuenteLabel = isLead ? (formValues.lead_source === 'all' ? 'all' : getLeadSourceLabel(formValues.lead_source)) : undefined
    return {
      contacto_tipo: isLead ? 'lead' : 'cliente',
      fuente: fuenteLabel,
      segmento_key: formValues.segmento_key,
      estado_pipeline: isLead ? mapSegmentToEstadoPipeline(formValues.segmento_key) : null,
      filter_type: isLead ? mapLeadFilterType(formValues.segmento_key) : mapClienteFilterType(formValues.segmento_key),
      programa_id: isLead ? (formValues.programa_id || null) : null,
      owner_id: isLead ? (formValues.owner_id || null) : null,
      vendedor_id: formValues.vendedor_id || null,
      distribuidor_id: !isLead ? (formValues.distribuidor_id || null) : null,
      month: formValues.segmento_key === 'cumpleanos_clientes' ? new Date().getUTCMonth() + 1 : undefined,
    }
  }, [formValues, getLeadSourceLabel])

  const audienceReady = Boolean(formValues.segmento_key)
  const messageEnabled = audienceReady

  useEffect(() => {
    if (!formOpen || !audienceReady) {
      setEstimate(null)
      setEstimateError(null)
      return
    }
    if (formValues.audiencia === 'leads' && formValues.lead_source !== 'all' && leadSourceOptions.length === 0) {
      setEstimate(null)
      return
    }
    let active = true
    setEstimateLoading(true)
    setEstimateError(null)
    const timer = setTimeout(async () => {
      try {
        const segmentParams = buildSegmentParams()
        const result = await estimateSegmentTargets({
          fuente: formValues.audiencia,
          segmentKey: formValues.segmento_key,
          scope,
          segmentParams,
        })
        if (!active) return
        if ('error' in result && result.error) {
          console.error('Estimate error', {
            error: result.error,
            audience: formValues.audiencia,
            segmentKey: formValues.segmento_key,
            leadSource: formValues.lead_source,
            ownerId: formValues.owner_id,
            vendedorId: formValues.vendedor_id,
            programaId: formValues.programa_id,
          })
          setEstimate(null)
          setEstimateError('No se pudo calcular el estimado.')
        } else {
          setEstimate(result)
        }
      } catch (err) {
        if (!active) return
        setEstimate(null)
        setEstimateError('No se pudo calcular el estimado.')
        console.error('Estimate unexpected error', err)
      } finally {
        if (active) setEstimateLoading(false)
      }
    }, 350)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [audienceReady, buildSegmentParams, formOpen, formValues.audiencia, formValues.lead_source, formValues.segmento_key, leadSourceOptions.length, scope])

  const materializeCampaignTargets = useCallback(async (campaign: CampaignRecord, fuente: Fuente, segmentKey: string) => {
    const targets = await fetchSegmentTargets({
      fuente,
      segmentKey,
      scope,
      segmentParams: (campaign.segment_params as CampaignSegmentParams | null) ?? undefined,
    })
    const validTargets = targets.filter((target) => Boolean(target.telefono))
    if (validTargets.length === 0) return
    const messages = validTargets.map((target, index) => ({
      campaign_id: campaign.id,
      owner_id: campaign.owner_id ?? session?.user.id ?? null,
      contacto_tipo: fuente === 'leads' ? 'lead' : 'cliente',
      contacto_id: target.id,
      telefono: target.telefono ?? null,
      nombre: target.nombre ?? null,
      mensaje_texto: campaign.mensaje_base ?? null,
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError('Configura Supabase para guardar cambios.')
      return
    }
    if (!mensajeBaseAvailable) {
      setFormError('Falta migración: mk_campaigns.mensaje_base. Aplica la migración antes de crear campañas.')
      return
    }
    if (!formValues.nombre.trim()) {
      setFormError('Nombre de campaña requerido.')
      return
    }
    if (!segmentsForFuente.some((segment) => segment.key === formValues.segmento_key)) {
      setFormError('Estado o grupo inválido.')
      return
    }
    if (!formValues.mensaje_base.trim()) {
      setFormError('Texto del mensaje requerido.')
      return
    }
    if (!estimate || estimateLoading) {
      setFormError('El estimado aún se está calculando. Espera un momento antes de crear la campaña.')
      return
    }
    if (estimate.count === 0) {
      setFormError('El estimado es 0. Ajusta filtros antes de crear.')
      return
    }
    setFormError(null)
    setConfirmOpen(true)
  }

  const handleConfirmCreate = async () => {
    if (!configured) return
    if (!mensajeBaseAvailable) {
      setFormError('Falta migración: mk_campaigns.mensaje_base. Aplica la migración antes de crear campañas.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    const segmentParams = buildSegmentParams()
    const payload = {
      nombre: formValues.nombre.trim(),
      canal: formValues.canal,
      segmento_key: formValues.segmento_key,
      segment_params: segmentParams,
      template_key: formValues.template_key.trim() || null,
      descripcion: formValues.descripcion.trim() || null,
      mensaje_base: formValues.mensaje_base.trim(),
      estado: 'borrador',
      owner_id: session?.user.id ?? null,
    }
    const { data, error: insertError } = await supabase
      .from('mk_campaigns')
      .insert(payload)
      .select('id, canal, owner_id, mensaje_base, segment_params')
      .maybeSingle()
    if (insertError || !data) {
      const message = insertError?.message ?? 'No se pudo crear la campaña.'
      setFormError(message)
      showToast(message, 'error')
      setSubmitting(false)
      return
    }
    await materializeCampaignTargets(
      data as CampaignRecord,
      formValues.audiencia,
      formValues.segmento_key,
    )
    setConfirmOpen(false)
    setFormOpen(false)
    await loadCampaigns()
    showToast('Campaña creada')
    navigate(`/marketing-flow/envios?campana=${data.id}`)
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
      showToast('Campaña actualizada')
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
  const isLeadAudience = formValues.audiencia === 'leads'
  const selectedSegment = segmentsForFuente.find((segment) => segment.key === formValues.segmento_key)
  const leadSourceLabel = formValues.lead_source === 'all' ? 'Todas las fuentes' : getLeadSourceLabel(formValues.lead_source)
  const estimateText = estimate
    ? `${estimate.isEstimate ? 'Estimado aprox.: ' : 'Estimado: '}${estimate.count} contactos con teléfono`
    : 'Estimado: -'
  const showEstimateWarning = Boolean(estimate && estimate.count > 300)

  return (
    <div className="page-stack">
      <SectionHeader
        title="Campañas"
        subtitle="Crea, organiza y activa campañas de contacto"
        action={<Button onClick={handleOpenForm}>Nueva campaña</Button>}
      />

      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #6b7280)' }}>
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

      {loading && <div className="card" style={{ padding: '1rem' }}>Cargando campañas...</div>}
      {!loading && !hasResults && (
        <EmptyState
          title="Sin campañas"
          description="Crea tu primera campaña para comenzar los envíos."
        />
      )}
      {hasResults && (
        <DataTable
          columns={['Nombre', 'Canal', 'Segmento', 'Plantilla', 'Estado', 'Creada', 'Acciones']}
          rows={rows}
        />
      )}

      <Modal
        open={formOpen}
        title="Nueva campaña"
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
          <div className="card" style={{ padding: '14px', display: 'grid', gap: '12px' }}>
            <h4 style={{ margin: 0 }}>Identidad</h4>
            <label className="form-field">
              <span>Nombre de campaña</span>
              <input
                value={formValues.nombre}
                onChange={(e) => setFormValues((prev) => ({ ...prev, nombre: e.target.value }))}
                placeholder="Ej. Prospectos BA Insurance"
              />
            </label>
            <label className="form-field">
              <span>Descripción interna</span>
              <textarea
                rows={2}
                value={formValues.descripcion}
                onChange={(e) => setFormValues((prev) => ({ ...prev, descripcion: e.target.value }))}
                placeholder="Notas internas de la campaña"
              />
            </label>
          </div>

          <div className="card" style={{ padding: '14px', display: 'grid', gap: '12px' }}>
            <h4 style={{ margin: 0 }}>Audiencia</h4>
            <label className="form-field">
              <span>Audiencia</span>
              <select
                value={formValues.audiencia}
                onChange={(e) => {
                  const nextAudience = e.target.value as AudienceType
                  setFormValues((prev) => ({
                    ...prev,
                    audiencia: nextAudience,
                    lead_source: nextAudience === 'leads' ? prev.lead_source : 'all',
                    segmento_key: getSegmentsByFuente(nextAudience)[0]?.key ?? '',
                    owner_id: '',
                    vendedor_id: '',
                    programa_id: '',
                    distribuidor_id: '',
                  }))
                  setEstimate(null)
                }}
              >
                <option value="leads">Prospectos</option>
                <option value="clientes">Clientes</option>
              </select>
            </label>
            {isLeadAudience && (
              <label className="form-field">
                <span>Fuente del prospecto</span>
                <select
                  value={formValues.lead_source}
                  onChange={(e) => setFormValues((prev) => ({ ...prev, lead_source: e.target.value }))}
                >
                  <option value="all">Todas las fuentes</option>
                  {leadSourceOptions.map((option) => (
                    <option key={option.norm} value={option.norm}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {leadSourcesLoading && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Cargando fuentes...</div>}
                {leadSourcesError && <div className="form-error">{leadSourcesError}</div>}
              </label>
            )}
            <label className="form-field">
              <span>{isLeadAudience ? 'Estado del prospecto' : 'Grupo de clientes'}</span>
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
              {selectedSegment?.hint && (
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{selectedSegment.hint}</div>
              )}
            </label>
            <div className="card" style={{ padding: '10px 12px', background: 'var(--color-input)' }}>
              <strong>{estimateLoading ? 'Calculando estimado...' : estimateText}</strong>
              {estimateError && <div className="form-error">{estimateError}</div>}
              {showEstimateWarning && (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  Este segmento supera 300 contactos. Revisa antes de confirmar.
                </div>
              )}
              {estimate && estimate.count === 0 && (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  No hay contactos válidos con teléfono para esta audiencia.
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setAdvancedOpen((prev) => !prev)}
            >
              {advancedOpen ? 'Ocultar filtros avanzados' : 'Mostrar filtros avanzados'}
            </Button>
            {advancedOpen && isLeadAudience && (
              <div className="form-grid" style={{ marginTop: 4 }}>
                <label className="form-field">
                  <span>Responsable</span>
                  <select
                    value={formValues.owner_id}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, owner_id: e.target.value }))}
                  >
                    <option value="">Todos</option>
                    {responsableOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Vendedor</span>
                  <select
                    value={formValues.vendedor_id}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, vendedor_id: e.target.value }))}
                  >
                    <option value="">Todos</option>
                    {vendedorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Programa</span>
                  <select
                    value={formValues.programa_id}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, programa_id: e.target.value }))}
                  >
                    <option value="">Todos</option>
                    {programOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {advancedOpen && !isLeadAudience && (
              <div className="form-grid" style={{ marginTop: 4 }}>
                <label className="form-field">
                  <span>Vendedor</span>
                  <select
                    value={formValues.vendedor_id}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, vendedor_id: e.target.value }))}
                  >
                    <option value="">Todos</option>
                    {vendedorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Distribuidor</span>
                  <select
                    value={formValues.distribuidor_id}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, distribuidor_id: e.target.value }))}
                  >
                    <option value="">Todos</option>
                    {distribuidorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '14px', display: 'grid', gap: '12px' }}>
            <h4 style={{ margin: 0 }}>Canal y mensaje</h4>
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
              <span>Texto del mensaje</span>
              <textarea
                rows={3}
                value={formValues.mensaje_base}
                onChange={(e) => setFormValues((prev) => ({ ...prev, mensaje_base: e.target.value }))}
                placeholder={messageEnabled ? 'Escribe el mensaje que se enviará' : 'Define la audiencia para habilitar el mensaje'}
                disabled={!messageEnabled}
              />
              {!messageEnabled && (
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  Define la audiencia para editar el mensaje.
                </div>
              )}
            </label>
            <label className="form-field">
              <span>Plantilla (opcional / avanzado)</span>
              <input
                value={formValues.template_key}
                onChange={(e) => setFormValues((prev) => ({ ...prev, template_key: e.target.value }))}
                placeholder="template_key"
                disabled={!messageEnabled}
              />
            </label>
          </div>
          {!mensajeBaseAvailable && (
            <div className="form-error">Falta migración: mk_campaigns.mensaje_base. Aplica la migración antes de crear campañas.</div>
          )}
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <Modal
        open={confirmOpen}
        title="Confirmar campaña"
        onClose={() => setConfirmOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirmCreate} disabled={submitting}>
              {submitting ? 'Creando...' : 'Confirmar y crear'}
            </Button>
          </>
        }
      >
        <div className="form-grid" style={{ gap: '0.65rem' }}>
          <div><strong>Crear campaña para {estimate?.count ?? 0} {isLeadAudience ? 'prospectos' : 'clientes'}</strong></div>
          <div>Canal: {formValues.canal}</div>
          <div>Audiencia: {isLeadAudience ? 'Prospectos' : 'Clientes'}</div>
          {isLeadAudience && <div>Fuente del prospecto: {leadSourceLabel}</div>}
          <div>{isLeadAudience ? 'Estado del prospecto' : 'Grupo de clientes'}: {selectedSegment?.label ?? '-'}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Los mensajes quedarán en estado Pendiente.</div>
        </div>
      </Modal>
    </div>
  )
}
