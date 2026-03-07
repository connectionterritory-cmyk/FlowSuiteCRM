import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useViewMode } from '../../data/ViewModeProvider'
import { buildWhatsappUrl } from '../../lib/whatsappTemplates'
import { buildMapsNavUrl } from '../../lib/addressUtils'
import { CitaModal, type CitaForm } from './CitaModal'

type CitaRow = {
  id: string
  owner_id: string | null
  start_at: string | null
  tipo: string | null
  nombre: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  zip: string | null
  estado: string | null
  assigned_to: string | null
  contacto_tipo: string | null
  contacto_id: string | null
  notas: string | null
  resultado: string | null
  resultado_notas: string | null
}

type ServicioRow = {
  id: string
  fecha_servicio: string | null
  hora_cita: string | null
  tipo_servicio: string | null
  observaciones: string | null
  vendedor_id: string | null
  cliente:
    | {
        nombre: string | null
        apellido: string | null
        telefono: string | null
        direccion: string | null
        ciudad: string | null
        estado_region: string | null
      }
    | {
        nombre: string | null
        apellido: string | null
        telefono: string | null
        direccion: string | null
        ciudad: string | null
        estado_region: string | null
      }[]
    | null
}

type AgendaItem = {
  id: string
  start_at: string | null
  tipo_evento: 'cita' | 'servicio'
  titulo: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  estado: string | null
  resultado: string | null
  tipo_label: string | null
  cita?: CitaRow
  servicio?: ServicioRow
}

type RangeKey = 'hoy' | 'manana' | 'semana' | 'todas'

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'manana', label: 'Mañana' },
  { key: 'semana', label: 'Semana' },
  { key: 'todas', label: 'Todas' },
]

const toLocalInput = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

const formatHour = (value: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

const formatDate = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('es')
}

const buildServiceStartAt = (fecha: string | null, hora: string | null) => {
  if (!fecha) return null
  const safeHora = (hora ?? '00:00').slice(0, 5)
  return `${fecha}T${safeHora}:00`
}

const getRange = (key: RangeKey) => {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  if (key === 'hoy') {
    end.setDate(end.getDate() + 1)
    return { start, end }
  }
  if (key === 'manana') {
    start.setDate(start.getDate() + 1)
    end.setDate(end.getDate() + 2)
    return { start, end }
  }
  if (key === 'semana') {
    end.setDate(end.getDate() + 7)
    return { start, end }
  }
  return null
}

const getEstadoTone = (estadoLabel: string) => {
  if (estadoLabel === 'completada') return 'blue'
  if (estadoLabel === 'confirmada' || estadoLabel === 'en_camino') return 'blue'
  if (estadoLabel === 'cancelada' || estadoLabel === 'no_show') return 'neutral'
  return 'gold'
}

