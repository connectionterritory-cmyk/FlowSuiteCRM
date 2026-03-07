import { useCallback, useEffect, useState } from 'react'
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

    let query = supabase
      .from('citas')
      .select('id, start_at, tipo, nombre, estado')
      .gte('start_at', start.toISOString())
      .lt('start_at', end.toISOString())
      .order('start_at', { ascending: true })
      .limit(8)

    if (role !== 'admin' && role !== 'distribuidor' && session?.user.id) {
      query = query.or(`owner_id.eq.${session.user.id},assigned_to.eq.${session.user.id}`)
    }

    const { data } = await query
    setCitas((data as CitaHoy[] | null) ?? [])
    setLoading(false)
  }, [configured, role, session?.user.id])

  useEffect(() => {
    void loadRole()
  }, [loadRole])

  useEffect(() => {
    if (role !== null || !configured) void loadAgenda()
  }, [loadAgenda, role, configured])

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

      {!loading && citas.length === 0 && (
        <p style={{ color: 'var(--color-text-muted, #6b7280)', margin: 0 }}>Sin citas para hoy.</p>
      )}

      {!loading && citas.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {citas.map((cita) => (
            <div
              key={cita.id}
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
                <strong style={{ minWidth: '3.5rem' }}>{formatHour(cita.start_at)}</strong>
                <span>{cita.nombre || 'Sin nombre'}</span>
                {cita.tipo && (
                  <span style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.85em' }}>
                    · {cita.tipo}
                  </span>
                )}
              </div>
              <Badge
                label={cita.estado || 'programada'}
                tone={getEstadoTone(cita.estado || 'programada')}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
