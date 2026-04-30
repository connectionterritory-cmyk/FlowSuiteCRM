import { startTransition, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { resultadoLabel, resultadoColor, formatFechaCorta } from '../telemercadeo/telemercadeoSharedUtils'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../components/useToast'

type LlamadaRow = {
  id: string
  fecha: string
  resultado: string
  notas: string | null
  followup_at: string | null
  monto_prometido: number | null
  fuente: 'cob_gestiones' | 'legacy'
}

type Props = {
  clienteId: string | null
  leadId: string | null
  ownerName?: string
}

type ResultadoLlamada =
  | 'no_contesta'
  | 'cita_agendada'
  | 'pago_prometido'
  | 'no_interesado'
  | 'numero_equivocado'

export function CILlamadasPanel({ clienteId, leadId, ownerName }: Props) {
  const { session } = useAuth()
  const { showToast } = useToast()

  const [llamadas, setLlamadas] = useState<LlamadaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Formulario de nueva llamada
  const [formOpen, setFormOpen] = useState(false)
  const [resultado, setResultado] = useState<ResultadoLlamada>('no_contesta')
  const [notas, setNotas] = useState('')
  const [followupFecha, setFollowupFecha] = useState('')
  const [montoProme, setMontoProme] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = async () => {
    if (!clienteId && !leadId) {
      setLlamadas([])
      return
    }
    startTransition(() => setLoading(true))

    const promises: Promise<LlamadaRow[]>[] = []

    // Gestiones de cobranza
    if (clienteId) {
      promises.push(
        supabase
          .from('cob_gestiones')
          .select('id, resultado, notas, fecha_compromiso, monto_comprometido, created_at')
          .eq('cliente_id', clienteId)
          .eq('tipo_gestion', 'Llamada')
          .order('created_at', { ascending: false })
          .limit(10)
          .then(({ data }) =>
            ((data ?? []) as Record<string, unknown>[]).map((row) => ({
              id: `cob-${String(row.id)}`,
              fecha: String(row.created_at),
              resultado: String(row.resultado ?? 'llamada'),
              notas: row.notas as string | null,
              followup_at: row.fecha_compromiso as string | null,
              monto_prometido: row.monto_comprometido as number | null,
              fuente: 'cob_gestiones' as const,
            })),
          ),
      )
    }

    // Llamadas legacy
    if (clienteId || leadId) {
      let q = supabase
        .from('llamadas_telemercadeo')
        .select('id, resultado, notas, followup_at, monto_prometido, created_at')
        .order('created_at', { ascending: false })
        .limit(10)

      if (clienteId) q = q.eq('cliente_id', clienteId)
      else if (leadId) q = q.eq('lead_id', leadId)

      promises.push(
        q.then(({ data }) =>
          ((data ?? []) as Record<string, unknown>[]).map((row) => ({
            id: `leg-${String(row.id)}`,
            fecha: String(row.created_at),
            resultado: String(row.resultado ?? 'llamada'),
            notas: row.notas as string | null,
            followup_at: row.followup_at as string | null,
            monto_prometido: row.monto_prometido as number | null,
            fuente: 'legacy' as const,
          })),
        ),
      )
    }

    const results = await Promise.all(promises)
    const todas = results
      .flat()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 12)

    startTransition(() => {
      setLlamadas(todas)
      setLoading(false)
    })
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, leadId])

  const handleGuardar = async () => {
    if (!session?.user.id || (!clienteId && !leadId)) return
    setGuardando(true)

    const { error } = await supabase.from('llamadas_telemercadeo').insert({
      cliente_id: clienteId,
      lead_id: leadId,
      telemercadista_id: session.user.id,
      owner_id: session.user.id,
      resultado,
      notas: notas || null,
      followup_at: followupFecha || null,
      monto_prometido: montoProme ? parseFloat(montoProme) : null,
      fecha_llamada: new Date().toISOString(),
    })

    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('Llamada registrada')
      setFormOpen(false)
      setResultado('no_contesta')
      setNotas('')
      setFollowupFecha('')
      setMontoProme('')
      await cargar()
    }
    setGuardando(false)
  }

  const totalMontoPrometido = llamadas
    .filter((l) => l.monto_prometido != null)
    .reduce((acc, l) => acc + (l.monto_prometido ?? 0), 0)

  return (
    <div
      style={{
        borderRadius: '0.75rem',
        border: '1px solid var(--color-border, #1f2937)',
        background: 'var(--color-surface, rgba(15,23,42,0.6))',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.7rem 1rem',
          borderBottom: '1px solid var(--color-border)',
          background: 'rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1rem' }}>📞</span>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>
            Llamadas
          </span>
          {llamadas.length > 0 && (
            <span
              style={{
                padding: '0.1rem 0.45rem',
                borderRadius: '9999px',
                background: '#3b82f620',
                color: '#3b82f6',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: '1px solid #3b82f630',
              }}
            >
              {llamadas.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          style={{
            padding: '0.3rem 0.75rem',
            borderRadius: '0.4rem',
            border: '1px solid rgba(59,130,246,0.4)',
            background: 'rgba(59,130,246,0.12)',
            color: '#3b82f6',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontWeight: 700,
          }}
        >
          {formOpen ? '✕ Cancelar' : '+ Registrar llamada'}
        </button>
      </div>

      {/* Formulario nueva llamada */}
      {formOpen && (
        <div
          style={{
            padding: '0.9rem 1rem',
            borderBottom: '1px solid var(--color-border)',
            background: 'rgba(59,130,246,0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          {ownerName && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Registrando para: <strong style={{ color: 'var(--color-text)' }}>{ownerName}</strong>
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Resultado</span>
              <select
                value={resultado}
                onChange={(e) => setResultado(e.target.value as ResultadoLlamada)}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '0.4rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-input-bg, rgba(15,23,42,0.8))',
                  color: 'var(--color-text)',
                  fontSize: '0.82rem',
                }}
              >
                <option value="no_contesta">No contestó</option>
                <option value="cita_agendada">Cita agendada</option>
                <option value="pago_prometido">Promesa de pago</option>
                <option value="no_interesado">No interesado</option>
                <option value="numero_equivocado">Número equivocado</option>
              </select>
            </label>

            {resultado === 'pago_prometido' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Monto prometido ($)</span>
                <input
                  type="number"
                  value={montoProme}
                  onChange={(e) => setMontoProme(e.target.value)}
                  placeholder="0.00"
                  style={{
                    padding: '0.4rem 0.6rem',
                    borderRadius: '0.4rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-input-bg, rgba(15,23,42,0.8))',
                    color: 'var(--color-text)',
                    fontSize: '0.82rem',
                  }}
                />
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Seguimiento</span>
              <input
                type="date"
                value={followupFecha}
                onChange={(e) => setFollowupFecha(e.target.value)}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '0.4rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-input-bg, rgba(15,23,42,0.8))',
                  color: 'var(--color-text)',
                  fontSize: '0.82rem',
                }}
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Notas</span>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones opcionales..."
              style={{
                padding: '0.4rem 0.6rem',
                borderRadius: '0.4rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-input-bg, rgba(15,23,42,0.8))',
                color: 'var(--color-text)',
                fontSize: '0.82rem',
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => void handleGuardar()}
            disabled={guardando}
            style={{
              alignSelf: 'flex-end',
              padding: '0.45rem 1.1rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: 'var(--color-primary, #3b82f6)',
              color: 'white',
              cursor: guardando ? 'not-allowed' : 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              opacity: guardando ? 0.7 : 1,
            }}
          >
            {guardando ? 'Guardando...' : 'Guardar llamada'}
          </button>
        </div>
      )}

      {/* Lista de llamadas */}
      {loading ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
          Cargando llamadas...
        </div>
      ) : llamadas.length === 0 ? (
        <div
          style={{
            padding: '1.5rem',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: '0.82rem',
            fontStyle: 'italic',
          }}
        >
          Sin llamadas registradas
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {llamadas.map((ll) => {
              const color = resultadoColor(ll.resultado)
              const isExpanded = expandedId === ll.id
              return (
                <div
                  key={ll.id}
                  style={{
                    borderBottom: '1px solid var(--color-border, #1f2937)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.55rem 1rem',
                      cursor: (ll.notas ?? ll.followup_at) ? 'pointer' : 'default',
                    }}
                    onClick={() => {
                      if (!ll.notas && !ll.followup_at) return
                      setExpandedId(isExpanded ? null : ll.id)
                    }}
                  >
                    {/* Badge resultado */}
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.1rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        background: color + '20',
                        color,
                        border: `1px solid ${color}40`,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {resultadoLabel(ll.resultado)}
                    </span>

                    {/* Fecha */}
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {formatFechaCorta(ll.fecha)}
                    </span>

                    {/* Monto */}
                    {ll.monto_prometido != null && (
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b', marginLeft: 'auto' }}>
                        ${ll.monto_prometido.toFixed(2)}
                      </span>
                    )}

                    {/* Indicador notas */}
                    {(ll.notas ?? ll.followup_at) && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginLeft: ll.monto_prometido != null ? '0' : 'auto' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    )}
                  </div>

                  {/* Detalle expandido */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: '0.4rem 1rem 0.65rem 1rem',
                        background: color + '08',
                        borderTop: `1px solid ${color}20`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.3rem',
                      }}
                    >
                      {ll.notas && (
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text)', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                          📝 {ll.notas}
                        </p>
                      )}
                      {ll.followup_at && (
                        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                          📅 Seguimiento: <strong>{ll.followup_at}</strong>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer con total monto */}
          {totalMontoPrometido > 0 && (
            <div
              style={{
                padding: '0.5rem 1rem',
                background: '#f59e0b08',
                borderTop: '1px solid #f59e0b20',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Total prometido
              </span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f59e0b' }}>
                ${totalMontoPrometido.toFixed(2)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