export function CitasPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const configured = isSupabaseConfigured
  const { distributionUserIds, hasDistribuidorScope } = useViewMode()
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('hoy')
  const [citas, setCitas] = useState<CitaRow[]>([])
  const [servicios, setServicios] = useState<ServicioRow[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [activeCita, setActiveCita] = useState<CitaRow | null>(null)
  const [assignedOptions, setAssignedOptions] = useState<{ id: string; label: string }[]>([])

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

  const loadAgenda = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let citasQuery = supabase
      .from('citas')
      .select('id, owner_id, start_at, tipo, nombre, telefono, direccion, ciudad, estado_region, zip, estado, assigned_to, contacto_tipo, contacto_id, notas, resultado, resultado_notas')

    if (role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
      citasQuery = citasQuery.or(`owner_id.eq.${session.user.id},assigned_to.eq.${session.user.id}`)
    }

    const rangeValue = getRange(range)
    if (rangeValue) {
      citasQuery = citasQuery.gte('start_at', rangeValue.start.toISOString()).lt('start_at', rangeValue.end.toISOString())
    }

    let serviciosQuery = supabase
      .from('servicios')
      .select('id, fecha_servicio, hora_cita, tipo_servicio, observaciones, vendedor_id, cliente:clientes(nombre, apellido, telefono, direccion, ciudad, estado_region)')

    if (role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
      serviciosQuery = serviciosQuery.eq('vendedor_id', session.user.id)
    }

    if (rangeValue) {
      const startDate = rangeValue.start.toLocaleDateString('en-CA')
      const endDate = rangeValue.end.toLocaleDateString('en-CA')
      serviciosQuery = serviciosQuery.gte('fecha_servicio', startDate).lt('fecha_servicio', endDate)
    }

    const [citasResult, serviciosResult] = await Promise.all([
      citasQuery.order('start_at', { ascending: true }),
      serviciosQuery.order('fecha_servicio', { ascending: true }).order('hora_cita', { ascending: true, nullsFirst: false }),
    ])

    if (citasResult.error || serviciosResult.error) {
      setError(citasResult.error?.message || serviciosResult.error?.message || 'No se pudieron cargar las citas.')
      setCitas([])
      setServicios([])
      setLoading(false)
      return
    }

    setCitas((citasResult.data as CitaRow[] | null) ?? [])
    setServicios((serviciosResult.data as ServicioRow[] | null) ?? [])
    setLoading(false)
  }, [configured, range, role, session?.user.id])

  useEffect(() => {
    if (configured) loadRole()
  }, [configured, loadRole])

  useEffect(() => {
    loadAgenda()
  }, [loadAgenda])

  useEffect(() => {
    if (!configured || !session?.user.id || !role) return
    const loadAssignedOptions = async () => {
      if (role === 'admin' || role === 'distribuidor') {
        let query = supabase
          .from('usuarios')
          .select('id, nombre, apellido, email')
          .eq('activo', true)
        if (hasDistribuidorScope && distributionUserIds.length > 0) {
          query = query.in('id', distributionUserIds)
        }
        const { data, error } = await query
        if (error) {
          setAssignedOptions([{ id: session.user.id, label: 'Yo' }])
          return
        }
        const options = (data ?? []).map((row) => {
          const name = [row.nombre, row.apellido].filter(Boolean).join(' ').trim()
          return {
            id: row.id,
            label: name || row.email || row.id,
          }
        })
        setAssignedOptions(options.length > 0 ? options : [{ id: session.user.id, label: 'Yo' }])
        return
      }
      setAssignedOptions([{ id: session.user.id, label: 'Yo' }])
    }
    void loadAssignedOptions()
  }, [configured, distributionUserIds, hasDistribuidorScope, role, session?.user.id])

  const openNewModal = () => {
    setActiveCita(null)
    setModalOpen(true)
  }

  const openEditModal = (cita: CitaRow) => {
    setActiveCita(cita)
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setActiveCita(null)
  }

  const openCompletarModal = (cita: CitaRow) => {
    setActiveCita({ ...cita, estado: 'completada' })
    setModalOpen(true)
  }

  const initialForm = useMemo<Partial<CitaForm>>(() => {
    if (!activeCita) {
      const now = new Date()
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      return {
        owner_id: session?.user.id ?? '',
        start_at: local.toISOString().slice(0, 16),
        tipo: 'servicio',
        estado: 'programada',
        assigned_to: session?.user.id ?? '',
      }
    }
    return {
      owner_id: activeCita.owner_id ?? (session?.user.id ?? ''),
      id: activeCita.id,
      start_at: activeCita.start_at ? toLocalInput(activeCita.start_at) : '',
      tipo: activeCita.tipo ?? 'servicio',
      estado: activeCita.estado ?? 'programada',
      notas: activeCita.notas ?? '',
      direccion: activeCita.direccion ?? '',
      ciudad: activeCita.ciudad ?? '',
      estado_region: activeCita.estado_region ?? '',
      zip: activeCita.zip ?? '',
      assigned_to: activeCita.assigned_to ?? (session?.user.id ?? ''),
      contacto_nombre: activeCita.nombre ?? '',
      contacto_telefono: activeCita.telefono ?? '',
      contacto_tipo: activeCita.contacto_tipo ?? 'cliente',
      contacto_id: activeCita.contacto_id ?? '',
      resultado: activeCita.resultado ?? '',
      resultado_notas: activeCita.resultado_notas ?? '',
    }
  }, [activeCita, session?.user.id])

  const agendaItems = useMemo<AgendaItem[]>(() => {
    const citaItems: AgendaItem[] = citas.map((cita) => ({
      id: cita.id,
      start_at: cita.start_at,
      tipo_evento: 'cita',
      titulo: cita.nombre || 'Sin nombre',
      telefono: cita.telefono ?? null,
      direccion: cita.direccion ?? null,
      ciudad: cita.ciudad ?? null,
      estado_region: cita.estado_region ?? null,
      estado: cita.estado ?? null,
      resultado: cita.resultado ?? null,
      tipo_label: cita.tipo ?? null,
      cita,
    }))

    const servicioItems: AgendaItem[] = servicios.map((servicio) => {
      const clienteRaw = Array.isArray(servicio.cliente) ? servicio.cliente[0] : servicio.cliente
      const clienteNombre = [clienteRaw?.nombre, clienteRaw?.apellido].filter(Boolean).join(' ').trim()
      return {
        id: servicio.id,
        start_at: buildServiceStartAt(servicio.fecha_servicio, servicio.hora_cita),
        tipo_evento: 'servicio',
        titulo: clienteNombre || 'Servicio sin cliente',
        telefono: clienteRaw?.telefono ?? null,
        direccion: clienteRaw?.direccion ?? null,
        ciudad: clienteRaw?.ciudad ?? null,
        estado_region: clienteRaw?.estado_region ?? null,
        estado: null,
        resultado: null,
        tipo_label: servicio.tipo_servicio ?? null,
        servicio,
      }
    })

    const toTime = (value: string | null) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY)
    return [...citaItems, ...servicioItems]
      .sort((a, b) => {
        const timeDiff = toTime(a.start_at) - toTime(b.start_at)
        if (timeDiff !== 0) return timeDiff
        return a.titulo.localeCompare(b.titulo)
      })
  }, [citas, servicios])

  const hasResults = agendaItems.length > 0

  return (
    <div className="page-stack">
      <SectionHeader
        title="Citas"
        subtitle="Agenda de visitas, demos y seguimientos"
        action={<Button onClick={openNewModal}>Nueva cita</Button>}
      />

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {RANGE_OPTIONS.map((option) => (
          <Button
            key={option.key}
            variant={range === option.key ? 'primary' : 'ghost'}
            type="button"
            onClick={() => setRange(option.key)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading && <div className="card" style={{ padding: '1rem' }}>Cargando agenda...</div>}
      {!loading && !hasResults && (
        <div className="card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
          <EmptyState
            title="No hay agenda en este rango"
            description="Crea una nueva cita o servicio, o cambia el filtro para ver otras programaciones."
          />
          <div>
            <Button onClick={openNewModal}>Nueva cita</Button>
          </div>
        </div>
      )}
      {hasResults && (
        <div className="citas-list" style={{ display: 'grid', gap: '0.75rem' }}>
          {agendaItems.map((item) => {
            const isServicio = item.tipo_evento === 'servicio'
            const nombre = item.titulo
            const telefono = item.telefono || ''
            const estadoLabel = isServicio ? 'servicio' : item.estado || 'programada'
            const addressParts = {
              direccion: item.direccion ?? '',
              ciudad: item.ciudad ?? '',
              estado_region: item.estado_region ?? '',
              codigo_postal: '',
            }
            const tipoLabel = item.tipo_label ? item.tipo_label.replace('_', ' ') : '-'
            return (
              <div key={item.id} className="card" style={{ padding: '0.9rem', display: 'grid', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <strong>{formatHour(item.start_at)}{item.start_at ? ` · ${formatDate(item.start_at)}` : ''}</strong>
                    <span>{nombre}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Badge label={isServicio ? 'Servicio' : estadoLabel} tone={isServicio ? 'neutral' : getEstadoTone(estadoLabel)} />
                    {!isServicio && item.resultado && <Badge label={item.resultado.replace('_', ' ')} tone="neutral" />}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: 'var(--color-text-muted, #6b7280)' }}>
                  <span>Tipo: {tipoLabel}</span>
                  <span>Ciudad: {[item.ciudad, item.estado_region].filter(Boolean).join(', ') || '-'}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {!isServicio && item.cita && (
                    <Button variant="ghost" onClick={() => openEditModal(item.cita!)}>
                      Abrir
                    </Button>
                  )}
                  {isServicio && (
                    <Button variant="ghost" onClick={() => navigate('/servicio-cliente')}>
                      Ver servicio
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const url = telefono ? buildWhatsappUrl(telefono, `Hola ${nombre}`) : null
                      if (url) window.open(url, '_blank', 'noopener,noreferrer')
                    }}
                    disabled={!telefono}
                  >
                    WhatsApp
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const url = buildMapsNavUrl(addressParts)
                      if (url) window.open(url, '_blank', 'noopener,noreferrer')
                    }}
                    disabled={!addressParts.direccion && !addressParts.ciudad && !addressParts.estado_region}
                  >
                    Navegar
                  </Button>
                  {!isServicio && item.cita && (
                    <Button
                      variant="ghost"
                      onClick={() => openCompletarModal(item.cita!)}
                      disabled={estadoLabel === 'completada'}
                    >
                      Completar
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CitaModal
        open={modalOpen}
        onClose={handleCloseModal}
        onSaved={loadAgenda}
        initialData={initialForm}
        assignedOptions={assignedOptions}
      />
    </div>
  )
}
