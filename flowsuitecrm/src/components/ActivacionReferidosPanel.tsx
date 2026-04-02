import { startTransition, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { Button } from './Button'
import { CalificacionPanel } from './CalificacionPanel'
import { useMessaging } from '../hooks/useMessaging'
import { useToast } from './useToast'
import {
  MIN_REFERIDOS_CI,
  CI_REFERIDO_ESTADOS,
  CI_RELACIONES,
  formatPhone,
  stripPhone,
  type CiReferidoEstado,
} from '../lib/conexiones/validaciones'
import { formatProperName } from '../lib/textFormat'
import type { CiActivacion, CiReferido } from '../hooks/useConexiones'
import { CitaModal, type CitaForm } from '../modules/citas/CitaModal'
import { buildReferidoEmbudo, getReferidoStageLabel } from '../lib/referidos/transiciones'
import { useModalHost } from '../modals/useModalHost'

type Props = {
  open: boolean
  activation: CiActivacion | null
  ownerLabel: string
  currentUserId: string | null
  currentRole: string | null
  canEditOwner: boolean
  isClosed: boolean
  onClose: () => void
  onEditOwner: () => void
  onReactivate: () => void
  onRefresh?: () => void
}

type LeadForm = { saving: boolean; error: string | null }
type CiReferidoRow = CiReferido & { notas?: string | null }
type LeadSummary = { id: string; nombre: string | null; apellido: string | null; telefono: string | null }

type NewRefForm = {
  nombre: string
  telefono: string
  relacion: string
  saving: boolean
  error: string | null
}

type CalificacionLead = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  email?: string | null
  direccion?: string | null
  apartamento?: string | null
  ciudad?: string | null
  estado_region?: string | null
  codigo_postal?: string | null
  fecha_nacimiento?: string | null
  fuente?: string | null
  owner_id?: string | null
  estado_civil?: string | null
  nombre_conyuge?: string | null
  telefono_conyuge?: string | null
  situacion_laboral?: string | null
  ninos_en_casa?: boolean | null
  cantidad_ninos?: number | null
  tiene_productos_rp?: boolean | null
  tipo_vivienda?: string | null
  deleted_at?: string | null
  deleted_reason?: string | null
}

type OwnerInfo = {
  ciudad: string | null
  estado_region: string | null
  situacion_laboral?: string | null
  estado_civil?: string | null
  tipo_vivienda?: string | null
  tiene_productos_rp?: boolean | null
  // clientes only
  nivel?: number | null
  estado_morosidad?: string | null
}

const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  pendiente:          { bg: 'rgba(148,163,184,0.15)', color: '#64748b' },
  contactado:         { bg: 'rgba(59,130,246,0.15)',  color: '#1d4ed8' },
  cita_agendada:      { bg: 'rgba(245,158,11,0.15)',  color: '#b45309' },
  presentacion_hecha: { bg: 'rgba(249,115,22,0.15)',  color: '#c2410c' },
  regalo_entregado:   { bg: 'rgba(16,185,129,0.15)',  color: '#047857' },
  telemercadeo:       { bg: 'rgba(139,92,246,0.15)',  color: '#5b21b6' },
}

const EMPTY_NEW_REF: NewRefForm = {
  nombre: '',
  telefono: '',
  relacion: 'familiar',
  saving: false,
  error: null,
}

const resetLeadForms = (): Record<string, LeadForm> => ({})
const resetDrafts = (): Record<string, string> => ({})
const resetSavingMap = (): Record<string, boolean> => ({})

const splitNombreApellido = (value?: string | null) => {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { nombre: '', apellido: '' }
  const [nombre, ...apellidoParts] = parts
  return { nombre, apellido: apellidoParts.join(' ') }
}

const REFERIDO_PRIORIDAD: Record<string, number> = {
  pendiente: 0,
  contactado: 1,
  cita_agendada: 2,
  presentacion_hecha: 3,
  telemercadeo: 4,
  regalo_entregado: 5,
}

