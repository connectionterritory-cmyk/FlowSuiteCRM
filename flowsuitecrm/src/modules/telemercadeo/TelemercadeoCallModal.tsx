import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import type { Cliente, ResultadoLlamada } from './TelemercadeoShared'

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

  useEffect(() => {
    if (!open) return
    setResultado('no_contesta')
    setNotas('')
    setFechaFollowup('')
    setMontoProme('')
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
      showToast('✅ Llamada registrada')
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
