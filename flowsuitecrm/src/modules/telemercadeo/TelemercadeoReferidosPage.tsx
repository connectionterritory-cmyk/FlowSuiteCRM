import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useMessaging } from '../../hooks/useMessaging'
import { resultadoColor, resultadoLabel, formatFechaCorta } from './TelemercadeoShared'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'

type CiReferido = {
  id: string
  nombre: string | null
  telefono: string | null
  email: string | null
  notas: string | null
  calificacion: number | null
  estado: string | null
  created_at: string
}

type ContactoResultado = 'no_contesta' | 'cita_agendada' | 'interesado' | 'no_interesado' | 'numero_equivocado'

const RESULTADO_OPTS: { value: ContactoResultado; label: string }[] = [
  { value: 'no_contesta', label: 'No contestó' },
  { value: 'cita_agendada', label: 'Cita agendada' },
  { value: 'interesado', label: 'Interesado' },
  { value: 'no_interesado', label: 'No interesado' },
  { value: 'numero_equivocado', label: 'Número equivocado' },
]

function StarDisplay({ value }: { value: number | null }) {
  if (!value) return null
  return (
    <span style={{ fontSize: '0.75rem', color: '#f59e0b', letterSpacing: '-1px' }}>
      {'★'.repeat(value)}{'☆'.repeat(5 - value)}
    </span>
  )
}

export function TelemercadeoReferidosPage() {
  const configured = isSupabaseConfigured
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const { showToast } = useToast()
  const [referidos, setReferidos] = useState<CiReferido[]>([])
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState<'pendientes' | 'todos'>('pendientes')

  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<CiReferido | null>(null)
  const [resultado, setResultado] = useState<ContactoResultado>('no_contesta')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    let query = supabase
      .from('ci_referidos')
      .select('id, nombre, telefono, email, notas, calificacion, estado, created_at')
      .order('calificacion', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)

    if (filtro === 'pendientes') {
      query = query.or('estado.is.null,estado.neq.activado')
    }

    const { data } = await query
    setReferidos((data as unknown as CiReferido[]) ?? [])
    setLoading(false)
  }, [configured, filtro])

  useEffect(() => {
    cargar()
  }, [cargar])

  const abrirModal = (ref: CiReferido) => {
    setSelected(ref)
    setResultado('no_contesta')
    setNotas(ref.notas ?? '')
    setModalOpen(true)
  }

  const guardar = async () => {
    if (!selected) return
    setGuardando(true)
    const nuevoEstado =
      resultado === 'cita_agendada' || resultado === 'interesado'
        ? 'en_proceso'
        : selected.estado

    const { error } = await supabase
      .from('ci_referidos')
      .update({ notas: notas || null, estado: nuevoEstado })
      .eq('id', selected.id)

    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('Contacto registrado')
      setModalOpen(false)
      cargar()
    }
    setGuardando(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Filtro tabs */}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        {([
          { key: 'pendientes', label: 'Pendientes' },
          { key: 'todos', label: 'Todos' },
        ] as const).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFiltro(f.key)}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: '0.375rem',
              border: `1px solid ${filtro === f.key ? '#3b82f6' : 'var(--color-border)'}`,
              cursor: 'pointer',
              fontSize: '0.78rem',
              fontWeight: 600,
              background: filtro === f.key ? 'rgba(59,130,246,0.12)' : 'transparent',
              color: filtro === f.key ? '#3b82f6' : 'var(--color-text-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
      ) : referidos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--color-text-muted)' }}>
          <p style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>👥</p>
          <p style={{ fontWeight: 600 }}>Sin referidos pendientes</p>
          <p style={{ fontSize: '0.85rem' }}>Todos los referidos han sido contactados o activados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {referidos.map((ref) => {
            const estadoColor =
              ref.estado === 'en_proceso'
                ? '#3b82f6'
                : ref.estado === 'activado'
                ? '#10b981'
                : '#6b7280'

            return (
              <div
                key={ref.id}
                style={{
                  padding: '0.9rem 1.1rem',
                  background: 'var(--color-card, #1b2230)',
                  borderRadius: '0.75rem',
                  border: '1px solid var(--color-border, #2b3244)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>
                      {ref.nombre ?? 'Sin nombre'}
                    </p>
                    <StarDisplay value={ref.calificacion} />
                    <span
                      style={{
                        padding: '0.1rem 0.45rem',
                        borderRadius: '9999px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        background: estadoColor + '22',
                        color: estadoColor,
                        border: `1px solid ${estadoColor}44`,
                      }}
                    >
                      {ref.estado ?? 'pendiente'}
                    </span>
                  </div>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    {ref.telefono ?? ref.email ?? 'Sin contacto'}
                  </p>
                  {ref.notas && (
                    <p
                      style={{
                        margin: '0.2rem 0 0',
                        fontSize: '0.75rem',
                        color: 'var(--color-text-muted)',
                        fontStyle: 'italic',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '280px',
                      }}
                    >
                      {ref.notas}
                    </p>
                  )}
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    {formatFechaCorta(ref.created_at)}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => openWhatsapp({ nombre: ref.nombre ?? '', telefono: ref.telefono ?? '' })}
                    disabled={!ref.telefono}
                    style={{
                      padding: '0.45rem 0.7rem',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(34,197,94,0.35)',
                      background: 'rgba(34,197,94,0.12)',
                      color: '#22c55e',
                      cursor: ref.telefono ? 'pointer' : 'not-allowed',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      opacity: ref.telefono ? 1 : 0.5,
                    }}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => abrirModal(ref)}
                    style={{
                      padding: '0.45rem 0.75rem',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(59,130,246,0.5)',
                      background: 'var(--color-primary, #3b82f6)',
                      color: 'white',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      boxShadow: '0 4px 10px rgba(59,130,246,0.2)',
                    }}
                  >
                    Registrar
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="Registrar contacto"
        description={selected?.nombre ?? ''}
        onClose={() => setModalOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="form-field">
            <span>Resultado del contacto</span>
            <select
              value={resultado}
              onChange={(e) => setResultado(e.target.value as ContactoResultado)}
            >
              {RESULTADO_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Notas</span>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones, interés, próxima acción..."
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: resultadoColor(resultado),
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              {resultadoLabel(resultado)}
              {(resultado === 'cita_agendada' || resultado === 'interesado') &&
                ' → se marcará como En proceso'}
            </span>
          </div>
        </div>
      </Modal>

      <ModalRenderer />
    </div>
  )
}
