import { type ChangeEvent, type FormEvent, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { CalificacionPanel } from '../../components/CalificacionPanel'
import { EmptyState } from '../../components/EmptyState'
import { IconRestore, IconSwap, IconTrash, IconWhatsapp } from '../../components/icons'
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
  deleted_at?: string | null
  deleted_by?: string | null
  deleted_reason?: string | null
}

type OwnerOption = {
  id: string
  label: string
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

const EN_PROCESO_STAGES = ['contactado', 'cita', 'demo', 'cierre']

function stageBadgeColor(stage: string): string {
  const map: Record<string, string> = {
    nuevo: '#dbeafe',
    contactado: '#ede9fe',
    cita: '#fef3c7',
    demo: '#fed7aa',
    cierre: '#d1fae5',
    descartado: '#f3f4f6',
  }
  return map[stage] ?? '#f3f4f6'
}

function stageBadgeTextColor(stage: string): string {
  const map: Record<string, string> = {
    nuevo: '#1e40af',
    contactado: '#5b21b6',
    cita: '#92400e',
    demo: '#9a3412',
    cierre: '#065f46',
    descartado: '#6b7280',
  }
  return map[stage] ?? '#6b7280'
}

export function LeadsPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'active' | 'trash'>('active')
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [fuenteOtro, setFuenteOtro] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null)
  const [manageLead, setManageLead] = useState<LeadRecord | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [manageMode, setManageMode] = useState<'delete' | 'reassign' | 'restore'>('delete')
  const [manageReason, setManageReason] = useState('')
  const [manageOwnerId, setManageOwnerId] = useState('')
  const [manageError, setManageError] = useState<string | null>(null)
  const [manageSaving, setManageSaving] = useState(false)
  const [ownerOptions, setOwnerOptions] = useState<OwnerOption[]>([])
  const [ownersLoading, setOwnersLoading] = useState(false)
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const configured = isSupabaseConfigured
  const canManageLeads = role === 'admin' || role === 'distribuidor'

  // --- FILTROS ---
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroFuente, setFiltroFuente] = useState('todos')
  const [filtroOwner, setFiltroOwner] = useState('todos')
  const [filtroVencido, setFiltroVencido] = useState(false)
  const [filtrosVisible, setFiltrosVisible] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 720)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  const loadOwnerOptions = useCallback(async () => {
    if (!configured || !session?.user.id || !canManageLeads) return
    setOwnersLoading(true)
    const { data, error: fetchError } = await supabase
      .from('usuarios')
      .select('id, nombre, apellido, email, rol')
      .in('rol', ['distribuidor', 'vendedor'])

    if (fetchError) {
      setOwnerOptions([])
      setOwnersLoading(false)
      return
    }

    const options = (data ?? []).map((user: { id: string; nombre: string | null; apellido: string | null; email: string | null }) => {
      const label = [user.nombre, user.apellido].filter(Boolean).join(' ').trim()
      return {
        id: user.id,
        label: label || user.email || user.id,
      }
    })
    setOwnerOptions(options)
    setOwnersLoading(false)
  }, [configured, session?.user.id, canManageLeads])

  const loadLeads = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (viewMode === 'trash') {
      query = query.not('deleted_at', 'is', null)
    } else {
      query = query.is('deleted_at', null)
    }
    if (role === 'telemercadeo') {
      query = query.eq('estado_pipeline', 'nuevo')
    }
    if (role === 'vendedor' && session?.user.id) {
      query = query.eq('owner_id', session.user.id)
    }
    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setLeads([])
    } else {
      setLeads(data ?? [])
    }
    setLoading(false)
  }, [configured, role, viewMode, session?.user.id])

  useEffect(() => {
    if (configured) loadRole()
  }, [configured, loadRole])

  useEffect(() => {
    if (!canManageLeads && viewMode === 'trash') {
      setViewMode('active')
    }
  }, [canManageLeads, viewMode])

  useEffect(() => {
    if (configured) loadLeads()
  }, [configured, loadLeads, role])

  useEffect(() => {
    if (!manageOpen || manageMode !== 'reassign') return
    loadOwnerOptions()
  }, [manageOpen, manageMode, loadOwnerOptions])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 720)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  // --- OWNERS / FUENTES ÚNICOS ---
  const ownersUnicos = useMemo(() => {
    const ids = [...new Set(leads.map((l) => l.owner_id).filter(Boolean))] as string[]
    return ids.map((id) => ({ id, nombre: usersById[id] ?? id }))
  }, [leads, usersById])

  const fuentesUnicas = useMemo(() => {
    const values = [...new Set(leads.map((l) => l.fuente).filter(Boolean))] as string[]
    return values.map((v) => ({ value: v, label: getFuenteLabel(v) }))
  }, [leads, getFuenteLabel])

  // --- FILTRADO ---
  const leadsFiltrados = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return leads.filter((lead) => {
      const fullName = `${lead.nombre ?? ''} ${lead.apellido ?? ''}`.toLowerCase()
      const tel = lead.telefono ?? ''
      const matchBusqueda = !busqueda || fullName.includes(busqueda.toLowerCase()) || tel.includes(busqueda)
      const stage = normalizeStage(lead.estado_pipeline)
      const matchEstado =
        filtroEstado === 'todos' ||
        stage === filtroEstado ||
        lead.estado_pipeline === filtroEstado ||
        (filtroEstado === 'en_proceso' && EN_PROCESO_STAGES.includes(stage))
      const matchFuente = filtroFuente === 'todos' || lead.fuente === filtroFuente
      const matchOwner = filtroOwner === 'todos' || lead.owner_id === filtroOwner
      const matchVencido =
        !filtroVencido ||
        (!!lead.next_action_date &&
          lead.next_action_date <= today &&
          lead.estado_pipeline !== 'descartado' &&
          lead.estado_pipeline !== 'cierre')
      return matchBusqueda && matchEstado && matchFuente && matchOwner && matchVencido
    })
  }, [leads, busqueda, filtroEstado, filtroFuente, filtroOwner, filtroVencido, normalizeStage])

  // --- ORDENACIÓN ---
  const handleSort = (colIndex: number) => {
    if (sortCol === colIndex) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(colIndex)
      setSortDir('asc')
    }
  }

  const leadsOrdenados = useMemo(() => {
    if (sortCol === null) return leadsFiltrados
    return [...leadsFiltrados].sort((a, b) => {
      let valA = ''
      let valB = ''
      if (sortCol === 0) {
        valA = `${a.nombre ?? ''} ${a.apellido ?? ''}`.toLowerCase()
        valB = `${b.nombre ?? ''} ${b.apellido ?? ''}`.toLowerCase()
      } else if (sortCol === 4) {
        valA = normalizeStage(a.estado_pipeline)
        valB = normalizeStage(b.estado_pipeline)
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [leadsFiltrados, sortCol, sortDir, normalizeStage])

  // --- ESTADISTICAS ---
  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return {
      total: leads.length,
      nuevo: leads.filter((l) => normalizeStage(l.estado_pipeline) === 'nuevo').length,
      enProceso: leads.filter((l) => EN_PROCESO_STAGES.includes(normalizeStage(l.estado_pipeline))).length,
      descartado: leads.filter((l) => l.estado_pipeline === 'descartado').length,
      vencidos: leads.filter(
        (l) =>
          l.next_action_date &&
          l.next_action_date <= today &&
          l.estado_pipeline !== 'descartado' &&
          l.estado_pipeline !== 'cierre',
      ).length,
    }
  }, [leads, normalizeStage])

  const openManageModal = useCallback(
    (lead: LeadRecord, mode: 'delete' | 'reassign' | 'restore') => {
      if (!canManageLeads) return
      setManageLead(lead)
      setManageMode(mode)
      setManageReason('')
      setManageOwnerId(lead.owner_id ?? '')
      setManageError(null)
      setManageOpen(true)
    },
    [canManageLeads],
  )

  const closeManageModal = useCallback(() => {
    setManageOpen(false)
    setManageLead(null)
    setManageReason('')
    setManageOwnerId('')
    setManageError(null)
    setManageSaving(false)
  }, [])

  const handleDeleteLead = useCallback(async () => {
    if (!manageLead || !session?.user.id) return
    const reason = manageReason.trim()
    if (!reason) {
      setManageError('Motivo requerido para eliminar.')
      return
    }
    setManageSaving(true)
    setManageError(null)
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: session.user.id,
        deleted_reason: reason,
      })
      .eq('id', manageLead.id)
    if (updateError) {
      setManageError(updateError.message)
      showToast(updateError.message, 'error')
      setManageSaving(false)
      return
    }
    showToast('Lead eliminado.')
    closeManageModal()
    setSelectedLead(null)
    await loadLeads()
  }, [closeManageModal, loadLeads, manageLead, manageReason, session?.user.id, showToast])

  const handleRestoreLead = useCallback(async () => {
    if (!manageLead) return
    setManageSaving(true)
    setManageError(null)
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        deleted_at: null,
        deleted_by: null,
        deleted_reason: null,
      })
      .eq('id', manageLead.id)
    if (updateError) {
      setManageError(updateError.message)
      showToast(updateError.message, 'error')
      setManageSaving(false)
      return
    }
    showToast('Lead restaurado.')
    closeManageModal()
    setSelectedLead(null)
    await loadLeads()
  }, [closeManageModal, loadLeads, manageLead, showToast])

  const handleReassignLead = useCallback(async () => {
    if (!manageLead) return
    if (!manageOwnerId) {
      setManageError('Selecciona un owner para reasignar.')
      return
    }
    setManageSaving(true)
    setManageError(null)
    const { error: updateError } = await supabase
      .from('leads')
      .update({ owner_id: manageOwnerId })
      .eq('id', manageLead.id)
    if (updateError) {
      setManageError(updateError.message)
      showToast(updateError.message, 'error')
      setManageSaving(false)
      return
    }
    showToast('Lead reasignado.')
    closeManageModal()
    setSelectedLead(null)
    await loadLeads()
  }, [closeManageModal, loadLeads, manageLead, manageOwnerId, showToast])

  // --- ROWS ---
  const isTrashView = viewMode === 'trash'

  const rows = useMemo<DataTableRow[]>(() => {
    return leadsOrdenados.map((lead) => {
      const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
      const stage = normalizeStage(lead.estado_pipeline)
      const estadoLabel = t(`pipeline.columns.${stage}`)
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
      let actions: ReactElement | undefined
      if (canManageLeads) {
        actions = (
          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
            {isTrashView ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Restaurar"
                title="Restaurar"
                onClick={(event) => {
                  event.stopPropagation()
                  openManageModal(lead, 'restore')
                }}
              >
                <IconRestore />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Reasignar"
                  title="Reasignar"
                  onClick={(event) => {
                    event.stopPropagation()
                    openManageModal(lead, 'reassign')
                  }}
                >
                  <IconSwap />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Eliminar"
                  title="Eliminar"
                  onClick={(event) => {
                    event.stopPropagation()
                    openManageModal(lead, 'delete')
                  }}
                >
                  <IconTrash />
                </button>
              </>
            )}
          </div>
        )
      }

      const cells = [
        fullName,
        lead.telefono ?? '-',
        getFuenteLabel(lead.fuente),
        getOwnerName(lead.owner_id),
        estadoLabel,
        lead.next_action ?? '-',
        whatsappAction,
      ]

      if (canManageLeads && actions) {
        cells.push(actions)
      }

      return {
        id: lead.id,
        cells,
        detail: [],
      }
    })
  }, [canManageLeads, getFuenteLabel, getOwnerName, isTrashView, leadsOrdenados, normalizeStage, openManageModal, openWhatsapp, t])

  const emptyLabel = loading
    ? t('common.loading')
    : isTrashView
      ? 'No hay leads en papelera.'
      : t('common.noData')

  const handleOpenForm = () => {
    setFormValues({ ...initialForm, owner_id: session?.user.id ?? '' })
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
    if (value !== 'otro') setFuenteOtro('')
  }

  const limpiarFiltros = () => {
    setBusqueda('')
    setFiltroEstado('todos')
    setFiltroFuente('todos')
    setFiltroOwner('todos')
    setFiltroVencido(false)
  }

  const cantFiltrosActivos = [
    busqueda,
    filtroEstado !== 'todos' ? '1' : '',
    filtroFuente !== 'todos' ? '1' : '',
    filtroOwner !== 'todos' ? '1' : '',
  ].filter(Boolean).length

  const exportarCSV = () => {
    const headers = [
      'Nombre', 'Apellido', 'Telefono', 'Email',
      'Fuente', 'Owner', 'Estado', 'Próxima Acción', 'Fecha Próxima Acción',
    ]
    const csvRows = leadsFiltrados.map((l) => [
      l.nombre ?? '',
      l.apellido ?? '',
      l.telefono ?? '',
      l.email ?? '',
      getFuenteLabel(l.fuente),
      getOwnerName(l.owner_id),
      t(`pipeline.columns.${normalizeStage(l.estado_pipeline)}`),
      l.next_action ?? '',
      l.next_action_date ?? '',
    ])
    const csv = [headers, ...csvRows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const leadMap = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])

  const handleRowClick = (row: DataTableRow) => {
    const lead = leadMap.get(row.id)
    if (lead) setSelectedLead(lead)
  }

  if (!configured) {
    return <EmptyState title={t('dashboard.missingConfigTitle')} description={t('dashboard.missingConfigDescription')} />
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('leads.title')}
        subtitle={t('leads.subtitle')}
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canManageLeads && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => setViewMode((prev) => (prev === 'trash' ? 'active' : 'trash'))}
              >
                {viewMode === 'trash' ? 'Ver activos' : 'Papelera'}
              </Button>
            )}
            <Button
              variant="ghost"
              type="button"
              onClick={exportarCSV}
              disabled={leadsFiltrados.length === 0}
            >
              Exportar CSV
            </Button>
            <Button onClick={handleOpenForm} disabled={viewMode === 'trash'}>
              {t('common.newLead')}
            </Button>
          </div>
        }
      />

      {error && <div className="form-error">{error}</div>}

      {/* ESTADISTICAS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Total', value: stats.total, color: '#3b82f6', onClick: limpiarFiltros },
          { label: 'Nuevos', value: stats.nuevo, color: '#6366f1', onClick: () => { limpiarFiltros(); setFiltroEstado('nuevo') } },
          { label: 'En proceso', value: stats.enProceso, color: '#f59e0b', onClick: () => { limpiarFiltros(); setFiltroEstado('en_proceso') } },
          { label: 'Descartados', value: stats.descartado, color: '#6b7280', onClick: () => { limpiarFiltros(); setFiltroEstado('descartado') } },
          {
            label: 'Seguimientos',
            value: stats.vencidos,
            color: stats.vencidos > 0 ? '#ef4444' : '#10b981',
            onClick: () => { limpiarFiltros(); setFiltroVencido(true) },
          },
        ].map((s) => (
          <div
            key={s.label}
            role="button"
            tabIndex={0}
            onClick={s.onClick}
            onKeyDown={(e) => e.key === 'Enter' && s.onClick()}
            title="Click para filtrar"
            style={{
              padding: '0.875rem 1rem',
              background: 'var(--color-surface, #f9fafb)',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border, #e5e7eb)',
              textAlign: 'center',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* FILTROS */}
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
              {leadsFiltrados.length} de {leads.length} leads
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
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                BUSCAR
              </label>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre, teléfono..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                ESTADO
              </label>
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                }}
              >
                <option value="todos">Todos</option>
                <option value="nuevo">{t('pipeline.columns.nuevo')}</option>
                <option value="en_proceso">En proceso</option>
                <option value="contactado">{t('pipeline.columns.contactado')}</option>
                <option value="cita">{t('pipeline.columns.cita')}</option>
                <option value="demo">{t('pipeline.columns.demo')}</option>
                <option value="cierre">{t('pipeline.columns.cierre')}</option>
                <option value="descartado">{t('pipeline.columns.descartado')}</option>
              </select>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                FUENTE
              </label>
              <select
                value={filtroFuente}
                onChange={(e) => setFiltroFuente(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                }}
              >
                <option value="todos">Todas</option>
                {fuentesUnicas.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginBottom: '0.3rem',
                  color: 'var(--color-text-muted, #6b7280)',
                }}
              >
                OWNER
              </label>
              <select
                value={filtroOwner}
                onChange={(e) => setFiltroOwner(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  fontSize: '0.875rem',
                  background: 'white',
                }}
              >
                <option value="todos">Todos</option>
                {ownersUnicos.map((o) => (
                  <option key={o.id} value={o.id}>{o.nombre}</option>
                ))}
              </select>
            </div>

            {cantFiltrosActivos > 0 && (
              <Button variant="ghost" type="button" onClick={limpiarFiltros}>
                Limpiar
              </Button>
            )}
          </div>
        )}
      </div>

      {/* TABLA / CARDS */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {leadsOrdenados.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2rem 1rem',
                color: 'var(--text-muted, #94a3b8)',
                background: 'var(--card-bg, #1e2d3d)',
                borderRadius: '0.75rem',
                border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
              }}
            >
              {emptyLabel}
            </div>
          ) : (
            leadsOrdenados.map((lead) => {
              const fullName = [lead.nombre, lead.apellido].filter(Boolean).join(' ') || '-'
              const stage = normalizeStage(lead.estado_pipeline)
              const stageLabel = t(`pipeline.columns.${stage}`)
              const ownerLabel = getOwnerName(lead.owner_id)
              return (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  style={{
                    padding: '0.875rem 1rem',
                    background: 'var(--card-bg, #1e2d3d)',
                    borderRadius: '0.75rem',
                    border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{fullName}</span>
                    <span
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: stageBadgeColor(stage),
                        color: stageBadgeTextColor(stage),
                        flexShrink: 0,
                      }}
                    >
                      {stageLabel}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem',
                      color: 'var(--text-muted, #94a3b8)',
                    }}
                  >
                    <span>{lead.telefono ?? '-'}</span>
                    <span>{getFuenteLabel(lead.fuente)}</span>
                  </div>
                  {(ownerLabel !== '-' || lead.next_action) && (
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted, #94a3b8)',
                        display: 'flex',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      {ownerLabel !== '-' && <span>{ownerLabel}</span>}
                      {lead.next_action && <span>· {lead.next_action}</span>}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem', gap: '0.35rem' }}>
                    {canManageLeads && isTrashView ? (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Restaurar"
                        title="Restaurar"
                        onClick={(e) => {
                          e.stopPropagation()
                          openManageModal(lead, 'restore')
                        }}
                      >
                        <IconRestore />
                      </button>
                    ) : null}
                    {canManageLeads && !isTrashView ? (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Reasignar"
                          title="Reasignar"
                          onClick={(e) => {
                            e.stopPropagation()
                            openManageModal(lead, 'reassign')
                          }}
                        >
                          <IconSwap />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Eliminar"
                          title="Eliminar"
                          onClick={(e) => {
                            e.stopPropagation()
                            openManageModal(lead, 'delete')
                          }}
                        >
                          <IconTrash />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="whatsapp-button"
                      aria-label="WhatsApp"
                      onClick={(e) => {
                        e.stopPropagation()
                        openWhatsapp({
                          nombre: fullName,
                          telefono: lead.telefono ?? '',
                          email: lead.email ?? '',
                          vendedor: ownerLabel === '-' ? '' : ownerLabel,
                          leadId: lead.id,
                        })
                      }}
                    >
                      <IconWhatsapp className="whatsapp-icon" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        <DataTable
          columns={[
            t('leads.columns.nombre'),
            t('leads.columns.telefono'),
            t('leads.columns.fuente'),
            t('leads.columns.owner'),
            t('leads.columns.estado'),
            t('leads.columns.nextAction'),
            t('whatsapp.column'),
            ...(canManageLeads ? ['Acciones'] : []),
          ]}
          rows={rows}
          emptyLabel={emptyLabel}
          onRowClick={handleRowClick}
          sortableColumns={[0, 4]}
          sortColIndex={sortCol ?? undefined}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

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

      <Modal
        open={manageOpen}
        title="Gestionar lead"
        onClose={closeManageModal}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={closeManageModal}>
              {t('common.cancel')}
            </Button>
            {manageMode === 'delete' && (
              <Button
                type="button"
                onClick={handleDeleteLead}
                disabled={manageSaving || manageReason.trim() === ''}
              >
                {manageSaving ? t('common.saving') : 'Eliminar'}
              </Button>
            )}
            {manageMode === 'reassign' && (
              <Button
                type="button"
                onClick={handleReassignLead}
                disabled={
                  manageSaving ||
                  manageOwnerId === '' ||
                  manageOwnerId === manageLead?.owner_id
                }
              >
                {manageSaving ? t('common.saving') : 'Reasignar'}
              </Button>
            )}
            {manageMode === 'restore' && (
              <Button type="button" onClick={handleRestoreLead} disabled={manageSaving}>
                {manageSaving ? t('common.saving') : 'Restaurar'}
              </Button>
            )}
          </>
        }
      >
        {manageLead && (
          <div className="form-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <strong>
                {[manageLead.nombre, manageLead.apellido].filter(Boolean).join(' ') || manageLead.id}
              </strong>
              {manageLead.telefono && (
                <span style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted, #6b7280)' }}>
                  {manageLead.telefono}
                </span>
              )}
            </div>

            {!manageLead.deleted_at && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button
                  variant={manageMode === 'delete' ? 'primary' : 'ghost'}
                  type="button"
                  onClick={() => setManageMode('delete')}
                >
                  Eliminar
                </Button>
                <Button
                  variant={manageMode === 'reassign' ? 'primary' : 'ghost'}
                  type="button"
                  onClick={() => setManageMode('reassign')}
                >
                  Reasignar
                </Button>
              </div>
            )}

            {manageMode === 'delete' && !manageLead.deleted_at && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Motivo de eliminacion (obligatorio)</span>
                <textarea
                  rows={3}
                  value={manageReason}
                  onChange={(event) => setManageReason(event.target.value)}
                  placeholder="Ej: Lead duplicado, informacion incorrecta, etc."
                />
              </label>
            )}

            {manageMode === 'reassign' && !manageLead.deleted_at && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Reasignar a</span>
                <select
                  value={manageOwnerId}
                  onChange={(event) => setManageOwnerId(event.target.value)}
                  disabled={ownersLoading}
                >
                  <option value="">Selecciona usuario</option>
                  {ownerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {ownersLoading && <div className="form-hint">Cargando usuarios...</div>}
              </label>
            )}

            {manageMode === 'restore' && manageLead.deleted_at && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Este lead sera restaurado y volvera a estar activo.</span>
                {manageLead.deleted_reason && (
                  <p className="form-hint">Motivo: {manageLead.deleted_reason}</p>
                )}
              </div>
            )}

            {manageError && (
              <div className="form-error" style={{ gridColumn: '1 / -1' }}>
                {manageError}
              </div>
            )}
          </div>
        )}
      </Modal>

      <CalificacionPanel
        open={Boolean(selectedLead)}
        lead={selectedLead}
        ownerName={selectedLead ? getOwnerName(selectedLead.owner_id) : undefined}
        fuenteLabel={selectedLead ? getFuenteLabel(selectedLead.fuente) : undefined}
        canManage={canManageLeads}
        onOpenManage={(lead, mode) => openManageModal(lead as LeadRecord, mode)}
        onClose={() => setSelectedLead(null)}
        onSaved={loadLeads}
      />
      <ModalRenderer />
    </div>
  )
}