// ── Star Rating ───────────────────────────────────────────────
function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null
  onChange: (n: number) => void
  disabled?: boolean
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const display = hovered ?? value ?? 0
  return (
    <div className="arp-stars" onMouseLeave={() => setHovered(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`arp-star ${n <= display ? 'filled' : ''}`}
          onMouseEnter={() => setHovered(n)}
          onClick={() => onChange(n === value ? 0 : n)}
          disabled={disabled}
          aria-label={`${n} estrella${n !== 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export function ActivacionReferidosPanel({
  open,
  activation,
  ownerLabel,
  currentUserId,
  currentRole,
  canEditOwner,
  isClosed,
  onClose,
  onEditOwner,
  onReactivate,
  onRefresh,
}: Props) {
  const { t } = useTranslation()
  const { openWhatsapp, openSms, ModalRenderer } = useMessaging()
  const { openGestionModal } = useModalHost()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured

  const [referidos, setReferidos] = useState<CiReferidoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estadoFilter, setEstadoFilter] = useState<CiReferidoEstado | 'todos'>('todos')
  const [leadForms, setLeadForms] = useState<Record<string, LeadForm>>({})
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null)
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null)
  const [notasDrafts, setNotasDrafts] = useState<Record<string, string>>({})
  const [notasSaving, setNotasSaving] = useState<Record<string, boolean>>({})
  // Add referido form
  const [newRefOpen, setNewRefOpen] = useState(false)
  const [newRef, setNewRef] = useState<NewRefForm>(EMPTY_NEW_REF)
  // Calificacion
  const [calificacionLead, setCalificacionLead] = useState<CalificacionLead | null>(null)
  const [focusAddress, setFocusAddress] = useState(false)
  const [leadGeoMap, setLeadGeoMap] = useState<Record<string, { ciudad: string | null; codigo_postal: string | null }>>({})
  const [citaOpen, setCitaOpen] = useState(false)
  const [citaInitial, setCitaInitial] = useState<Partial<CitaForm>>({})
  const [citaReferidoId, setCitaReferidoId] = useState<string | null>(null)

  const canAddReferido = Boolean(
    activation &&
      currentUserId &&
      (
        activation.owner_id === currentUserId ||
        activation.vendedor_id === currentUserId ||
        currentRole === 'admin' ||
        currentRole === 'distribuidor'
      )
  )
  // Owner info
  const [ownerInfo, setOwnerInfo] = useState<OwnerInfo | null>(null)
  const [ownerInfoOpen, setOwnerInfoOpen] = useState(false)

  const loadReferidos = useCallback(async () => {
    if (!configured || !activation) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('ci_referidos')
      .select(
        'id, activacion_id, nombre, telefono, relacion, estado, lead_id, notas, calificacion, modo_gestion, asignado_a, gestionado_por_usuario_id, tomado_por_vendedor_at, liberado_a_telemercadeo_at, cita_id',
      )
      .eq('activacion_id', activation.id)
      .order('created_at', { ascending: true })
    if (fetchError) {
      setError(fetchError.message)
      setReferidos([])
    } else {
      const rows = (data as CiReferidoRow[]) ?? []
      setReferidos(rows)
      const drafts: Record<string, string> = {}
      for (const r of rows) drafts[r.id] = r.notas ?? ''
      setNotasDrafts(drafts)

      const leadIds = rows.filter((r) => r.lead_id).map((r) => r.lead_id as string)
      if (leadIds.length > 0) {
        const { data: geoData } = await supabase
          .from('leads')
          .select('id, ciudad, codigo_postal')
          .in('id', leadIds)
        if (geoData) {
          const geoMap: Record<string, { ciudad: string | null; codigo_postal: string | null }> = {}
          for (const row of geoData as { id: string; ciudad: string | null; codigo_postal: string | null }[]) {
            geoMap[row.id] = { ciudad: row.ciudad, codigo_postal: row.codigo_postal }
          }
          setLeadGeoMap(geoMap)
        }
      } else {
        setLeadGeoMap({})
      }
    }
    setLoading(false)
  }, [configured, activation])

  const loadOwnerInfo = useCallback(async () => {
    if (!configured || !activation) return
    if (activation.cliente_id) {
      const { data } = await supabase
        .from('clientes')
        .select('ciudad, estado_region, nivel, estado_morosidad')
        .eq('id', activation.cliente_id)
        .maybeSingle()
      if (data) setOwnerInfo(data as OwnerInfo)
    } else if (activation.lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', activation.lead_id)
        .maybeSingle()
      if (data) setOwnerInfo(data as OwnerInfo)
    }
  }, [configured, activation])

  useEffect(() => {
    if (open && activation) {
      const handle = window.setTimeout(() => {
        void loadReferidos()
        void loadOwnerInfo()
      }, 0)
      return () => window.clearTimeout(handle)
    }
    if (!open) {
      startTransition(() => {
        setReferidos([])
        setEstadoFilter('todos')
        setLeadForms(resetLeadForms())
        setExpandedLeadId(null)
        setExpandedDetailId(null)
        setNotasDrafts(resetDrafts())
        setNotasSaving(resetSavingMap())
        setNewRefOpen(false)
        setNewRef(EMPTY_NEW_REF)
        setCalificacionLead(null)
        setLeadGeoMap({})
        setOwnerInfo(null)
        setOwnerInfoOpen(false)
      })
    }
  }, [open, activation, loadReferidos, loadOwnerInfo])

  const handleEstadoChange = async (referidoId: string, nextEstado: CiReferidoEstado) => {
    if (!configured) return
    setReferidos((prev) => prev.map((r) => (r.id === referidoId ? { ...r, estado: nextEstado } : r)))
    await supabase.from('ci_referidos').update({ estado: nextEstado }).eq('id', referidoId)
  }

  const handleStarChange = async (referidoId: string, n: number) => {
    if (!configured) return
    const calificacion = n === 0 ? null : n
    setReferidos((prev) => prev.map((r) => (r.id === referidoId ? { ...r, calificacion } : r)))
    await supabase.from('ci_referidos').update({ calificacion }).eq('id', referidoId)
  }

  const handleNotasBlur = async (referidoId: string) => {
    if (!configured) return
    const notas = notasDrafts[referidoId] ?? ''
    setNotasSaving((prev) => ({ ...prev, [referidoId]: true }))
    await supabase.from('ci_referidos').update({ notas }).eq('id', referidoId)
    setReferidos((prev) => prev.map((r) => (r.id === referidoId ? { ...r, notas } : r)))
    setNotasSaving((prev) => ({ ...prev, [referidoId]: false }))
  }

  const _handleTakeReferido = async (referidoId: string) => {
    if (!configured) return
    await supabase.from('ci_referidos').update({ modo_gestion: 'vendedor_directo' }).eq('id', referidoId)
    await loadReferidos()
  }
  void _handleTakeReferido

  const _handleReturnReferido = async (referidoId: string) => {
    if (!configured) return
    await supabase.from('ci_referidos').update({ modo_gestion: 'telemercadeo' }).eq('id', referidoId)
    await loadReferidos()
  }
  void _handleReturnReferido

  const handleCreateLead = async (ref: CiReferido) => {
    if (!configured || !currentUserId || !activation) return
    const form = leadForms[ref.id]
    if (!form) return
    setLeadForms((prev) => ({ ...prev, [ref.id]: { ...form, saving: true, error: null } }))

    let resolvedLead: LeadSummary | null = null

    if (ref.telefono) {
      const { data: existing } = await supabase
        .from('leads')
        .select('id, nombre, apellido, telefono')
        .eq('telefono', ref.telefono)
        .maybeSingle()
      if (existing) resolvedLead = existing as LeadSummary
    }

    if (!resolvedLead) {
      const nameSplit = splitNombreApellido(ref.nombre)
      const leadPayload: Record<string, unknown> = {
        nombre: nameSplit.nombre || ref.nombre,
        apellido: nameSplit.apellido || null,
        telefono: ref.telefono,
        fuente: 'conexiones_infinitas',
        estado_pipeline: 'nuevo',
        owner_id: currentUserId,
        vendedor_id: currentUserId,
      }
      // Resolver referidor desde la activación — puede ser cliente o lead
      const referidorTipo = activation.cliente_id
        ? 'cliente'
        : activation.lead_id
          ? 'lead'
          : null
      const referidorId = activation.cliente_id ?? activation.lead_id ?? null
      if (referidorTipo && referidorId) {
        leadPayload.referidor_tipo = referidorTipo
        leadPayload.referidor_id   = referidorId
      }
      // Campo legacy — mantener para lectores aún no migrados
      if (activation.cliente_id) leadPayload.referido_por_cliente_id = activation.cliente_id

      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert(leadPayload)
        .select('id, nombre, apellido, telefono')
        .single()

      if (leadError || !newLead) {
        setLeadForms((prev) => ({
          ...prev,
          [ref.id]: { ...form, saving: false, error: leadError?.message ?? t('toast.error') },
        }))
        return
      }
      resolvedLead = newLead as LeadSummary
    }

    if (!resolvedLead) return

    await supabase.from('ci_referidos').update({ lead_id: resolvedLead.id }).eq('id', ref.id)
    setReferidos((prev) => prev.map((r) => (r.id === ref.id ? { ...r, lead_id: resolvedLead.id } : r)))
    setExpandedLeadId(null)
    setLeadForms((prev) => {
      const next = { ...prev }
      delete next[ref.id]
      return next
    })
    onRefresh?.()
    setCalificacionLead({
      id: resolvedLead.id,
      nombre: resolvedLead.nombre ?? ref.nombre,
      apellido: resolvedLead.apellido ?? null,
      telefono: resolvedLead.telefono ?? ref.telefono,
    })
  }

  const openCalificacion = useCallback(
    async (ref: CiReferidoRow) => {
      if (!ref.lead_id) return
      if (!configured) return
      const { data, error: fetchError } = await supabase
        .from('leads')
        .select(
          'id, nombre, apellido, email, telefono, direccion, apartamento, ciudad, estado_region, codigo_postal, fuente, owner_id, estado_civil, nombre_conyuge, telefono_conyuge, situacion_laboral, ninos_en_casa, cantidad_ninos, tiene_productos_rp, tipo_vivienda',
        )
        .eq('id', ref.lead_id)
        .maybeSingle()
      if (fetchError || !data) {
        showToast(fetchError?.message ?? t('toast.error'), 'error')
        const nameSplit = splitNombreApellido(ref.nombre)
        setCalificacionLead({
          id: ref.lead_id,
          nombre: nameSplit.nombre || ref.nombre,
          apellido: nameSplit.apellido || null,
          telefono: ref.telefono,
        })
        setFocusAddress(false)
        return
      }
      setCalificacionLead(data as CalificacionLead)
      const hasGeo = !!(data as { ciudad?: string | null }).ciudad || !!(data as { codigo_postal?: string | null }).codigo_postal
      setFocusAddress(!hasGeo)
    },
    [configured, showToast, t],
  )

  const handleAddNewReferido = async () => {
    if (!configured || !activation || !currentUserId) return
    if (!canAddReferido) {
      setNewRef((prev) => ({
        ...prev,
        error: 'No tienes permiso para agregar referidos a esta lista.',
      }))
      return
    }
    const nombre = formatProperName(newRef.nombre)
    const telefono = stripPhone(newRef.telefono)
    if (!nombre || !telefono) {
      setNewRef((prev) => ({ ...prev, error: t('conexiones.referidosPanel.newRefRequired') }))
      return
    }
    if (!currentUserId) {
      setNewRef((prev) => ({
        ...prev,
        error: 'Error de asignación: No se pudo identificar al vendedor/distribuidor gestor',
      }))
      return
    }
    setNewRef((prev) => ({ ...prev, saving: true, error: null }))
    const { data, error: insertError } = await supabase
      .from('ci_referidos')
      .insert({
        activacion_id: activation.id,
        nombre,
        telefono,
        relacion: newRef.relacion,
        estado: 'pendiente',
        modo_gestion: 'vendedor_directo',
        owner_id: currentUserId,
        gestionado_por_usuario_id: currentUserId,
      })
      .select('id, activacion_id, nombre, telefono, relacion, estado, lead_id, notas, calificacion, modo_gestion, asignado_a, gestionado_por_usuario_id, tomado_por_vendedor_at, liberado_a_telemercadeo_at')
      .single()
    if (insertError || !data) {
      const friendly = insertError?.message?.includes('ci_referidos_gestionado_por_required')
        ? 'Error de asignación: No se pudo identificar al vendedor/distribuidor gestor'
        : insertError?.message?.includes('row-level security')
          ? 'No tienes permiso para agregar referidos a esta lista.'
          : insertError?.message
      setNewRef((prev) => ({ ...prev, saving: false, error: friendly ?? t('toast.error') }))
      return
    }
    const newRow = data as CiReferido
    setReferidos((prev) => [...prev, newRow])
    setNotasDrafts((prev) => ({ ...prev, [newRow.id]: '' }))
    setNewRef(EMPTY_NEW_REF)
    setNewRefOpen(false)
    onRefresh?.()
  }

  const handleAgendarCita = (ref: CiReferidoRow) => {
    if (!ref.lead_id) return
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    setCitaInitial({
      owner_id: currentUserId ?? '',
      start_at: local.toISOString().slice(0, 16),
      tipo: 'demo',
      estado: 'programada',
      assigned_to: currentUserId ?? '',
      contacto_tipo: 'lead',
      contacto_id: ref.lead_id,
      contacto_nombre: ref.nombre ?? '',
      contacto_telefono: ref.telefono ?? '',
    })
    setCitaReferidoId(ref.id)
    setCitaOpen(true)
  }

  const handleCitaSaved = async (citaId?: string) => {
    setCitaOpen(false)
    if (!citaId || !citaReferidoId || !configured) return
    await supabase
      .from('ci_referidos')
      .update({ cita_id: citaId, estado: 'cita_agendada' })
      .eq('id', citaReferidoId)
    setCitaReferidoId(null)
    void loadReferidos()
    onRefresh?.()
  }

  if (!open) return null

  const stats = {
    total: referidos.length,
    citas: referidos.filter((r) => r.estado === 'cita_agendada').length,
    cerrados: referidos.filter((r) => r.estado === 'regalo_entregado').length,
    tele: referidos.filter((r) => r.estado === 'telemercadeo').length,
  }
  const metaCount = MIN_REFERIDOS_CI
  const progresoColor =
    stats.total >= metaCount
      ? stats.total > metaCount
        ? '#a855f7'
        : '#22c55e'
      : stats.total >= Math.floor(metaCount / 2)
        ? '#3b82f6'
        : '#94a3b8'

  const filteredBase =
    estadoFilter === 'todos'
      ? referidos
      : referidos.filter((r) => r.estado === estadoFilter)

  const filtered = [...filteredBase].sort((a, b) => {
    const aPriority = REFERIDO_PRIORIDAD[a.estado ?? 'pendiente'] ?? 99
    const bPriority = REFERIDO_PRIORIDAD[b.estado ?? 'pendiente'] ?? 99
    if (aPriority !== bPriority) return aPriority - bPriority

    const aHasLead = Boolean(a.lead_id)
    const bHasLead = Boolean(b.lead_id)
    if (aHasLead !== bHasLead) return aHasLead ? 1 : -1

    const aHasNote = Boolean((a.notas ?? '').trim())
    const bHasNote = Boolean((b.notas ?? '').trim())
    if (aHasNote !== bHasNote) return aHasNote ? 1 : -1

    return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')
  })

  // Owner info pills
  const ownerPills: string[] = []
  if (ownerInfo) {
    const loc = [ownerInfo.ciudad, ownerInfo.estado_region].filter(Boolean).join(', ')
    if (loc) ownerPills.push(`📍 ${loc}`)
    if (ownerInfo.situacion_laboral) ownerPills.push(`💼 ${ownerInfo.situacion_laboral}`)
    if (ownerInfo.estado_civil) ownerPills.push(`💍 ${ownerInfo.estado_civil}`)
    if (ownerInfo.tipo_vivienda) ownerPills.push(`🏠 ${ownerInfo.tipo_vivienda}`)
    if (ownerInfo.tiene_productos_rp != null)
      ownerPills.push(`RP: ${ownerInfo.tiene_productos_rp ? '✓' : '✗'}`)
    if (ownerInfo.nivel != null) ownerPills.push(`Nivel ${ownerInfo.nivel}`)
    if (ownerInfo.estado_morosidad) ownerPills.push(ownerInfo.estado_morosidad)
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation">
        <aside
          className="drawer drawer--wide"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header className="drawer-header" style={{ alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>
                  {t('conexiones.referidosPanel.title', { owner: ownerLabel })}
                </h3>
                {ownerPills.length > 0 && (
                  <button
                    type="button"
                    className="arp-owner-toggle"
                    onClick={() => setOwnerInfoOpen((v) => !v)}
                    title={t('conexiones.referidosPanel.ownerInfoToggle')}
                  >
                    {ownerInfoOpen ? '▲ info' : '▼ info'}
                  </button>
                )}
              </div>

              {/* Owner info card */}
              {ownerInfoOpen && ownerPills.length > 0 && (
                <div className="arp-owner-card">
                  {ownerPills.map((pill) => (
                    <span key={pill} className="arp-owner-pill">{pill}</span>
                  ))}
                </div>
              )}

              <div className="arp-stats">
                <span className="arp-stat">
                  {t('conexiones.referidosPanel.total')}: <strong>{stats.total}</strong>
                </span>
                <span className="arp-stat" style={{ color: progresoColor }}>
                  Referidos: <strong>{stats.total}/{metaCount}</strong>
                </span>
                <span className="arp-stat arp-stat--amber">
                  {t('conexiones.referidosPanel.citas')}: <strong>{stats.citas}</strong>
                </span>
                <span className="arp-stat arp-stat--green">
                  {t('conexiones.referidosPanel.cerrados')}: <strong>{stats.cerrados}</strong>
                </span>
                <span className="arp-stat arp-stat--purple">
                  {t('conexiones.referidosPanel.tele')}: <strong>{stats.tele}</strong>
                </span>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '0.4rem',
                alignItems: 'center',
                flexShrink: 0,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              {canEditOwner && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onEditOwner}
                  style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                >
                  {t('conexiones.activaciones.actions.editOwner')}
                </Button>
              )}
              {isClosed && activation && (
                <Button
                  type="button"
                  onClick={onReactivate}
                  style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                >
                  {t('conexiones.activaciones.actions.reactivate')}
                </Button>
              )}
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
          </header>

          {/* Estado filter tabs */}
          <div className="arp-tabs">
            <button
              type="button"
              className={`arp-tab ${estadoFilter === 'todos' ? 'active' : ''}`}
              onClick={() => setEstadoFilter('todos')}
            >
              {t('conexiones.referidosPanel.todos')} ({referidos.length})
            </button>
            {CI_REFERIDO_ESTADOS.map((estado) => {
              const count = referidos.filter((r) => r.estado === estado).length
              return (
                <button
                  key={estado}
                  type="button"
                  className={`arp-tab ${estadoFilter === estado ? 'active' : ''}`}
                  onClick={() => setEstadoFilter(estado)}
                >
                  {t(`conexiones.referidoEstados.${estado}`)} ({count})
                </button>
              )
            })}
          </div>

          {/* Referido list */}
          <div className="drawer-body">
            {loading && <p className="form-hint">{t('common.loading')}</p>}
            {error && <div className="form-error">{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <p className="form-hint">{t('common.noData')}</p>
            )}
            {!loading &&
              filtered.map((ref) => {
                const style = ESTADO_STYLE[ref.estado ?? 'pendiente'] ?? ESTADO_STYLE.pendiente
                const isExpanded = expandedLeadId === ref.id
                const isDetailOpen = expandedDetailId === ref.id
                const form = leadForms[ref.id]
                const isVendedorDirecto = ref.modo_gestion === 'vendedor_directo'
                const isTeleReadOnly = currentRole === 'telemercadeo' && isVendedorDirecto
                const embudo = buildReferidoEmbudo(ref)
                // Option A: referidos start as vendedor_directo.
                // Representante/admin/distribuidor can send to tele or recover from tele.
                const isRepresentante = activation?.vendedor_id === currentUserId
                const canManageGestion =
                  !isClosed &&
                  (isRepresentante ||
                    currentRole === 'admin' ||
                    currentRole === 'distribuidor')
                const canSendToTele = canManageGestion && isVendedorDirecto
                const canRecoverFromTele = canManageGestion && !isVendedorDirecto
                void canSendToTele
                void canRecoverFromTele
                const noteValue = notasDrafts[ref.id] ?? ''
                const notePreview = noteValue.trim().length > 0 ? noteValue.trim().slice(0, 80) : ''
                const nextStep =
                  embudo.etapa === 'llamada_gestionada' && !ref.lead_id
                    ? isVendedorDirecto
                      ? 'Crear lead o enviar a telemercadeo'
                      : 'Recuperar o dar seguimiento'
                    : embudo.siguientePaso
                const isUrgent = (ref.estado ?? 'pendiente') === 'pendiente' && !ref.cita_id

                return (
                  <div
                    key={ref.id}
                    className="arp-row"
                    style={{ padding: '0.9rem 1rem', display: 'grid', gap: '0.75rem' }}
                  >
                    <div
                      className="arp-row-main"
                      style={{ alignItems: 'flex-start', display: 'grid', gap: '0.75rem' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '0.4rem', minWidth: 0, flex: '1 1 20rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="arp-row-nombre">{ref.nombre ?? '-'}</span>
                            <span className="arp-row-tel">{ref.telefono ?? '-'}</span>
                            {isUrgent && (
                              <span className="arp-relacion-chip" style={{ background: '#fee2e2', color: '#991b1b' }}>
                                Trabajar ahora
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span className="arp-relacion-chip" style={{ background: 'rgba(59,130,246,0.14)', color: '#bfdbfe' }}>
                              {getReferidoStageLabel(embudo.etapa)}
                            </span>
                            {ref.relacion && <span className="arp-relacion-chip">{ref.relacion}</span>}
                            <span
                              className="arp-relacion-chip"
                              style={isVendedorDirecto ? { background: '#fde68a', color: '#92400e' } : undefined}
                            >
                              {isVendedorDirecto
                                ? t('conexiones.referidosPanel.management.vendedorDirecto')
                                : t('conexiones.referidosPanel.management.telemercadeo')}
                            </span>
                            {ref.cita_id && (
                              <span className="arp-relacion-chip" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                                Cita
                              </span>
                            )}
                            {ref.lead_id && (
                              <span className="arp-relacion-chip" style={{ background: '#dcfce7', color: '#166534' }}>
                                Lead
                              </span>
                            )}
                            {ref.lead_id && (() => {
                              const geo = leadGeoMap[ref.lead_id]
                              if (!geo) return null
                              const missingCiudad = !geo.ciudad
                              const missingZip = !geo.codigo_postal
                              if (!missingCiudad && !missingZip) {
                                return (
                                  <span className="arp-relacion-chip" style={{ background: '#d1fae5', color: '#065f46' }}>
                                    Listo para gestionar
                                  </span>
                                )
                              }
                              return (
                                <>
                                  {missingCiudad && (
                                    <span className="arp-relacion-chip" style={{ background: '#fef3c7', color: '#92400e' }}>
                                      Falta ciudad
                                    </span>
                                  )}
                                  {missingZip && (
                                    <span className="arp-relacion-chip" style={{ background: '#fef3c7', color: '#92400e' }}>
                                      Falta ZIP
                                    </span>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                          {notePreview && !isDetailOpen && (
                            <div className="drawer-subtitle" style={{ margin: 0 }}>
                              Nota: {notePreview}
                              {noteValue.trim().length > 80 ? '...' : ''}
                            </div>
                          )}
                          <div className="drawer-subtitle" style={{ margin: 0 }}>
                            Ultima accion: {embudo.ultimaAccion}
                          </div>
                          <div className="drawer-subtitle" style={{ margin: 0, color: '#cbd5e1' }}>
                            Siguiente paso: {nextStep}
                          </div>
                        </div>

                        <div style={{ display: 'grid', gap: '0.5rem', justifyItems: 'end' }}>
                      {/* Estado select */}
                      <select
                        className="arp-estado-select"
                        style={{ background: style.bg, color: style.color }}
                        value={ref.estado ?? 'pendiente'}
                        onChange={(e) =>
                          handleEstadoChange(ref.id, e.target.value as CiReferidoEstado)
                        }
                        disabled={isTeleReadOnly}
                      >
                        {CI_REFERIDO_ESTADOS.map((estado) => (
                          <option key={estado} value={estado}>
                            {t(`conexiones.referidoEstados.${estado}`)}
                          </option>
                        ))}
                      </select>
                          <button
                            type="button"
                            className="btn ghost"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={() => setExpandedDetailId((prev) => (prev === ref.id ? null : ref.id))}
                          >
                            {isDetailOpen ? 'Ocultar detalle' : 'Detalle'}
                          </button>
                        </div>
                      </div>

                      <div
                        className="arp-row-actions"
                        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        {ref.lead_id ? (
                          (() => {
                            const geo = leadGeoMap[ref.lead_id]
                            const missingGeo = !geo?.ciudad || !geo?.codigo_postal
                            return (
                              <button
                                type="button"
                                className="arp-icon-btn arp-icon-btn--calificar"
                                title="Completar datos de zona y calificar lead"
                                disabled={isTeleReadOnly}
                                onClick={() => openCalificacion(ref)}
                                style={missingGeo ? { borderColor: '#fcd34d', color: '#92400e' } : undefined}
                              >
                                {missingGeo ? '⚠ Completar datos' : 'Ver calificación'}
                              </button>
                            )
                          })()
                        ) : (
                          <button
                            type="button"
                            className="arp-icon-btn"
                            disabled={isTeleReadOnly}
                            onClick={() => {
                              setExpandedDetailId(ref.id)
                              if (isExpanded) {
                                setExpandedLeadId(null)
                              } else {
                                setExpandedLeadId(ref.id)
                                setLeadForms((prev) => ({
                                  ...prev,
                                  [ref.id]: { saving: false, error: null },
                                }))
                              }
                            }}
                          >
                            Activar y completar datos
                          </button>
                        )}

                        <button
                          type="button"
                          className="arp-icon-btn arp-icon-btn--wa"
                          title="WhatsApp"
                          disabled={!ref.telefono || isTeleReadOnly}
                          onClick={() =>
                            openWhatsapp({
                              nombre: ref.nombre ?? '',
                              telefono: ref.telefono ?? '',
                              recomendadoPor: ownerLabel ?? '',
                            })
                          }
                        >
                          WA
                        </button>

                        {ref.lead_id && (
                          <button
                            type="button"
                            className="arp-icon-btn"
                            title="Registrar llamada"
                            disabled={isTeleReadOnly}
                            onClick={() => {
                              const telefono = ref.telefono
                              const leadId = ref.lead_id
                              if (!leadId) return
                              openGestionModal({
                                contacto: { 
                                  tipo: 'lead', 
                                  id: leadId, 
                                  nombre: ref.nombre ?? '', 
                                  telefono: telefono || undefined 
                                },
                                tipoDefault: 'llamada',
                                moduloOrigen: 'conexiones_infinitas',
                              })
                            }}
                          >
                            Llamada
                          </button>
                        )}

                        {!ref.cita_id && ref.lead_id && !isTeleReadOnly && (
                          <button
                            type="button"
                            className="arp-icon-btn"
                            title="Agendar cita de presentación"
                            onClick={() => handleAgendarCita(ref)}
                          >
                            + Cita
                          </button>
                        )}

                        <button
                          type="button"
                          className="arp-icon-btn arp-icon-btn--sms"
                          title="SMS"
                          disabled={!ref.telefono || isTeleReadOnly}
                          onClick={() =>
                            openSms({ nombre: ref.nombre ?? '', telefono: ref.telefono ?? '' })
                          }
                        >
                          SMS
                        </button>
                      </div>
                    </div>

                    {isDetailOpen && (
                      <div
                        style={{
                          borderTop: '1px solid rgba(148,163,184,0.18)',
                          paddingTop: '0.75rem',
                          display: 'grid',
                          gap: '0.65rem',
                        }}
                      >
                        <div className="arp-row-stars">
                          <StarRating
                            value={ref.calificacion ?? null}
                            onChange={(n) => handleStarChange(ref.id, n)}
                            disabled={isTeleReadOnly}
                          />
                        </div>

                        <textarea
                          className="arp-notas"
                          placeholder={t('conexiones.referidosPanel.notasPlaceholder')}
                          value={noteValue}
                          rows={2}
                          disabled={isTeleReadOnly}
                          onChange={(e) =>
                            setNotasDrafts((prev) => ({ ...prev, [ref.id]: e.target.value }))
                          }
                          onBlur={() => {
                            if (!isTeleReadOnly) handleNotasBlur(ref.id)
                          }}
                        />
                        {notasSaving[ref.id] && (
                          <span className="form-hint" style={{ fontSize: '0.75rem' }}>
                            {t('common.saving')}...
                          </span>
                        )}

                        {isExpanded && form && (
                          <div className="arp-lead-form">
                            {form.error && <div className="form-error">{form.error}</div>}
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <Button
                                type="button"
                                onClick={() => handleCreateLead(ref)}
                                disabled={form.saving || isTeleReadOnly}
                              >
                                {form.saving
                                  ? t('common.saving')
                                  : t('conexiones.referidosPanel.createLead')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setExpandedLeadId(null)}
                              >
                                {t('common.cancel')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

            {/* Add new referido */}
            {!isClosed && (
              <div style={{ paddingTop: '12px' }}>
                {!newRefOpen ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setNewRefOpen(true)}
                    style={{ width: '100%' }}
                  >
                    + {t('conexiones.referidosPanel.addReferido')}
                  </Button>
                ) : (
                  <div className="arp-lead-form">
                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.88rem' }}>
                      {t('conexiones.referidosPanel.addReferido')}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <label className="form-field" style={{ flex: 1, minWidth: '140px' }}>
                        <span>{t('conexiones.referidosPanel.newRefNombre')}</span>
                        <input
                          value={newRef.nombre}
                          placeholder="Nombre"
                          onChange={(e) =>
                            setNewRef((prev) => ({ ...prev, nombre: e.target.value }))
                          }
                        />
                      </label>
                      <label className="form-field" style={{ flex: 1, minWidth: '140px' }}>
                        <span>{t('conexiones.referidosPanel.newRefTelefono')}</span>
                        <input
                          value={newRef.telefono}
                          placeholder="(000) 000-0000"
                          onChange={(e) =>
                            setNewRef((prev) => ({
                              ...prev,
                              telefono: formatPhone(e.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="form-field" style={{ minWidth: '120px' }}>
                        <span>{t('conexiones.referidosPanel.newRefRelacion')}</span>
                        <select
                          value={newRef.relacion}
                          onChange={(e) =>
                            setNewRef((prev) => ({ ...prev, relacion: e.target.value }))
                          }
                        >
                          {CI_RELACIONES.map((rel) => (
                            <option key={rel} value={rel}>
                              {t(`conexiones.relaciones.${rel}`, { defaultValue: rel })}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {newRef.error && <div className="form-error">{newRef.error}</div>}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                      type="button"
                      onClick={handleAddNewReferido}
                      disabled={newRef.saving || !canAddReferido}
                    >
                      {newRef.saving ? t('common.saving') : t('common.save')}
                    </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setNewRefOpen(false)
                          setNewRef(EMPTY_NEW_REF)
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <ModalRenderer />

      <CalificacionPanel
        open={calificacionLead !== null}
        lead={calificacionLead}
        ownerName={ownerLabel}
        fuenteLabel="Conexiones Infinitas"
        focusAddress={focusAddress}
        onClose={() => {
          setCalificacionLead(null)
          setFocusAddress(false)
        }}
        onSaved={async () => {
          setCalificacionLead(null)
          setFocusAddress(false)
        }}
      />

      <CitaModal
        open={citaOpen}
        onClose={() => { setCitaOpen(false); setCitaReferidoId(null) }}
        onSaved={handleCitaSaved}
        initialData={citaInitial}
        assignedOptions={currentUserId ? [{ id: currentUserId, label: 'Yo' }] : []}
      />
    </>
  )
}
