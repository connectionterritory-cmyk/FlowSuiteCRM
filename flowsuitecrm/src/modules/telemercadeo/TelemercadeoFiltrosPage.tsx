import { useMemo, useState } from 'react'
import { useMessaging } from '../../hooks/useMessaging'
import type { EquipoInstalado } from './TelemercadeoShared'
import { nombreCompleto } from './telemercadeoSharedUtils'
import { useTelemercadeoEquipos } from './telemercadeoData'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { supabase } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../components/useToast'

type Semaforo = 'vencido' | 'proximo' | 'al_dia'

function getSemaforo(proxima_revision: string | null): Semaforo {
  if (!proxima_revision) return 'al_dia'
  const today = new Date().toLocaleDateString('en-CA')
  if (proxima_revision < today) return 'vencido'
  const d45 = new Date()
  d45.setDate(d45.getDate() + 45)
  const d45Iso = d45.toLocaleDateString('en-CA')
  if (proxima_revision <= d45Iso) return 'proximo'
  return 'al_dia'
}

function diasRestantes(proxima_revision: string | null): number | null {
  if (!proxima_revision) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(proxima_revision + 'T00:00:00')
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const SEMAFORO_TABS = [
  { key: 'vencido' as Semaforo, label: 'Vencido', icon: '🔴', color: '#ef4444' },
  { key: 'proximo' as Semaforo, label: 'Próximo ≤45d', icon: '🟡', color: '#f59e0b' },
  { key: 'al_dia' as Semaforo, label: 'Al día', icon: '🟢', color: '#22c55e' },
] as const

export function TelemercadeoFiltrosPage() {
  const { openWhatsapp, openEmail, ModalRenderer } = useMessaging()
  const { equipos, loading } = useTelemercadeoEquipos()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { isMobile, isTablet } = useBreakpoint()
  const useMobileView = isMobile || isTablet
  const [tab, setTab] = useState<Semaforo>('vencido')
  const [busqueda, setBusqueda] = useState('')
  const [contactandoId, setContactandoId] = useState<string | null>(null)

  const equiposConSemaforo = useMemo(() => {
    return equipos
      .filter((eq) => eq.proxima_revision !== null || eq.fecha_instalacion !== null)
      .map((eq) => ({ ...eq, semaforo: getSemaforo(eq.proxima_revision) }))
  }, [equipos])

  const counts = useMemo(() => {
    const result = { vencido: 0, proximo: 0, al_dia: 0 }
    for (const eq of equiposConSemaforo) result[eq.semaforo]++
    return result
  }, [equiposConSemaforo])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return equiposConSemaforo.filter((eq) => {
      if (eq.semaforo !== tab) return false
      if (!q) return true
      const cliente = eq.cliente
      const nombre = `${cliente?.nombre ?? ''} ${cliente?.apellido ?? ''}`.toLowerCase()
      const tel = (cliente?.telefono ?? cliente?.telefono_casa ?? '').toLowerCase()
      const serie = (eq.numero_serie ?? '').toLowerCase()
      const producto = (eq.productos?.nombre ?? '').toLowerCase()
      return nombre.includes(q) || tel.includes(q) || serie.includes(q) || producto.includes(q)
    })
  }, [equiposConSemaforo, tab, busqueda])

  const handleContactado = async (eq: EquipoInstalado & { semaforo: Semaforo }) => {
    const cliente = eq.cliente
    if (!cliente || !session?.user.id) return
    setContactandoId(eq.id)
    try {
      await supabase.from('contacto_actividades').insert({
        cliente_id: cliente.id,
        tipo: 'llamada',
        notas: `Contacto por vencimiento de filtro — ${eq.productos?.nombre ?? 'equipo'} (S/N: ${eq.numero_serie ?? 'N/A'})`,
        created_by: session.user.id,
        org_id: cliente.org_id ?? '00000000-0000-0000-0000-000000000001',
      })
      showToast('Contacto registrado', 'success')
    } catch {
      showToast('Error al registrar contacto', 'error')
    } finally {
      setContactandoId(null)
    }
  }

  const buildContact = (eq: EquipoInstalado) => {
    const c = eq.cliente!
    return {
      nombre: nombreCompleto(c),
      telefono: c.telefono ?? c.telefono_casa ?? '',
      email: c.email ?? '',
      clienteId: c.id,
      equipo_nombre: eq.productos?.nombre ?? undefined,
      equipo_serie: eq.numero_serie ?? undefined,
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Segment tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {SEMAFORO_TABS.map((s) => {
          const active = tab === s.key
          const count = counts[s.key]
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setTab(s.key)}
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: '0.375rem',
                border: `1px solid ${active ? s.color : 'var(--color-border)'}`,
                cursor: 'pointer',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: active ? s.color + '22' : 'transparent',
                color: active ? s.color : 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              {s.icon} {s.label}
              {count > 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '18px',
                    height: '18px',
                    padding: '0 4px',
                    borderRadius: '9999px',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    background: active ? s.color + '33' : 'var(--color-border)',
                    color: active ? s.color : 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre, teléfono, producto o serie…"
        style={{
          height: '36px',
          padding: '0 0.75rem',
          borderRadius: '0.5rem',
          border: '1px solid var(--color-border, #2b3244)',
          background: 'var(--color-card, #1b2230)',
          color: 'var(--color-text)',
          fontSize: '0.85rem',
        }}
      />

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
      ) : filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
          Sin equipos en este segmento
        </div>
      ) : useMobileView ? (
        /* ── Mobile / Tablet: cards ─────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtrados.map((eq) => {
            const cliente = eq.cliente
            if (!cliente) return null
            const dias = diasRestantes(eq.proxima_revision)
            const semaforoColor =
              eq.semaforo === 'vencido' ? '#ef4444' :
              eq.semaforo === 'proximo' ? '#f59e0b' : '#22c55e'

            return (
              <div
                key={eq.id}
                style={{
                  padding: '1rem',
                  background: 'var(--color-card, #1b2230)',
                  borderRadius: '0.75rem',
                  border: `1px solid ${semaforoColor}44`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                {/* Header row: nombre + badge días */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text)' }}>
                      {nombreCompleto(cliente)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                      {cliente.telefono ?? cliente.telefono_casa ?? '—'}
                    </div>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      padding: '0.2rem 0.55rem',
                      borderRadius: '9999px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: semaforoColor + '22',
                      color: semaforoColor,
                      border: `1px solid ${semaforoColor}44`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {dias === null ? '—' : dias < 0 ? `${Math.abs(dias)}d venc.` : `en ${dias}d`}
                  </span>
                </div>

                {/* Product + serie */}
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text)', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem' }}>
                  <span><span style={{ color: 'var(--color-text-muted)' }}>Producto:</span> {eq.productos?.nombre ?? '—'}</span>
                  {eq.numero_serie && (
                    <span><span style={{ color: 'var(--color-text-muted)' }}>S/N:</span> <span style={{ fontFamily: 'monospace' }}>{eq.numero_serie}</span></span>
                  )}
                </div>

                {/* Dates grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', fontSize: '0.75rem' }}>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.1rem' }}>Instalado</div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{formatFecha(eq.fecha_instalacion)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.1rem' }}>Próx. revisión</div>
                    <div style={{ fontWeight: 600, color: semaforoColor }}>{formatFecha(eq.proxima_revision)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.1rem' }}>Próx. cambio</div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{formatFecha(eq.proxima_cambio)}</div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <button
                    type="button"
                    onClick={() => openWhatsapp(buildContact(eq), undefined, 'servicio')}
                    style={{
                      flex: 1,
                      padding: '0.6rem 0',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(34,197,94,0.35)',
                      background: 'rgba(34,197,94,0.12)',
                      color: '#22c55e',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      touchAction: 'manipulation',
                    }}
                  >
                    WhatsApp
                  </button>
                  {cliente.email && (
                    <button
                      type="button"
                      onClick={() => openEmail(buildContact(eq), undefined, 'servicio')}
                      style={{
                        flex: 1,
                        padding: '0.6rem 0',
                        borderRadius: '0.5rem',
                        border: '1px solid rgba(59,130,246,0.35)',
                        background: 'rgba(59,130,246,0.12)',
                        color: '#3b82f6',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        touchAction: 'manipulation',
                      }}
                    >
                      Email
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={contactandoId === eq.id}
                    onClick={() => void handleContactado(eq)}
                    style={{
                      flex: 1,
                      padding: '0.6rem 0',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(168,85,247,0.35)',
                      background: 'rgba(168,85,247,0.12)',
                      color: '#a855f7',
                      cursor: contactandoId === eq.id ? 'not-allowed' : 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      opacity: contactandoId === eq.id ? 0.6 : 1,
                      touchAction: 'manipulation',
                    }}
                  >
                    {contactandoId === eq.id ? '…' : 'Contactado'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Desktop: table ─────────────────────────────────── */
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.82rem',
              color: 'var(--color-text)',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.75rem', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Cliente</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Producto</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Serie</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Instalado</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Prox. revisión</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Prox. cambio</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Días</th>
                <th style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((eq) => {
                const cliente = eq.cliente
                if (!cliente) return null
                const dias = diasRestantes(eq.proxima_revision)
                const semaforoColor =
                  eq.semaforo === 'vencido' ? '#ef4444' :
                  eq.semaforo === 'proximo' ? '#f59e0b' : '#22c55e'

                return (
                  <tr
                    key={eq.id}
                    style={{ borderBottom: '1px solid var(--color-border)', verticalAlign: 'middle' }}
                  >
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{nombreCompleto(cliente)}</div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)' }}>
                        {cliente.telefono ?? cliente.telefono_casa ?? '—'}
                      </div>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{eq.productos?.nombre ?? '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {eq.numero_serie ?? '—'}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {formatFecha(eq.fecha_instalacion)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', color: semaforoColor, fontWeight: 600 }}>
                      {formatFecha(eq.proxima_revision)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {formatFecha(eq.proxima_cambio)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', fontWeight: 700, color: semaforoColor }}>
                      {dias === null ? '—' : dias < 0 ? `${Math.abs(dias)}d venc.` : `${dias}d`}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          title="Enviar WhatsApp"
                          onClick={() => openWhatsapp(buildContact(eq), undefined, 'servicio')}
                          style={{
                            padding: '0.3rem 0.6rem',
                            borderRadius: '0.4rem',
                            border: '1px solid rgba(34,197,94,0.35)',
                            background: 'rgba(34,197,94,0.12)',
                            color: '#22c55e',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                          }}
                        >
                          WA
                        </button>
                        {cliente.email && (
                          <button
                            type="button"
                            title="Enviar Email"
                            onClick={() => openEmail(buildContact(eq), undefined, 'servicio')}
                            style={{
                              padding: '0.3rem 0.6rem',
                              borderRadius: '0.4rem',
                              border: '1px solid rgba(59,130,246,0.35)',
                              background: 'rgba(59,130,246,0.12)',
                              color: '#3b82f6',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            Email
                          </button>
                        )}
                        <button
                          type="button"
                          title="Marcar como contactado"
                          disabled={contactandoId === eq.id}
                          onClick={() => void handleContactado(eq)}
                          style={{
                            padding: '0.3rem 0.6rem',
                            borderRadius: '0.4rem',
                            border: '1px solid rgba(168,85,247,0.35)',
                            background: 'rgba(168,85,247,0.12)',
                            color: '#a855f7',
                            cursor: contactandoId === eq.id ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            opacity: contactandoId === eq.id ? 0.6 : 1,
                          }}
                        >
                          {contactandoId === eq.id ? '…' : '✓'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModalRenderer />
    </div>
  )
}
