import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useUsers } from '../data/useUsers'
import { usePersonaPerfil } from '../hooks/usePersonaPerfil'
import { ContactoTimeline } from './ContactoTimeline'
import { DetailPanel } from './DetailPanel'

type Tab = 'registros' | 'activaciones' | 'historial'

const TABS = [
  { key: 'registros', label: 'Registros' },
  { key: 'activaciones', label: 'Activaciones' },
  { key: 'historial', label: 'Historial' },
] satisfies { key: Tab; label: string }[]

const estadoBadgeStyle = (estado: string): CSSProperties => ({
  display: 'inline-block',
  padding: '0.15rem 0.45rem',
  borderRadius: '999px',
  fontSize: '0.72rem',
  fontWeight: 700,
  background: estado === 'convertido' || estado === 'activo' || estado === 'actual'
    ? 'rgba(16,185,129,0.15)'
    : estado === 'pendiente' || estado === 'nuevo'
    ? 'rgba(245,158,11,0.15)'
    : 'rgba(148,163,184,0.15)',
  color: estado === 'convertido' || estado === 'activo' || estado === 'actual'
    ? '#6ee7b7'
    : estado === 'pendiente' || estado === 'nuevo'
    ? '#fcd34d'
    : '#94a3b8',
})

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  padding: '0.5rem 0',
  borderBottom: '1px solid rgba(148,163,184,0.12)',
}

const labelStyle: CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-muted, #94a3b8)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

type Props = {
  personaId: string | null
  onClose: () => void
}

export function PersonaPerfilPanel({ personaId, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('registros')
  const { perfil, loading, error } = usePersonaPerfil(personaId)
  const { usersById } = useUsers()

  const title = perfil
    ? [perfil.nombre, perfil.apellido].filter(Boolean).join(' ') || 'Perfil de persona'
    : 'Perfil de persona'

  const items = (() => {
    if (loading) return [{ label: 'Estado', value: 'Cargando...' }]
    if (error) return [{ label: 'Error', value: error }]
    if (!perfil) return []

    if (activeTab === 'historial') {
      // Renderizar un ContactoTimeline por cada lead y cliente —
      // si solo hay uno de cada tipo, la experiencia es limpia.
      // Si hay múltiples, mostramos cada uno con su label.
      const sections: { label: string; id: string; tipo: 'lead' | 'cliente' }[] = [
        ...perfil.leads.map((l) => ({
          label: `Lead: ${[l.nombre, l.apellido].filter(Boolean).join(' ') || l.id.slice(0, 8)}`,
          id: l.id,
          tipo: 'lead' as const,
        })),
        ...perfil.clientes.map((c) => ({
          label: `Cliente: ${[c.nombre, c.apellido].filter(Boolean).join(' ') || c.id.slice(0, 8)}`,
          id: c.id,
          tipo: 'cliente' as const,
        })),
      ]

      if (sections.length === 0) {
        return [{ label: 'Historial', value: 'Sin registros vinculados' }]
      }

      return sections.map(({ label, id, tipo }) => ({
        label,
        value: (
          <ContactoTimeline
            contactoTipo={tipo}
            contactoId={id}
            emptyLabel="Sin actividades registradas"
          />
        ),
      }))
    }

    if (activeTab === 'activaciones') {
      if (perfil.activaciones.length === 0) {
        return [{ label: 'Activaciones', value: 'Sin activaciones registradas' }]
      }
      return perfil.activaciones.map((a) => ({
        label: new Date(a.created_at ?? '').toLocaleDateString('es'),
        value: (
          <div style={rowStyle}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={estadoBadgeStyle(a.estado ?? '')}>{a.estado ?? 'sin estado'}</span>
              {a.regalo_nombre && (
                <span style={{ fontSize: '0.8rem' }}>{a.regalo_nombre}</span>
              )}
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #94a3b8)' }}>
              {a.cantidad_referidos} referido{a.cantidad_referidos !== 1 ? 's' : ''}
              {a.representante_id ? ` · ${usersById[a.representante_id] ?? ''}` : ''}
            </span>
          </div>
        ),
      }))
    }

    // Tab: registros (default)
    const items: { label: string; value: React.ReactNode }[] = []

    if (perfil.telefono) {
      items.push({ label: 'Teléfono', value: perfil.telefono })
    }
    if (perfil.email) {
      items.push({ label: 'Email', value: perfil.email })
    }

    if (perfil.leads.length > 0) {
      items.push({
        label: 'Leads',
        value: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {perfil.leads.map((l) => (
              <div key={l.id} style={rowStyle}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={estadoBadgeStyle(l.estado_pipeline)}>{l.estado_pipeline}</span>
                </div>
                <span style={labelStyle}>
                  Owner: {l.owner_id ? (usersById[l.owner_id] ?? l.owner_id.slice(0, 8)) : '—'}
                  {' · '}
                  {new Date(l.created_at).toLocaleDateString('es')}
                </span>
              </div>
            ))}
          </div>
        ),
      })
    }

    if (perfil.clientes.length > 0) {
      items.push({
        label: 'Clientes',
        value: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {perfil.clientes.map((c) => (
              <div key={c.id} style={rowStyle}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={estadoBadgeStyle(c.estado_cuenta ?? '')}>{c.estado_cuenta ?? '—'}</span>
                  {c.saldo_actual > 0 && (
                    <span style={{ fontSize: '0.78rem' }}>
                      ${Number(c.saldo_actual).toFixed(2)}
                    </span>
                  )}
                </div>
                <span style={labelStyle}>
                  Vendedor: {c.vendedor_id ? (usersById[c.vendedor_id] ?? c.vendedor_id.slice(0, 8)) : '—'}
                  {c.fecha_ultimo_pedido ? ` · Último pedido: ${c.fecha_ultimo_pedido}` : ''}
                </span>
              </div>
            ))}
          </div>
        ),
      })
    }

    if (perfil.embajadores.length > 0) {
      items.push({
        label: 'Embajadores',
        value: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {perfil.embajadores.map((e) => (
              <div key={e.id} style={rowStyle}>
                <span style={estadoBadgeStyle(e.estado)}>{e.estado}</span>
                {e.fecha_aceptacion && (
                  <span style={labelStyle}>
                    Aceptado: {new Date(e.fecha_aceptacion).toLocaleDateString('es')}
                  </span>
                )}
              </div>
            ))}
          </div>
        ),
      })
    }

    if (items.length <= 2) {
      items.push({ label: 'Registros', value: 'Sin registros vinculados' })
    }

    return items
  })()

  return (
    <DetailPanel
      open={Boolean(personaId)}
      title={title}
      items={items}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as Tab)}
      onClose={onClose}
    />
  )
}
