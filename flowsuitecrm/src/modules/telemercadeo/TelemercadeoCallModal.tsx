import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import {
  type Cliente,
  type ResultadoLlamada,
  resultadoLabel,
  resultadoColor,
  formatFechaCorta,
} from './TelemercadeoShared'

type LlamadaHistorial = {
  id: string
  resultado: string
  notas: string | null
  followup_at: string | null
  monto_prometido: number | null
  created_at: string
}

type TelemercadeoCallModalProps = {
  open: boolean
  cliente: Cliente | null
  onClose: () => void
}

export function TelemercadeoCallModal({
  open,
  cliente,
  onClose,
}: TelemercadeoCallModalProps) {
  const { session } = useAuth()
  const { showToast } = useToast()
  const [resultado, setResultado] = useState<ResultadoLlamada>('no_contesta')
  const [notas, setNotas] = useState('')
  const [fechaFollowup, setFechaFollowup] = useState('')
  const [montoProme, setMontoProme] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [historial, setHistorial] = useState<LlamadaHistorial[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  // Reset form fields when modal opens for a new client
  useEffect(() => {
    if (!open) return
    setResultado('no_contesta')
    setNotas('')
    setFechaFollowup('')
    setMontoProme('')
  }, [open, cliente?.id])

  // Load call history when modal opens
  useEffect(() => {
    if (!open || !cliente?.id) {
      setHistorial([])
      return
    }
    let active = true
    setLoadingHistorial(true)
    const load = async () => {
      const { data } = await supabase
        .from('llamadas_telemercadeo')
        .select('id, resultado, notas, followup_at, monto_prometido, created_at')
        .eq('cliente_id', cliente.id)
        .order('created_at', { ascending: false })
        .limit(6)
      if (!active) return
      setHistorial((data as LlamadaHistorial[]) ?? [])
      setLoadingHistorial(false)
    }
    load()
    return () => {
      active = false
    }
  }, [open, cliente?.id])

  if (!open || !cliente) return null

  const guardarLlamada = async () => {
    if (!session?.user.id) return
    setGuardando(true)
    const { error } = await supabase.from('llamadas_telemercadeo').insert({
      cliente_id: cliente.id,
      telemercadista_id: session.user.id,
      resultado,
      notas: notas || null,
      followup_at: fechaFollowup || null,
      monto_prometido: montoProme ? parseFloat(montoProme) : null,
    })
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('Llamada registrada')
      onClose()
    }
    setGuardando(false)
  }

  return (
    <Modal
      open={open}
      title="Registrar llamada"
      description={`${cliente.nombre ?? ''} ${cliente.apellido ?? ''}`.trim()}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={guardarLlamada} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </>
      }
    >
      {/* Historial de llamadas anteriores */}
      {loadingHistorial ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Cargando historial...
        </p>
      ) : historial.length > 0 ? (
        <div
          style={{
            marginBottom: '1.25rem',
            borderBottom: '1px solid var(--color-border, #2b3244)',
            paddingBottom: '1rem',
          }}
        >
          <p
            style={{
              fontWeight: 700,
              fontSize: '0.82rem',
              color: 'var(--color-text-muted)',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Historial reciente
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {historial.map((ll) => {
              const color = resultadoColor(ll.resultado)
              return (
                <div
                  key={ll.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '0.4rem',
                    background: color + '11',
                    border: `1px solid ${color}33`,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '9999px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      background: color + '22',
                      color,
                      border: `1px solid ${color}44`,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {resultadoLabel(ll.resultado)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {formatFechaCorta(ll.created_at)}
                      {ll.monto_prometido != null && ` · $${ll.monto_prometido.toFixed(2)}`}
                      {ll.followup_at && ` · Seguimiento: ${ll.followup_at}`}
                    </p>
                    {ll.notas && (
                      <p
                        style={{
                          margin: '0.15rem 0 0',
                          fontSize: '0.75rem',
                          color: 'var(--color-text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ll.notas}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p
          style={{
            fontSize: '0.82rem',
            color: 'var(--color-text-muted)',
            marginBottom: '1rem',
            fontStyle: 'italic',
          }}
        >
          Sin llamadas anteriores
        </p>
      )}

      {/* Formulario de nueva llamada */}
      <div className="form-grid">
        <label className="form-field">
          <span>Resultado</span>
          <select
            value={resultado}
            onChange={(event) => setResultado(event.target.value as ResultadoLlamada)}
          >
            <option value="no_contesta">No contestó</option>
            <option value="cita_agendada">Cita agendada</option>
            <option value="pago_prometido">Promesa de pago</option>
            <option value="pago_realizado">Pagó</option>
            <option value="no_interesado">No interesado</option>
            <option value="numero_equivocado">Número equivocado</option>
          </select>
        </label>

        {resultado === 'pago_prometido' && (
          <label className="form-field">
            <span>Monto prometido ($)</span>
            <input
              type="number"
              value={montoProme}
              onChange={(event) => setMontoProme(event.target.value)}
              placeholder="0.00"
            />
          </label>
        )}

        <label className="form-field">
          <span>Fecha de seguimiento</span>
          <input
            type="date"
            value={fechaFollowup}
            onChange={(event) => setFechaFollowup(event.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Notas</span>
          <input
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
            placeholder="Observaciones opcionales..."
          />
        </label>
      </div>
    </Modal>
  )
}
