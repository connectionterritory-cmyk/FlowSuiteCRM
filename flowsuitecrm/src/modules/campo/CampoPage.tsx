import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeader } from '../../components/SectionHeader'
import { EmptyState } from '../../components/EmptyState'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useViewMode } from '../../data/useViewMode'
import { buildWhatsappUrl } from '../../lib/whatsappTemplates'
import { buildMapsNavUrl } from '../../lib/addressUtils'
import { NearbyContactsPanel, type NearbyPanelState } from '../../components/NearbyContactsPanel'

type FieldItem = {
  id: string
  tipo: 'cita' | 'cliente' | 'lead'
  nombre: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  zip: string | null
  start_at?: string | null
  estado?: string | null
  hasCoords?: boolean
}

type RawCitaRow = {
  id: string
  nombre: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  zip: string | null
  start_at: string | null
  estado: string | null
}

type RawBaseRow = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
}

type RawClienteRow = RawBaseRow & { lat: number | string | null; lng: number | string | null }

function parseCoord(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string') { const n = parseFloat(v); return isFinite(n) ? n : null }
  return null
}

function fullName(row: RawBaseRow): string {
  return [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Sin nombre'
}

function buildMultiStopMapsUrl(items: FieldItem[]): string | null {
  const addrs = items
    .filter(i => i.direccion)
    .map(i => [i.direccion, i.ciudad, i.estado_region, i.zip].filter(Boolean).join(', '))
  if (addrs.length < 2) return null
  return 'https://www.google.com/maps/dir/' + addrs.map(a => encodeURIComponent(a)).join('/')
}

function formatHora(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

const TIPO_LABEL: Record<FieldItem['tipo'], string> = {
  cita: 'Cita',
  cliente: 'Cliente',
  lead: 'Prospecto',
}

const TIPO_BG: Record<FieldItem['tipo'], string> = {
  cita: '#2563eb',
  cliente: '#10b981',
  lead: '#f59e0b',
}

function FieldCard({ item, onNearby }: { item: FieldItem; onNearby: (item: FieldItem) => void }) {
  const waUrl = item.telefono ? buildWhatsappUrl(item.telefono, `Hola ${item.nombre}`) : null
  const mapsUrl = buildMapsNavUrl({
    direccion: item.direccion,
    ciudad: item.ciudad,
    estado_region: item.estado_region,
    codigo_postal: item.zip,
  })
  const addressLabel = [item.direccion, item.ciudad, item.estado_region, item.zip].filter(Boolean).join(', ')
  return (
    <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid #e5e7eb', borderRadius: '0.625rem', padding: '0.875rem 1rem', display: 'grid', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#111827', flex: 1, minWidth: 0, lineHeight: 1.3 }}>{item.nombre}</span>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff', background: TIPO_BG[item.tipo], borderRadius: '9999px', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}>
          {TIPO_LABEL[item.tipo]}
        </span>
        {item.hasCoords && (
          <span title="Coordenadas GPS disponibles" style={{ fontSize: '0.68rem', fontWeight: 600, color: '#059669', background: '#d1fae5', borderRadius: '9999px', padding: '0.15rem 0.45rem', whiteSpace: 'nowrap' }}>
            📍 GPS
          </span>
        )}
      </div>
      {item.start_at && (
        <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>
          🕐 {formatHora(item.start_at)}{item.estado ? ` · ${item.estado}` : ''}
        </div>
      )}
      {item.telefono && (
        <div style={{ fontSize: '0.8rem', color: '#374151' }}>📞 {item.telefono}</div>
      )}
      {addressLabel && (
        <div style={{ fontSize: '0.78rem', color: '#4b5563', lineHeight: 1.4 }}>{addressLabel}</div>
      )}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.3rem 0.7rem', background: '#25d366', color: '#fff', borderRadius: '0.375rem', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
            WA
          </a>
        )}
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.3rem 0.7rem', background: 'var(--color-primary, #2563eb)', color: '#fff', borderRadius: '0.375rem', fontSize: '0.78rem', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
            🗺 Navegar
          </a>
        )}
        {(item.zip || item.ciudad) && (
          <button
            type="button"
            onClick={() => onNearby(item)}
            style={{ padding: '0.3rem 0.7rem', background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
          >
            Cercanos
          </button>
        )}
      </div>
    </div>
  )
}

const TIPO_OPTS = [
  { key: 'all', label: 'Todo' },
  { key: 'cita', label: 'Citas' },
  { key: 'cliente', label: 'Clientes' },
  { key: 'lead', label: 'Prospectos' },
] as const

type TipoFilter = (typeof TIPO_OPTS)[number]['key']

export function CampoPage() {
  const { session } = useAuth()
  const configured = isSupabaseConfigured
  const { distributionUserIds, hasDistribuidorScope } = useViewMode()
  const sessionUserId = session?.user.id ?? null

  const [role, setRole] = useState<string | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [citas, setCitas] = useState<FieldItem[]>([])
  const [clientes, setClientes] = useState<FieldItem[]>([])
  const [leads, setLeads] = useState<FieldItem[]>([])
  const [filterTipo, setFilterTipo] = useState<TipoFilter>('all')
  const [filterZip, setFilterZip] = useState('')
  const [filterCiudad, setFilterCiudad] = useState('')
  const [nearbyPanel, setNearbyPanel] = useState<NearbyPanelState | null>(null)

  useEffect(() => {
    if (!configured || !sessionUserId) { setRole(null); setRoleLoaded(true); return }
    void supabase.from('usuarios').select('rol').eq('id', sessionUserId).maybeSingle().then(({ data }) => {
      setRole((data as { rol?: string } | null)?.rol ?? null)
      setRoleLoaded(true)
    })
  }, [configured, sessionUserId])

  const load = useCallback(async () => {
    if (!configured || !sessionUserId || !roleLoaded) return
    setLoading(true)

    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)

    const isGlobalRole = role === 'admin' || role === 'distribuidor' || role === 'supervisor_telemercadeo'

    let citasQ = supabase
      .from('citas')
      .select('id, nombre, telefono, direccion, ciudad, estado_region, zip, start_at, estado')
      .gte('start_at', todayStart.toISOString())
      .lt('start_at', todayEnd.toISOString())
      .order('start_at', { ascending: true })

    if (!isGlobalRole) {
      citasQ = citasQ.or(`owner_id.eq.${sessionUserId},assigned_to.eq.${sessionUserId}`)
    } else if (hasDistribuidorScope && distributionUserIds.length) {
      citasQ = citasQ.in('owner_id', [sessionUserId, ...distributionUserIds])
    }

    const { data: citasRaw } = await citasQ.limit(50)
    const citaItems: FieldItem[] = (citasRaw ?? []).map((c: RawCitaRow) => ({
      id: c.id,
      tipo: 'cita' as const,
      nombre: c.nombre ?? 'Sin nombre',
      telefono: c.telefono ?? null,
      direccion: c.direccion ?? null,
      ciudad: c.ciudad ?? null,
      estado_region: c.estado_region ?? null,
      zip: c.zip ?? null,
      start_at: c.start_at ?? null,
      estado: c.estado ?? null,
    }))
    setCitas(citaItems)

    const manualZip = filterZip.trim()
    const manualCiudad = filterCiudad.trim().toLowerCase()

    const zipList = manualZip
      ? [manualZip]
      : Array.from(new Set(citaItems.map(c => c.zip).filter((z): z is string => Boolean(z))))

    const cityList = manualCiudad
      ? [manualCiudad]
      : Array.from(new Set(citaItems.map(c => c.ciudad?.toLowerCase()).filter((c): c is string => Boolean(c))))

    if (zipList.length === 0 && cityList.length === 0) {
      setClientes([])
      setLeads([])
      setLoading(false)
      return
    }

    const selBase = 'id, nombre, apellido, telefono, direccion, ciudad, estado_region, codigo_postal'
    const selCliente = `${selBase}, lat, lng`

    const buildContactQ = (table: string, sel: string) => {
      let q = supabase.from(table).select(sel)
      if (table === 'leads') q = q.is('deleted_at', null)
      if (zipList.length) return q.in('codigo_postal', zipList)
      return q.ilike('ciudad', cityList[0])
    }

    const [{ data: clientesRaw }, { data: leadsRaw }] = await Promise.all([
      buildContactQ('clientes', selCliente).limit(75),
      buildContactQ('leads', selBase).limit(50),
    ])

    setClientes((clientesRaw ?? []).map((r: RawClienteRow) => ({
      id: r.id,
      tipo: 'cliente' as const,
      nombre: fullName(r),
      telefono: r.telefono ?? null,
      direccion: r.direccion ?? null,
      ciudad: r.ciudad ?? null,
      estado_region: r.estado_region ?? null,
      zip: r.codigo_postal ?? null,
      hasCoords: parseCoord(r.lat) !== null && parseCoord(r.lng) !== null,
    })))

    setLeads((leadsRaw ?? []).map((r: RawBaseRow) => ({
      id: r.id,
      tipo: 'lead' as const,
      nombre: fullName(r),
      telefono: r.telefono ?? null,
      direccion: r.direccion ?? null,
      ciudad: r.ciudad ?? null,
      estado_region: r.estado_region ?? null,
      zip: r.codigo_postal ?? null,
    })))

    setLoading(false)
  }, [configured, sessionUserId, roleLoaded, role, hasDistribuidorScope, distributionUserIds, filterZip, filterCiudad])

  useEffect(() => {
    void load()
  }, [load])

  const filteredCitas = useMemo(
    () => (filterTipo === 'all' || filterTipo === 'cita' ? citas : []),
    [citas, filterTipo]
  )
  const filteredClientes = useMemo(
    () => (filterTipo === 'all' || filterTipo === 'cliente' ? clientes : []),
    [clientes, filterTipo]
  )
  const filteredLeads = useMemo(
    () => (filterTipo === 'all' || filterTipo === 'lead' ? leads : []),
    [leads, filterTipo]
  )

  const allItems = useMemo(
    () => [...filteredCitas, ...filteredClientes, ...filteredLeads],
    [filteredCitas, filteredClientes, filteredLeads]
  )

  const routeUrl = useMemo(() => buildMultiStopMapsUrl(allItems), [allItems])

  const handleNearby = useCallback((item: FieldItem) => {
    setNearbyPanel({
      contactoNombre: item.nombre,
      mapsUrl: buildMapsNavUrl({
        direccion: item.direccion,
        ciudad: item.ciudad,
        estado_region: item.estado_region,
        codigo_postal: item.zip,
      }),
      zip: item.zip ?? null,
      ciudad: item.ciudad ?? null,
      baseId: item.tipo !== 'cita' ? item.id : undefined,
      baseTipo: item.tipo !== 'cita' ? item.tipo : undefined,
    })
  }, [])

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.3rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: active ? 'none' : '1px solid #d1d5db',
    background: active ? 'var(--color-primary, #2563eb)' : 'transparent',
    color: active ? '#fff' : '#374151',
  })

  const sectionHeader = (label: string, count: number) => (
    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
      {label} · {count}
    </div>
  )

  return (
    <div className="page">
      <SectionHeader
        title="Ruta del día"
        subtitle={loading ? 'Cargando...' : `${allItems.length} contactos`}
        action={
          routeUrl ? (
            <a
              href={routeUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: '0.45rem 0.9rem', background: 'var(--color-primary, #2563eb)', color: '#fff', borderRadius: '0.5rem', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            >
              🗺 Ruta completa
            </a>
          ) : undefined
        }
      />

      {/* Filter bar */}
      <div style={{ padding: '0 1rem 0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
          {TIPO_OPTS.map(opt => (
            <button key={opt.key} type="button" onClick={() => setFilterTipo(opt.key)} style={pillStyle(filterTipo === opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="ZIP"
          value={filterZip}
          onChange={e => setFilterZip(e.target.value)}
          style={{ padding: '0.3rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.82rem', width: '80px', outline: 'none' }}
        />
        <input
          type="text"
          placeholder="Ciudad"
          value={filterCiudad}
          onChange={e => setFilterCiudad(e.target.value)}
          style={{ padding: '0.3rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.82rem', width: '120px', outline: 'none' }}
        />
        <button
          type="button"
          onClick={() => void load()}
          style={{ padding: '0.3rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', background: 'transparent', color: '#374151' }}
        >
          Buscar
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '0 1rem 4rem', display: 'grid', gap: '1.5rem' }}>
        {loading ? (
          <div style={{ color: '#6b7280', fontSize: '0.875rem', padding: '2rem 0' }}>Cargando...</div>
        ) : allItems.length === 0 ? (
          <EmptyState
            title="Sin contactos"
            description="No hay citas hoy ni contactos cercanos. Ingresa un ZIP o ciudad para buscar."
          />
        ) : (
          <>
            {filteredCitas.length > 0 && (
              <section>
                {sectionHeader('Citas de hoy', filteredCitas.length)}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {filteredCitas.map(item => (
                    <FieldCard key={`cita-${item.id}`} item={item} onNearby={handleNearby} />
                  ))}
                </div>
              </section>
            )}
            {filteredClientes.length > 0 && (
              <section>
                {sectionHeader('Clientes cercanos', filteredClientes.length)}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {filteredClientes.map(item => (
                    <FieldCard key={`cliente-${item.id}`} item={item} onNearby={handleNearby} />
                  ))}
                </div>
              </section>
            )}
            {filteredLeads.length > 0 && (
              <section>
                {sectionHeader('Prospectos cercanos', filteredLeads.length)}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {filteredLeads.map(item => (
                    <FieldCard key={`lead-${item.id}`} item={item} onNearby={handleNearby} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {nearbyPanel && (
        <NearbyContactsPanel
          {...nearbyPanel}
          onClose={() => setNearbyPanel(null)}
        />
      )}
    </div>
  )
}
