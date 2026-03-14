import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'
import { useUsers } from '../data/UsersProvider'
import { useViewMode } from '../data/ViewModeProvider'
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

type AgendaScope = {
  pending: boolean
  kind: 'none' | 'global' | 'self' | 'distribution'
  userId: string | null
  userIds: string[]
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

const resolveAgendaScope = ({
  configured,
  authLoading,
  userId,
  usersLoading,
  currentRole,
  hasDistribuidorScope,
  viewMode,
  distributionLoading,
  distributionUserIds,
}: {
  configured: boolean
  authLoading: boolean
  userId: string | null
  usersLoading: boolean
  currentRole: string | null
  hasDistribuidorScope: boolean
  viewMode: 'seller' | 'distributor'
  distributionLoading: boolean
  distributionUserIds: string[]
}): AgendaScope => {
  if (!configured) {
    return { pending: false, kind: 'none', userId: null, userIds: [] }
  }

  if (authLoading) {
    return { pending: true, kind: 'none', userId: null, userIds: [] }
  }

  if (!userId) {
    return { pending: false, kind: 'none', userId: null, userIds: [] }
  }

  if (usersLoading) {
    return { pending: true, kind: 'none', userId, userIds: [] }
  }

  if (currentRole === 'vendedor' || (hasDistribuidorScope && viewMode === 'seller')) {
    return { pending: false, kind: 'self', userId, userIds: [userId] }
  }

  if (hasDistribuidorScope && viewMode === 'distributor') {
    if (distributionLoading || distributionUserIds.length === 0) {
      return { pending: true, kind: 'distribution', userId, userIds: [] }
    }

    return {
      pending: false,
      kind: 'distribution',
      userId,
      userIds: distributionUserIds,
    }
  }

  if (!currentRole) {
    return { pending: false, kind: 'self', userId, userIds: [userId] }
  }

  return { pending: false, kind: 'global', userId, userIds: [] }
}

export function AgendaHoy() {
  const { session, loading: authLoading } = useAuth()
  const { currentRole, loading: usersLoading } = useUsers()
  const { viewMode, hasDistribuidorScope, distributionUserIds, distributionLoading } = useViewMode()
  const navigate = useNavigate()
  const configured = isSupabaseConfigured
  const [citas, setCitas] = useState<CitaHoy[]>([])
  const [servicios, setServicios] = useState<ServicioHoy[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scope = useMemo(
    () => resolveAgendaScope({
      configured,
      authLoading,
      userId: session?.user.id ?? null,
      usersLoading,
      currentRole,
      hasDistribuidorScope,
      viewMode,
      distributionLoading,
      distributionUserIds,
    }),
    [
      configured,
      authLoading,
      session?.user.id,
      usersLoading,
      currentRole,
      hasDistribuidorScope,
      viewMode,
      distributionLoading,
      distributionUserIds,
    ],
  )

  useEffect(() => {
    if (!configured) {
      setError(null)
      setCitas([])
      setServicios([])
      setLoading(false)
      return
    }

    if (scope.pending) {
      setLoading(true)
      return
    }

    if (scope.kind === 'none') {
      setError(null)
      setCitas([])
      setServicios([])
      setLoading(false)
      return
    }

    let active = true

    const loadAgenda = async () => {
      setLoading(true)
      setError(null)

      try {
        const now = new Date()
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(end.getDate() + 1)

        const startDate = start.toLocaleDateString('en-CA')
        const endDate = end.toLocaleDateString('en-CA')
        const startLocalDateTime = `${startDate}T00:00:00`
        const endLocalDateTime = `${endDate}T00:00:00`

        let citasQuery = supabase
          .from('citas')
          .select('id, start_at, tipo, nombre, estado')
          .gte('start_at', startLocalDateTime)
          .lt('start_at', endLocalDateTime)
          .order('start_at', { ascending: true })

        let serviciosQuery = supabase
          .from('servicios')
          .select('id, fecha_servicio, hora_cita, tipo_servicio, vendedor_id, cliente:clientes(nombre, apellido)')
          .gte('fecha_servicio', startDate)
          .lt('fecha_servicio', endDate)
          .order('fecha_servicio', { ascending: true })
          .order('hora_cita', { ascending: true, nullsFirst: false })

        if (scope.kind === 'self' && scope.userId) {
          citasQuery = citasQuery.or(`owner_id.eq.${scope.userId},assigned_to.eq.${scope.userId}`)
          serviciosQuery = serviciosQuery.eq('vendedor_id', scope.userId)
        } else if (scope.kind === 'distribution') {
          const ids = scope.userIds.join(',')
          citasQuery = citasQuery.or(`owner_id.in.(${ids}),assigned_to.in.(${ids})`)
          serviciosQuery = serviciosQuery.in('vendedor_id', scope.userIds)
        }

        const [citasResult, serviciosResult] = await Promise.all([citasQuery, serviciosQuery])
        const fetchError = citasResult.error || serviciosResult.error
        if (fetchError) {
          throw new Error(fetchError.message ?? 'Error loading dashboard agenda')
        }

        if (!active) return

        setCitas((citasResult.data as CitaHoy[] | null) ?? [])
        setServicios((serviciosResult.data as ServicioHoy[] | null) ?? [])
      } catch (nextError) {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : 'Error loading dashboard agenda')
        setCitas([])
        setServicios([])
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadAgenda()

    return () => {
      active = false
    }
  }, [configured, scope])

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

    const toTime = (value: string | null) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY)
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

      {!loading && error && (
        <p style={{ color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>No se pudo cargar la agenda.</p>
      )}

      {!loading && !error && items.length === 0 && (
        <p style={{ color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>Sin eventos para hoy.</p>
      )}

      {!loading && !error && items.length > 0 && (
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
                    · {item.tipo_label.replace(/_/g, ' ')}
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
