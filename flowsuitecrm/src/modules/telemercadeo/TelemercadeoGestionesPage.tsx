import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { useToast } from '../../components/useToast'
import { useModalHost } from '../../modals/useModalHost'
import { supabase } from '../../lib/supabase/client'
import { useUsers } from '../../data/useUsers'
import { useAuth } from '../../auth/useAuth'
import { resultadoLabel, resultadoColor, formatFechaCorta } from './telemercadeoSharedUtils'
import { saveGestion } from '../../components/gestionUtils'

type GestionRow = {
  id: string
  fuente: 'cob_gestiones' | 'llamadas_telemercadeo'
  fecha: string
  resultado: string
  notas: string | null
  followup_at: string | null
  monto_prometido: number | null
  cliente_id: string | null
  lead_id: string | null
  gestionado_por: string | null
  cliente_nombre: string | null
  cliente_telefono: string | null
  lead_nombre: string | null
  lead_telefono: string | null
}

type Filtros = {
  busqueda: string
  resultado: string
  periodo: 'hoy' | '7d' | '30d' | 'todos'
}

const RESULTADO_OPCIONES = [
  { value: '', label: 'Todos los resultados' },
  { value: 'no_contesta', label: 'No contestó' },
  { value: 'cita_agendada', label: 'Cita agendada' },
  { value: 'pago_prometido', label: 'Promesa de pago' },
  { value: 'pago_realizado', label: 'Pagó' },
  { value: 'no_interesado', label: 'No interesado' },
  { value: 'numero_equivocado', label: 'Número equivocado' },
]

const PERIODO_OPCIONES = [
  { value: 'hoy', label: 'Hoy' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'todos', label: 'Todos' },
]

function periodoFecha(periodo: string): string | null {
  const now = new Date()
  if (periodo === 'hoy') {
    now.setHours(0, 0, 0, 0)
    return now.toISOString()
  }
  if (periodo === '7d') {
    now.setDate(now.getDate() - 7)
    return now.toISOString()
  }
  if (periodo === '30d') {
    now.setDate(now.getDate() - 30)
    return now.toISOString()
  }
  return null
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0.75rem 1.25rem',
        borderRadius: '0.75rem',
        background: color + '12',
        border: `1px solid ${color}30`,
        minWidth: '100px',
      }}
    >
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.15rem', textAlign: 'center' }}>
        {label}
      </span>
    </div>
  )
}

