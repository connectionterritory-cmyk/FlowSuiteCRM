import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase/client'
import { buildTelUrl } from '../../lib/addressUtils'
import { useAuth } from '../../auth/AuthProvider'
import { IconPhone } from '../../components/icons'
import { useUsers } from '../../data/UsersProvider'
import {
  type Cliente,
  type ResultadoLlamada,
  resultadoLabel,
  resultadoColor,
  formatFechaCorta,
  segmentoColor,
  segmentoLabel,
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

function guionContextual(dias: number | null, moroso: number | null) {
  if (!moroso || moroso === 0) return null
  if (!dias || dias < 1) return null
  if (dias >= 91)
    return {
      titulo: '+90 días — Gestión externa',
      texto: 'Informar que la cuenta puede ser escalada a distribuidor o cobranza externa. Solicitar confirmación de intención de pago o acuerdo inmediato.',
      color: '#7c3aed',
    }
  if (dias >= 61)
    return {
      titulo: '61-90 días — Última oportunidad',
      texto: 'Comunicar urgencia máxima. Solicitar al menos un pago parcial hoy y compromiso con fecha específica para saldar el resto.',
      color: '#dc2626',
    }
  if (dias >= 31)
    return {
      titulo: '31-60 días — Compromiso urgente',
      texto: 'Solicitar compromiso de pago con fecha concreta. Ofrecer plan de pagos si es necesario. Registrar la promesa en el sistema.',
      color: '#ea580c',
    }
  return {
    titulo: '0-30 días — Recordatorio amistoso',
    texto: 'Recordar el saldo pendiente de forma cordial. Ofrecer facilidad de pago. Mantener tono positivo y relación a largo plazo.',
    color: '#f59e0b',
  }
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
  const [guionAbierto, setGuionAbierto] = useState(false)

  // Reset form fields when modal opens for a new client
  useEffect(() => {
    if (!open) return
    setResultado('no_contesta')
    setNotas('')
    setFechaFollowup('')
    setMontoProme('')
    setGuionAbierto(false)
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

  const guion = guionContextual(cliente.dias_atraso, cliente.monto_moroso)
  const segColor = segmentoColor(cliente.dias_atraso, cliente.monto_moroso)
  const segLbl = segmentoLabel(cliente.dias_atraso, cliente.monto_moroso)

  const guardarLlamada = async () => {
    if (!session?.user.id) return
    setGuardando(true)

    // 1. Registrar la llamada en el historial de telemercadeo
    const { error: errorLlamada } = await supabase.from('llamadas_telemercadeo').insert({
      cliente_id: cliente.id,
      telemercadista_id: session.user.id,
      resultado,
      notas: notas || null,
      followup_at: fechaFollowup || null,
      monto_prometido: montoProme ? parseFloat(montoProme) : null,
    })

    if (errorLlamada) {
      showToast(errorLlamada.message, 'error')
      setGuardando(false)
      return
    }

    // 2. Si es cita agendada, actualizar el cliente para que aparezca en el Dashboard
    if (resultado === 'cita_agendada' && fechaFollowup) {
      const { error: errorCliente } = await supabase
        .from('clientes')
        .update({
          next_action_date: fechaFollowup,
          next_action: 'Cita agendada',
        })
        .eq('id', cliente.id)

      if (errorCliente) {
        showToast('Llamada guardada, pero no se pudo agendar la cita: ' + errorCliente.message, 'error')
      }
    }

    // 3. Guardar como nota global persistente en el sistema
    if (notas.trim()) {
      await supabase.from('notasrp').insert({
        cliente_id: cliente.id,
        contenido: notas.trim(),
        mensaje: notas.trim(),
        canal: 'telemercadeo',
        tipo_mensaje: 'nota',
        enviado_por: session.user.id,
        enviado_en: new Date().toISOString(),
      })
    }

    showToast('Gestión registrada correctamente')
    onClose()
    setGuardando(false)
  }

  const { usersById } = useUsers()
  const vendorName = cliente.vendedor_id ? usersById[cliente.vendedor_id] : null

  return (
    <Modal
      open={open}
      title="Registrar llamada"
      description={`${cliente.nombre ?? ''} ${cliente.apellido ?? ''}${vendorName ? ` · 👤 ${vendorName}` : ''}`.trim()}
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
      {/* Datos financieros del cliente */}
      <div
        style={{
          marginBottom: '1rem',
          padding: '0.6rem 0.85rem',
          borderRadius: '0.5rem',
          background: 'var(--color-surface-strong, rgba(30, 41, 59, 0.6))',
          border: '1px solid var(--color-border, #2b3244)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem 1rem',
          alignItems: 'center',
        }}
      >
        {cliente.saldo_actual !== null && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted-strong)' }}>
            Saldo:{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              ${Number(cliente.saldo_actual).toFixed(2)}
            </strong>
          </span>
        )}
        {(cliente.monto_moroso ?? 0) > 0 && (
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ef4444' }}>
            ${Number(cliente.monto_moroso).toFixed(2)} moroso
          </span>
        )}
        {(cliente.monto_moroso ?? 0) > 0 && (
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '0.1rem 0.45rem',
              borderRadius: '9999px',
              background: segColor + '22',
              color: segColor,
              border: `1px solid ${segColor}44`,
            }}
          >
            {segLbl}
          </span>
        )}
        {cliente.fecha_ultimo_pedido && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted-strong)' }}>
            Últ. pedido:{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {formatFechaCorta(cliente.fecha_ultimo_pedido)}
            </strong>
          </span>
        )}
        {cliente.ultima_fecha_pago && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted-strong)' }}>
            Últ. pago:{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {formatFechaCorta(cliente.ultima_fecha_pago)}
            </strong>
          </span>
        )}
        {(cliente.telefono || cliente.telefono_casa) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text)' }}>
              {cliente.telefono ?? cliente.telefono_casa}
            </span>
            <a
              href={buildTelUrl(cliente.telefono ?? cliente.telefono_casa ?? '')}
              style={{
                width: '28px',
                height: '28px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '999px',
                background: 'rgba(37, 99, 235, 0.12)',
                color: '#2563eb',
                border: '1px solid rgba(37, 99, 235, 0.35)',
                textDecoration: 'none',
              }}
              aria-label="Llamar"
              title="Llamar"
            >
              <IconPhone />
            </a>
          </span>
        )}
        {cliente.hycite_id && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted-strong)' }}>
            #{cliente.hycite_id}
          </span>
        )}
      </div>

      {/* Guión contextual por segmento */}
      {guion && (
        <div
          style={{
            marginBottom: '1rem',
            borderRadius: '0.5rem',
            border: `1px solid ${guion.color}44`,
            background: guion.color + '11',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setGuionAbierto((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '0.45rem 0.75rem',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: guion.color,
              fontWeight: 700,
              fontSize: '0.78rem',
              textAlign: 'left',
            }}
          >
            <span>{guion.titulo}</span>
            <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{guionAbierto ? '▲' : '▼'}</span>
          </button>
          {guionAbierto && (
            <p
              style={{
                margin: 0,
                padding: '0 0.75rem 0.6rem',
                fontSize: '0.8rem',
                color: 'var(--color-text)',
                lineHeight: '1.5',
              }}
            >
              {guion.texto}
            </p>
          )}
        </div>
      )}

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
