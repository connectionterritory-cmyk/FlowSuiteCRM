import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'
import { Badge } from './Badge'
import { Button } from './Button'

type CitaHoy = {
  id: string
  start_at: string | null
  tipo: string | null
  nombre: string | null
  estado: string | null
}

type ServicioHoy = {
  id: string
  fecha_servicio: string | null
  hora_cita: string | null
  tipo_servicio: string | null
  vendedor_id: string | null
  cliente:
    | {
        nombre: string | null
        apellido: string | null
      }
    | {
        nombre: string | null
        apellido: string | null
      }[]
    | null
}

type AgendaItemHoy = {
  id: string
  start_at: string | null
  tipo_evento: 'cita' | 'servicio'
  titulo: string
  tipo_label: string | null
  estado: string | null
}

const buildServiceStartAt = (fecha: string | null, hora: string | null) => {
  if (!fecha) return null
  const safeHora = (hora ?? '00:00').slice(0, 5)
  return `${fecha}T${safeHora}:00`
}

const formatHour = (value: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

const getEstadoTone = (estado: string): 'blue' | 'gold' | 'neutral' => {
  if (estado === 'completada' || estado === 'confirmada' || estado === 'en_camino') return 'blue'
  if (estado === 'cancelada' || estado === 'no_show') return 'neutral'
  return 'gold'
}

export function AgendaHoy() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const configured = isSupabaseConfigured
  const [citas, setCitas] = useState<CitaHoy[]>([])
  const [servicios, setServicios] = useState<ServicioHoy[]>([])
  const [loading, setLoading] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  const loadRole = useCallback(async () => {
    if (!configured || !session?.user.id) return
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
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    const startIso = start.toISOString()
    const endIso = end.toISOString()
    const startDate = startIso.split('T')[0]
    const endDate = endIso.split('T')[0]

    let citasQuery = supabase
      .from('citas')
      .select('id, start_at, tipo, nombre, estado')
      .gte('start_at', startIso)
      .lt('start_at', endIso)
      .order('start_at', { ascending: true })

    if (role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
      citasQuery = citasQuery.or(`owner_id.eq.${session.user.id},assigned_to.eq.${session.user.id}`)
    }

    let serviciosQuery = supabase
      .from('servicios')
      .select('id, fecha_servicio, hora_cita, tipo_servicio, vendedor_id, cliente:clientes(nombre, apellido)')
      .gte('fecha_servicio', startDate)
      .lt('fecha_servicio', endDate)
      .order('fecha_servicio', { ascending: true })
      .order('hora_cita', { ascending: true, nullsFirst: false })

    if (role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
      serviciosQuery = serviciosQuery.eq('vendedor_id', session.user.id)
    }

    const [citasResult, serviciosResult] = await Promise.all([citasQuery, serviciosQuery])

    setCitas((citasResult.data as CitaHoy[] | null) ?? [])
    setServicios((serviciosResult.data as ServicioHoy[] | null) ?? [])
    setLoading(false)
  }, [configured, role, session?.user.id])

  useEffect(() => {
    void loadRole()
  }, [loadRole])

  useEffect(() => {
    if (role !== null || !configured) void loadAgenda()
  }, [loadAgenda, role, configured])

  const items = useMemo<AgendaItemHoy[]>(() => {
    const citaItems: AgendaItemHoy[] = citas.map((c) => ({
      id: c.id,
      start_at: c.start_at,
      tipo_evento: 'cita',
      titulo: c.nombre || 'Sin nombre',
      tipo_label: c.tipo ?? null,
      estado: c.estado ?? null,
    }))

    const servicioItems: AgendaItemHoy[] = servicios.map((s) => {
      const clienteRaw = Array.isArray(s.cliente) ? s.cliente[0] : s.cliente
      const nombre = [clienteRaw?.nombre, clienteRaw?.apellido].filter(Boolean).join(' ').trim()
      return {
        id: s.id,
        start_at: buildServiceStartAt(s.fecha_servicio, s.hora_cita),
        tipo_evento: 'servicio',
        titulo: nombre || 'Servicio sin cliente',
        tipo_label: s.tipo_servicio ?? null,
        estado: null,
      }
    })

    const toTime = (v: string | null) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY)
    return [...citaItems, ...servicioItems]
      .sort((a, b) => toTime(a.start_at) - toTime(b.start_at))
      .slice(0, 8)
  }, [citas, servicios])

  if (!configured) return null

  return (
    <div className="card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Agenda de hoy</h3>
        <Button variant="ghost" onClick={() => navigate('/citas')}>
          Ver agenda completa
        </Button>
      </div>

      {loading && <p style={{ color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>Cargando...</p>}

      {!loading && items.length === 0 && (
        <p style={{ color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>Sin eventos para hoy.</p>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {items.map((item) => (
            <div
              key={`${item.tipo_evento}-${item.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0',
                borderBottom: '1px solid var(--color-border, #e5e7eb)',
              }}
            >
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: '3.5rem' }}>{formatHour(item.start_at)}</strong>
                <span>{item.titulo}</span>
                {item.tipo_label && (
                  <span style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.85em' }}>
                    · {item.tipo_label.replace('_', ' ')}
                  </span>
                )}
              </div>
              {item.tipo_evento === 'servicio' ? (
                <Badge label="Servicio" tone="neutral" />
              ) : (
                <Badge
                  label={item.estado || 'programada'}
                  tone={getEstadoTone(item.estado || 'programada')}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