export function TelemercadeoGestionesPage() {
  const { session } = useAuth()
  const { showToast } = useToast()
  const { openGestionModal } = useModalHost()
  const { usersById } = useUsers()
  const openedOnMountRef = useRef(false)

  const [gestiones, setGestiones] = useState<GestionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<Filtros>({
    busqueda: '',
    resultado: '',
    periodo: '7d',
  })

  const cargarGestiones = useCallback(async () => {
    startTransition(() => setLoading(true))
    const desde = periodoFecha(filtros.periodo)

    // 1. cob_gestiones — sin join (no hay FK hacia clientes)
    let cobQuery = supabase
      .from('cob_gestiones')
      .select('id, resultado, notas, fecha_compromiso, monto_comprometido, created_at, gestionado_por, cliente_id')
      .eq('tipo_gestion', 'Llamada')
      .order('created_at', { ascending: false })
      .limit(200)

    if (desde) cobQuery = cobQuery.gte('created_at', desde)
    if (filtros.resultado) cobQuery = cobQuery.eq('resultado', filtros.resultado)

    // 2. llamadas_telemercadeo (legacy)
    let legQuery = supabase
      .from('llamadas_telemercadeo')
      .select('id, resultado, notas, followup_at, monto_prometido, created_at, telemercadista_id, cliente_id, lead_id')
      .order('created_at', { ascending: false })
      .limit(200)

    if (desde) legQuery = legQuery.gte('created_at', desde)
    if (filtros.resultado) legQuery = legQuery.eq('resultado', filtros.resultado)

    const [cobRes, legRes] = await Promise.all([cobQuery, legQuery])

    if (cobRes.error) {
      showToast(`Error cob_gestiones: ${cobRes.error.message}`, 'error')
    }

    // Reunir client_ids únicos para resolver nombres
    const clientIds = new Set<string>()
    ;((cobRes.data ?? []) as Record<string, unknown>[]).forEach((r) => {
      if (r.cliente_id) clientIds.add(String(r.cliente_id))
    })
    ;((legRes.data ?? []) as Record<string, unknown>[]).forEach((r) => {
      if (r.cliente_id) clientIds.add(String(r.cliente_id))
    })

    // 3. Resolver nombres de clientes en una sola query
    const clientesMap = new Map<string, { nombre: string; telefono: string | null }>()
    if (clientIds.size > 0) {
      const { data: clientesData } = await supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono')
        .in('id', Array.from(clientIds))
        .limit(200)

      ;((clientesData ?? []) as Record<string, unknown>[]).forEach((c) => {
        const nombre = [c.nombre, c.apellido].filter(Boolean).join(' ').trim() || String(c.id)
        clientesMap.set(String(c.id), {
          nombre,
          telefono: c.telefono as string | null,
        })
      })
    }

    const cobRows: GestionRow[] = ((cobRes.data ?? []) as Record<string, unknown>[]).map((row) => {
      const clienteInfo = row.cliente_id ? clientesMap.get(String(row.cliente_id)) : null
      return {
        id: `cob-${String(row.id)}`,
        fuente: 'cob_gestiones',
        fecha: String(row.created_at),
        resultado: String(row.resultado ?? 'llamada'),
        notas: row.notas as string | null,
        followup_at: row.fecha_compromiso as string | null,
        monto_prometido: row.monto_comprometido as number | null,
        cliente_id: row.cliente_id as string | null,
        lead_id: null,
        gestionado_por: row.gestionado_por as string | null,
        cliente_nombre: clienteInfo?.nombre ?? null,
        cliente_telefono: clienteInfo?.telefono ?? null,
        lead_nombre: null,
        lead_telefono: null,
      }
    })

    const legRows: GestionRow[] = ((legRes.data ?? []) as Record<string, unknown>[]).map((row) => {
      const clienteInfo = row.cliente_id ? clientesMap.get(String(row.cliente_id)) : null
      return {
        id: `leg-${String(row.id)}`,
        fuente: 'llamadas_telemercadeo',
        fecha: String(row.created_at),
        resultado: String(row.resultado ?? 'llamada'),
        notas: row.notas as string | null,
        followup_at: row.followup_at as string | null,
        monto_prometido: row.monto_prometido as number | null,
        cliente_id: row.cliente_id as string | null,
        lead_id: row.lead_id as string | null,
        gestionado_por: row.telemercadista_id as string | null,
        cliente_nombre: clienteInfo?.nombre ?? null,
        cliente_telefono: clienteInfo?.telefono ?? null,
        lead_nombre: null,
        lead_telefono: null,
      }
    })

    const todas = [...cobRows, ...legRows].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    )
    startTransition(() => {
      setGestiones(todas)
      setLoading(false)
    })
  }, [filtros, showToast])

  useEffect(() => {
    void cargarGestiones()
  }, [cargarGestiones])

  const openGestion = useCallback(() => {
    openGestionModal({
      moduloOrigen: 'telemercadeo_gestiones',
      onSubmit: async (draft) => {
        if (!session?.user) return
        try {
          await saveGestion(draft, session.user.id)
          showToast(`Gestión registrada: ${draft.resumen ?? draft.tipo}`)
          await cargarGestiones()
        } catch (err: any) {
          showToast(`Error: ${err.message}`, 'error')
        }
      },
    })
  }, [openGestionModal, showToast, cargarGestiones, session])

  useEffect(() => {
    if (openedOnMountRef.current) return
    openedOnMountRef.current = true
    openGestion()
  }, [openGestion])

  // Filtro cliente/lead por búsqueda
  const gestionesFiltradas = useMemo(() => {
    const term = filtros.busqueda.trim().toLowerCase()
    if (!term) return gestiones
    return gestiones.filter((g) => {
      const nombre = (g.cliente_nombre ?? g.lead_nombre ?? '').toLowerCase()
      const tel = (g.cliente_telefono ?? g.lead_telefono ?? '').replace(/\D/g, '')
      const termPhone = term.replace(/\D/g, '')
      return nombre.includes(term) || (termPhone && tel.includes(termPhone))
    })
  }, [gestiones, filtros.busqueda])

  // Stats
  const stats = useMemo(() => {
    const total = gestionesFiltradas.length
    const noContesta = gestionesFiltradas.filter((g) => g.resultado === 'no_contesta').length
    const promesas = gestionesFiltradas.filter((g) => g.resultado === 'pago_prometido').length
    const citas = gestionesFiltradas.filter((g) => g.resultado === 'cita_agendada').length
    const pagaron = gestionesFiltradas.filter((g) => g.resultado === 'pago_realizado').length
    const montoTotal = gestionesFiltradas
      .filter((g) => g.monto_prometido != null)
      .reduce((acc, g) => acc + (g.monto_prometido ?? 0), 0)
    return { total, noContesta, promesas, citas, pagaron, montoTotal }
  }, [gestionesFiltradas])

  return (
    <div className="page-stack">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>📋 Historial de Gestiones</h2>
          <p style={{ margin: '0.2rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Registro completo de llamadas y gestiones de telemercadeo
          </p>
        </div>
        <Button type="button" onClick={openGestion}>
          + Nueva gestión
        </Button>
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <StatBadge label="Total" value={stats.total} color="#3b82f6" />
        <StatBadge label="No contestó" value={stats.noContesta} color="#94a3b8" />
        <StatBadge label="Promesas" value={stats.promesas} color="#f59e0b" />
        <StatBadge label="Citas" value={stats.citas} color="#8b5cf6" />
        <StatBadge label="Pagaron" value={stats.pagaron} color="#22c55e" />
        {stats.montoTotal > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '0.75rem 1.25rem',
              borderRadius: '0.75rem',
              background: '#f59e0b12',
              border: '1px solid #f59e0b30',
              minWidth: '120px',
            }}
          >
            <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f59e0b' }}>
              ${stats.montoTotal.toFixed(0)}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
              Monto prometido
            </span>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          padding: '0.75rem 1rem',
          borderRadius: '0.75rem',
          background: 'var(--color-surface, rgba(15,23,42,0.6))',
          border: '1px solid var(--color-border, #1f2937)',
        }}
      >
        <input
          style={{
            flex: '1 1 180px',
            padding: '0.45rem 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--color-border)',
            background: 'var(--color-input-bg, rgba(15,23,42,0.5))',
            color: 'var(--color-text)',
            fontSize: '0.85rem',
          }}
          placeholder="Buscar cliente o teléfono..."
          value={filtros.busqueda}
          onChange={(e) => setFiltros((prev) => ({ ...prev, busqueda: e.target.value }))}
        />
        <select
          style={{
            padding: '0.45rem 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--color-border)',
            background: 'var(--color-input-bg, rgba(15,23,42,0.5))',
            color: 'var(--color-text)',
            fontSize: '0.85rem',
          }}
          value={filtros.resultado}
          onChange={(e) => setFiltros((prev) => ({ ...prev, resultado: e.target.value }))}
        >
          {RESULTADO_OPCIONES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div
          style={{
            display: 'flex',
            gap: '0.35rem',
            flexWrap: 'wrap',
          }}
        >
          {PERIODO_OPCIONES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFiltros((prev) => ({ ...prev, periodo: opt.value as Filtros['periodo'] }))}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: '9999px',
                border: '1px solid',
                borderColor: filtros.periodo === opt.value ? 'var(--color-primary, #3b82f6)' : 'var(--color-border)',
                background: filtros.periodo === opt.value ? 'var(--color-primary, #3b82f6)' : 'transparent',
                color: filtros.periodo === opt.value ? 'white' : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla de gestiones */}
      <div
        style={{
          borderRadius: '0.75rem',
          border: '1px solid var(--color-border, #1f2937)',
          background: 'var(--color-surface, rgba(15,23,42,0.6))',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Cargando gestiones...
          </div>
        ) : gestionesFiltradas.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📞</div>
            <div>No hay gestiones para el período seleccionado</div>
          </div>
        ) : (
          <>
            {/* Header de tabla */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 1fr 120px 90px',
                gap: '0.5rem',
                padding: '0.6rem 1rem',
                borderBottom: '1px solid var(--color-border)',
                background: 'rgba(0,0,0,0.15)',
              }}
            >
              {['Fecha', 'Contacto', 'Gestión por', 'Resultado', 'Monto'].map((col) => (
                <span
                  key={col}
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {col}
                </span>
              ))}
            </div>

            {/* Filas */}
            <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
              {gestionesFiltradas.map((g) => {
                const color = resultadoColor(g.resultado)
                const contactoNombre = g.cliente_nombre ?? g.lead_nombre ?? '—'
                const contactoTel = g.cliente_telefono ?? g.lead_telefono ?? ''
                const gestor = g.gestionado_por ? (usersById[g.gestionado_por] ?? g.gestionado_por.slice(0, 8)) : '—'
                const isExpanded = expandedId === g.id
                return (
                  <div
                    key={g.id}
                    style={{
                      borderBottom: '1px solid var(--color-border, #1f2937)',
                      transition: 'background 0.12s',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '130px 1fr 1fr 120px 90px',
                        gap: '0.5rem',
                        padding: '0.65rem 1rem',
                        cursor: g.notas ? 'pointer' : 'default',
                        alignItems: 'center',
                      }}
                      onClick={() => {
                        if (!g.notas && !g.followup_at) return
                        setExpandedId(isExpanded ? null : g.id)
                      }}
                    >
                      {/* Fecha */}
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {formatFechaCorta(g.fecha)}
                      </span>

                      {/* Contacto */}
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: 'var(--color-text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {contactoNombre}
                        </div>
                        {contactoTel && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {contactoTel}
                          </div>
                        )}
                      </div>

                      {/* Gestor */}
                      <span
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--color-text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {gestor}
                      </span>

                      {/* Resultado badge */}
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.55rem',
                          borderRadius: '9999px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background: color + '20',
                          color,
                          border: `1px solid ${color}40`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {resultadoLabel(g.resultado)}
                      </span>

                      {/* Monto */}
                      <span
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          color: g.monto_prometido ? '#f59e0b' : 'var(--color-text-muted)',
                          textAlign: 'right',
                        }}
                      >
                        {g.monto_prometido != null ? `$${g.monto_prometido.toFixed(2)}` : '—'}
                      </span>
                    </div>

                    {/* Panel expandido con notas */}
                    {isExpanded && (g.notas ?? g.followup_at) && (
                      <div
                        style={{
                          padding: '0.5rem 1rem 0.85rem 1rem',
                          background: color + '08',
                          borderTop: `1px solid ${color}20`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        {g.notas && (
                          <p
                            style={{
                              margin: 0,
                              fontSize: '0.82rem',
                              color: 'var(--color-text)',
                              lineHeight: '1.5',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            📝 {g.notas}
                          </p>
                        )}
                        {g.followup_at && (
                          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                            📅 Seguimiento: <strong>{g.followup_at}</strong>
                          </p>
                        )}
                        {g.fuente === 'llamadas_telemercadeo' && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            Registro legacy
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '0.5rem 1rem',
                borderTop: '1px solid var(--color-border)',
                background: 'rgba(0,0,0,0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                {gestionesFiltradas.length} gestiones
                {filtros.busqueda ? ` · filtrado de ${gestiones.length}` : ''}
              </span>
              <button
                type="button"
                onClick={() => void cargarGestiones()}
                style={{
                  padding: '0.3rem 0.7rem',
                  borderRadius: '0.4rem',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                ↻ Actualizar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
