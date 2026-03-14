import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { useUsers } from '../data/UsersProvider'

type ContactoActividad = {
  id: string
  tipo: string
  resumen: string | null
  contenido: string | null
  metadata: Record<string, unknown> | null
  autor_id: string
  fecha_actividad: string
  created_at: string
}

type ContactoTimelineProps = {
  contactoTipo: 'lead' | 'cliente'
  contactoId: string
  limit?: number
  emptyLabel?: string
}

const tipoLabel: Record<string, string> = {
  visita: 'Visita',
  llamada: 'Llamada',
  nota: 'Nota',
  cita_completada: 'Cita completada',
  referidos: 'Referidos',
  venta: 'Venta',
  seguimiento: 'Seguimiento',
  envio_material: 'Envío de material',
}

const pillStyle: CSSProperties = {
  padding: '0.2rem 0.5rem',
  borderRadius: '999px',
  background: 'rgba(59,130,246,0.12)',
  color: '#93c5fd',
  fontSize: '0.72rem',
  fontWeight: 700,
}

function renderMetadataBadges(metadata: Record<string, unknown> | null) {
  if (!metadata) return []
  const badges: string[] = []
  if (metadata.demo_realizada) badges.push('Demo realizada')
  if (metadata.muestra_entregada) badges.push('Muestra entregada')
  if (metadata.referidos_obtenidos) {
    const count = typeof metadata.referidos_count === 'number' ? metadata.referidos_count : null
    badges.push(count ? `${count} referidos` : 'Referidos obtenidos')
  }
  if (Array.isArray(metadata.productos_interes) && metadata.productos_interes.length > 0) {
    badges.push(`Interés: ${metadata.productos_interes.join(', ')}`)
  }
  if (typeof metadata.resultado === 'string' && metadata.resultado) {
    badges.push(`Resultado: ${metadata.resultado.replace(/_/g, ' ')}`)
  }
  return badges
}

export function ContactoTimeline({ contactoTipo, contactoId, limit = 10, emptyLabel = 'Sin historial todavía' }: ContactoTimelineProps) {
  const { usersById } = useUsers()
  const [items, setItems] = useState<ContactoActividad[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      if (!contactoId) {
        setItems([])
        return
      }
      setLoading(true)
      const { data, error } = await supabase
        .from('contacto_actividades')
        .select('id, tipo, resumen, contenido, metadata, autor_id, fecha_actividad, created_at')
        .eq('contacto_tipo', contactoTipo)
        .eq('contacto_id', contactoId)
        .order('fecha_actividad', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)
      if (!active) return
      if (error) {
        setItems([])
      } else {
        setItems((data as ContactoActividad[] | null) ?? [])
      }
      setLoading(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [contactoId, contactoTipo, limit])

  const content = useMemo(() => {
    if (loading) {
      return <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Cargando historial...</span>
    }
    if (items.length === 0) {
      return <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>{emptyLabel}</span>
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {items.map((item) => {
          const authorName = usersById[item.autor_id] ?? item.autor_id
          const badges = renderMetadataBadges(item.metadata)
          return (
            <div
              key={item.id}
              style={{
                border: '1px solid rgba(148,163,184,0.18)',
                borderRadius: '0.75rem',
                padding: '0.65rem 0.75rem',
                background: 'rgba(15,23,42,0.16)',
              }}
            >
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={pillStyle}>{tipoLabel[item.tipo] ?? item.tipo}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #94a3b8)' }}>
                  {new Date(item.fecha_actividad || item.created_at).toLocaleString('es')}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted, #94a3b8)' }}>
                  · {authorName}
                </span>
              </div>
              {item.resumen && <div style={{ marginTop: '0.35rem', fontWeight: 700 }}>{item.resumen}</div>}
              {badges.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
                  {badges.map((badge) => (
                    <span
                      key={badge}
                      style={{
                        padding: '0.15rem 0.45rem',
                        borderRadius: '999px',
                        background: 'rgba(16,185,129,0.12)',
                        color: '#6ee7b7',
                        fontSize: '0.72rem',
                      }}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              )}
              {item.contenido && <div style={{ marginTop: '0.45rem', fontSize: '0.82rem' }}>{item.contenido}</div>}
            </div>
          )
        })}
      </div>
    )
  }, [emptyLabel, items, loading, usersById])

  return content
}
