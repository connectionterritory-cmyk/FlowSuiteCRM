import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useViewMode } from '../../data/useViewMode'
import { buildWhatsappUrl } from '../../lib/whatsappTemplates'
import { buildMapsNavUrl } from '../../lib/addressUtils'
import { isContactKind } from '../../lib/contactRefs'
import { useModalHost } from '../../modals/useModalHost'
import type { CitaForm } from './CitaModal'

type CitaRow = {
  id: string
  owner_id: string | null
  start_at: string | null
  tipo: string | null
  nombre: string | null
  telefono: string | null
  direccion: string | null
  apartamento: string | null
  ciudad: string | null
  estado_region: string | null
  zip: string | null
  timezone: string | null
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

type NearbyContact = {
  id: string
  tipo: 'cliente' | 'lead'
  nombre: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  zip: string | null
}

function NearbyRow({ contact }: { contact: NearbyContact }) {
  const waUrl = contact.telefono ? buildWhatsappUrl(contact.telefono, `Hola ${contact.nombre}`) : null
  const navUrl = buildMapsNavUrl({
    direccion: contact.direccion,
    ciudad: contact.ciudad,
    estado_region: contact.estado_region,
    codigo_postal: contact.zip,
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--color-surface-raised, #f8fafc)', borderRadius: '0.5rem' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{contact.nombre}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)' }}>
          {contact.tipo === 'lead' ? 'Prospecto' : 'Cliente'}{contact.telefono ? ` · ${contact.telefono}` : ''}
        </div>
        {contact.direccion && (
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)' }}>{contact.direccion}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.3rem 0.6rem', background: '#25d366', color: '#fff', borderRadius: '0.375rem', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 500 }}>
            WA
          </a>
        )}
        {navUrl && (
          <a href={navUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.3rem 0.6rem', background: 'var(--color-primary, #2563eb)', color: '#fff', borderRadius: '0.375rem', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 500 }}>
            🗺
          </a>
        )}
      </div>
    </div>
  )
}

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
  const { openCitaModal } = useModalHost()
  const sessionUserId = session?.user.id ?? null
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('hoy')
  const [citas, setCitas] = useState<CitaRow[]>([])
  const [servicios, setServicios] = useState<ServicioRow[]>([])
  const [assignedOptions, setAssignedOptions] = useState<{ id: string; label: string }[]>([])
  const [nearbyPanel, setNearbyPanel] = useState<{ citaNombre: string; mapsUrl: string | null; zip: string | null; ciudad: string | null } | null>(null)
  const [nearbyData, setNearbyData] = useState<{ byZip: NearbyContact[]; byCity: NearbyContact[] } | null>(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)

  const loadRole = useCallback(async () => {
    if (!configured || !sessionUserId) {
      setRole(null)
      return
    }
    const { data } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', sessionUserId)
      .maybeSingle()
    setRole((data as { rol?: string } | null)?.rol ?? null)
  }, [configured, sessionUserId])

  const loadAgenda = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    let citasQuery = supabase
      .from('citas')
      .select('id, owner_id, start_at, tipo, nombre, telefono, direccion, apartamento, ciudad, estado_region, zip, timezone, estado, assigned_to, contacto_tipo, contacto_id, notas, resultado, resultado_notas')

    const isGlobalRole = role === 'admin' || role === 'distribuidor' || role === 'supervisor_telemercadeo'
    if (!isGlobalRole && sessionUserId) {
      if (role === 'telemercadeo') {
        // telemercadeo: citas propias + citas de sus vendedores asignados
        const { data: assignments } = await supabase
          .from('tele_vendedor_assignments')
          .select('vendedor_id')
          .eq('tele_id', sessionUserId)
        const vendedorIds = (assignments ?? []).map((a: { vendedor_id: string }) => a.vendedor_id)
        const allIds = [sessionUserId, ...vendedorIds]
        const orClause = allIds.map(id => `owner_id.eq.${id},assigned_to.eq.${id}`).join(',')
        citasQuery = citasQuery.or(orClause)
      } else {
        citasQuery = citasQuery.or(`owner_id.eq.${sessionUserId},assigned_to.eq.${sessionUserId}`)
      }
    }

    const rangeValue = getRange(range)
    if (rangeValue) {
      citasQuery = citasQuery.gte('start_at', rangeValue.start.toISOString()).lt('start_at', rangeValue.end.toISOString())
    }

    let serviciosQuery = supabase
      .from('servicios')
      .select('id, fecha_servicio, hora_cita, tipo_servicio, observaciones, vendedor_id, cliente:clientes(nombre, apellido, telefono, direccion, ciudad, estado_region)')

    if (!isGlobalRole && sessionUserId) {
      serviciosQuery = serviciosQuery.eq('vendedor_id', sessionUserId)
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
  }, [configured, range, role, sessionUserId])

  useEffect(() => {
    if (!configured) return
    const handle = window.setTimeout(() => {
      void loadRole()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [configured, loadRole])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadAgenda()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [loadAgenda])

  useEffect(() => {
    if (!configured || !sessionUserId || !role) return
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
          setAssignedOptions([{ id: sessionUserId, label: 'Yo' }])
          return
        }
        const options = (data ?? []).map((row) => {
          const name = [row.nombre, row.apellido].filter(Boolean).join(' ').trim()
          return {
            id: row.id,
            label: name || row.email || row.id,
          }
        })
        setAssignedOptions(options.length > 0 ? options : [{ id: sessionUserId, label: 'Yo' }])
        return
      }
      // telemercadeo: ve sus vendedores asignados + sí mismo
      if (role === 'telemercadeo') {
        const { data: assignments } = await supabase
          .from('tele_vendedor_assignments')
          .select('vendedor_id')
          .eq('tele_id', sessionUserId)
        const vendedorIds = (assignments ?? []).map((a: { vendedor_id: string }) => a.vendedor_id)
        if (vendedorIds.length > 0) {
          const { data: vendedores } = await supabase
            .from('usuarios')
            .select('id, nombre, apellido, email')
            .in('id', vendedorIds)
            .eq('activo', true)
          const options = [
            { id: sessionUserId, label: 'Yo' },
            ...(vendedores ?? []).map((row: { id: string; nombre: string | null; apellido: string | null; email: string | null }) => ({
              id: row.id,
              label: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.email || row.id,
            })),
          ]
          setAssignedOptions(options)
          return
        }
      }

      // supervisor_telemercadeo: ve todos los usuarios activos
      if (role === 'supervisor_telemercadeo') {
        const { data } = await supabase
          .from('usuarios')
          .select('id, nombre, apellido, email')
          .eq('activo', true)
        const options = (data ?? []).map((row: { id: string; nombre: string | null; apellido: string | null; email: string | null }) => ({
          id: row.id,
          label: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || row.email || row.id,
        }))
        setAssignedOptions(options.length > 0 ? options : [{ id: sessionUserId, label: 'Yo' }])
        return
      }

      setAssignedOptions([{ id: sessionUserId, label: 'Yo' }])
    }
    void loadAssignedOptions()
  }, [configured, distributionUserIds, hasDistribuidorScope, role, sessionUserId])

  const buildInitialForm = useCallback((cita?: CitaRow, estado?: string): Partial<CitaForm> => {
    if (!cita) {
      const now = new Date()
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      return {
        owner_id: sessionUserId ?? '',
        start_at: local.toISOString().slice(0, 16),
        tipo: 'servicio',
        estado: estado ?? 'programada',
        assigned_to: sessionUserId ?? '',
      }
    }
    return {
      owner_id: cita.owner_id ?? (sessionUserId ?? ''),
      id: cita.id,
      start_at: cita.start_at ? toLocalInput(cita.start_at) : '',
      tipo: cita.tipo ?? 'servicio',
      estado: estado ?? cita.estado ?? 'programada',
      notas: cita.notas ?? '',
      direccion: cita.direccion ?? '',
      apartamento: cita.apartamento ?? '',
      ciudad: cita.ciudad ?? '',
      estado_region: cita.estado_region ?? '',
      zip: cita.zip ?? '',
      timezone: cita.timezone ?? undefined,
      assigned_to: cita.assigned_to ?? (sessionUserId ?? ''),
      contacto_nombre: cita.nombre ?? '',
      contacto_telefono: cita.telefono ?? '',
      contacto_tipo: isContactKind(cita.contacto_tipo) ? cita.contacto_tipo : 'cliente',
      contacto_id: cita.contacto_id ?? '',
      resultado: cita.resultado ?? '',
      resultado_notas: cita.resultado_notas ?? '',
    }
  }, [sessionUserId])

  const openNewModal = useCallback(() => {
    openCitaModal({
      initialData: buildInitialForm(),
      assignedOptions,
      onSaved: () => {
        void loadAgenda()
      },
    })
  }, [assignedOptions, buildInitialForm, loadAgenda, openCitaModal])

  const openEditModal = useCallback((cita: CitaRow) => {
    openCitaModal({
      initialData: buildInitialForm(cita),
      assignedOptions,
      onSaved: () => {
        void loadAgenda()
      },
    })
  }, [assignedOptions, buildInitialForm, loadAgenda, openCitaModal])

  const openCompletarModal = useCallback((cita: CitaRow) => {
    openCitaModal({
      initialData: buildInitialForm(cita, 'completada'),
      assignedOptions,
      onSaved: () => {
        void loadAgenda()
      },
    })
  }, [assignedOptions, buildInitialForm, loadAgenda, openCitaModal])

  const loadNearby = useCallback(async (zip: string | null, ciudad: string | null) => {
    setNearbyLoading(true)
    setNearbyData(null)
    const nZip = zip?.trim() || null
    const nCity = ciudad?.trim().toLowerCase() || null
    if (!nZip && !nCity) {
      setNearbyData({ byZip: [], byCity: [] })
      setNearbyLoading(false)
      return
    }
    type RawRow = { id: string; nombre: string | null; apellido: string | null; telefono: string | null; direccion: string | null; ciudad: string | null; estado_region: string | null; codigo_postal: string | null }
    const toContact = (row: RawRow, tipo: 'cliente' | 'lead'): NearbyContact => ({
      id: row.id,
      tipo,
      nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Sin nombre',
      telefono: row.telefono ?? null,
      direccion: row.direccion ?? null,
      ciudad: row.ciudad ?? null,
      estado_region: row.estado_region ?? null,
      zip: row.codigo_postal ?? null,
    })
    const sel = 'id, nombre, apellido, telefono, direccion, ciudad, estado_region, codigo_postal'
    const [zipC, cityC, zipL, cityL] = await Promise.all([
      nZip ? supabase.from('clientes').select(sel).eq('codigo_postal', nZip).limit(25) : Promise.resolve({ data: [] as RawRow[], error: null }),
      nCity ? supabase.from('clientes').select(sel).ilike('ciudad', nCity).limit(25) : Promise.resolve({ data: [] as RawRow[], error: null }),
      nZip ? supabase.from('leads').select(sel).eq('codigo_postal', nZip).is('deleted_at', null).limit(15) : Promise.resolve({ data: [] as RawRow[], error: null }),
      nCity ? supabase.from('leads').select(sel).ilike('ciudad', nCity).is('deleted_at', null).limit(15) : Promise.resolve({ data: [] as RawRow[], error: null }),
    ])
    const seen = new Set<string>()
    const byZip: NearbyContact[] = []
    for (const row of ((zipC.data ?? []) as RawRow[])) {
      const key = `c-${row.id}`; seen.add(key); byZip.push(toContact(row, 'cliente'))
    }
    for (const row of ((zipL.data ?? []) as RawRow[])) {
      const key = `l-${row.id}`; seen.add(key); byZip.push(toContact(row, 'lead'))
    }
    const byCity: NearbyContact[] = []
    for (const row of ((cityC.data ?? []) as RawRow[])) {
      const key = `c-${row.id}`; if (seen.has(key)) continue; seen.add(key); byCity.push(toContact(row, 'cliente'))
    }
    for (const row of ((cityL.data ?? []) as RawRow[])) {
      const key = `l-${row.id}`; if (seen.has(key)) continue; seen.add(key); byCity.push(toContact(row, 'lead'))
    }
    setNearbyData({ byZip, byCity })
    setNearbyLoading(false)
  }, [])

  const openNearbyPanel = useCallback((item: AgendaItem, mapsUrl: string | null) => {
    const zip = item.cita?.zip ?? null
    const ciudad = item.ciudad ?? null
    setNearbyPanel({ citaNombre: item.titulo, mapsUrl, zip, ciudad })
    void loadNearby(zip, ciudad)
  }, [loadNearby])

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

  const assignedLabels = useMemo(() => {
    const map = new Map<string, string>()
    assignedOptions.forEach((option) => {
      map.set(option.id, option.label)
    })
    if (sessionUserId && !map.has(sessionUserId)) {
      map.set(sessionUserId, 'Yo')
    }
    return map
  }, [assignedOptions, sessionUserId])

  const getAssignedLabel = useCallback((item: AgendaItem) => {
    if (item.tipo_evento === 'cita') {
      const assignedId = item.cita?.assigned_to ?? item.cita?.owner_id ?? null
      if (!assignedId) return 'Sin asignar'
      return assignedLabels.get(assignedId) ?? 'Asignado'
    }
    const assignedId = item.servicio?.vendedor_id ?? null
    if (!assignedId) return 'Sin asignar'
    return assignedLabels.get(assignedId) ?? 'Asignado'
  }, [assignedLabels])

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
              codigo_postal: item.cita?.zip ?? '',
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
                  <span>Asignado: {getAssignedLabel(item)}</span>
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
                    onClick={() => openNearbyPanel(item, buildMapsNavUrl(addressParts))}
                    disabled={!addressParts.direccion && !addressParts.ciudad && !addressParts.estado_region && !addressParts.codigo_postal}
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

      {nearbyPanel && (
        <>
          <div
            role="presentation"
            onClick={() => setNearbyPanel(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              bottom: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              width: '100%',
              maxWidth: '540px',
              maxHeight: '80vh',
              overflowY: 'auto',
              background: 'var(--color-surface, #fff)',
              borderRadius: '1rem 1rem 0 0',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
              zIndex: 1001,
              padding: '1.25rem',
              display: 'grid',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '1rem' }}>Cercanos · {nearbyPanel.citaNombre}</strong>
              <Button variant="ghost" onClick={() => setNearbyPanel(null)}>✕</Button>
            </div>

            {nearbyPanel.mapsUrl ? (
              <a
                href={nearbyPanel.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', padding: '0.75rem 1rem', background: 'var(--color-primary, #2563eb)', color: '#fff', borderRadius: '0.5rem', textAlign: 'center', textDecoration: 'none', fontWeight: 600 }}
              >
                🗺 Abrir en Maps
              </a>
            ) : (
              <div style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.875rem' }}>
                No hay dirección disponible para navegar.
              </div>
            )}

            {nearbyLoading && (
              <div style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.875rem' }}>
                Buscando contactos cercanos...
              </div>
            )}

            {!nearbyLoading && nearbyData && !nearbyPanel.zip && !nearbyPanel.ciudad && (
              <div style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.875rem' }}>
                No hay suficientes datos de ubicación para sugerir contactos cercanos.
              </div>
            )}

            {!nearbyLoading && nearbyData && (nearbyPanel.zip || nearbyPanel.ciudad) && (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {nearbyData.byZip.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                      Mismo ZIP · {nearbyPanel.zip}
                    </div>
                    <div style={{ display: 'grid', gap: '0.4rem' }}>
                      {nearbyData.byZip.map(c => <NearbyRow key={`${c.tipo}-${c.id}`} contact={c} />)}
                    </div>
                  </div>
                )}
                {nearbyData.byCity.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                      Misma ciudad · {nearbyPanel.ciudad}
                    </div>
                    <div style={{ display: 'grid', gap: '0.4rem' }}>
                      {nearbyData.byCity.map(c => <NearbyRow key={`${c.tipo}-${c.id}`} contact={c} />)}
                    </div>
                  </div>
                )}
                {nearbyData.byZip.length === 0 && nearbyData.byCity.length === 0 && (
                  <div style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.875rem' }}>
                    No se encontraron contactos con el mismo ZIP o ciudad.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
