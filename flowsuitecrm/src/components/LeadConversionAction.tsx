import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { LEAD_PIPELINE_TERMINAL_STAGES, normalizePipelineStage } from '../constants/pipeline'
import { supabase } from '../lib/supabase/client'
import { Modal } from './Modal'
import { useToast } from './useToast'

type Props = {
  leadId: string
  leadName: string
  disabled?: boolean
  onConverted: () => Promise<void>
}

type LeadState = { estado_pipeline: string | null; deleted_at: string | null }

const isActiveLead = (lead: LeadState | null) => Boolean(
  lead && !lead.deleted_at && !LEAD_PIPELINE_TERMINAL_STAGES.includes(normalizePipelineStage(lead.estado_pipeline)),
)

export function LeadConversionAction({ leadId, leadName, disabled, onConverted }: Props) {
  const { session } = useAuth()
  const { showToast } = useToast()
  const [eligible, setEligible] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const completed = useRef(false)

  useEffect(() => {
    let active = true
    // Some entrypoints provide a partial lead. Read its saved stage before offering conversion.
    void supabase.from('leads').select('estado_pipeline, deleted_at').eq('id', leadId).maybeSingle()
      .then(({ data, error: readError }) => {
        if (!active) return
        setEligible(!readError && isActiveLead(data))
        if (readError) showToast('No se pudo comprobar si el lead se puede convertir.', 'error')
      })
    return () => { active = false }
  }, [leadId, showToast])

  const convert = async () => {
    if (!session?.user.id || disabled || inFlight.current || completed.current) return
    inFlight.current = true
    setConverting(true)
    setError(null)
    try {
      // Recheck after confirmation in case the lead changed while this panel was open.
      const { data: current, error: readError } = await supabase.from('leads')
        .select('estado_pipeline, deleted_at').eq('id', leadId).maybeSingle()
      if (readError) throw new Error('No se pudo comprobar el estado del lead. Intenta nuevamente.')
      if (!isActiveLead(current)) {
        setEligible(false)
        throw new Error('El lead ya no está activo. Actualiza la lista antes de continuar.')
      }
      const { data, error: rpcError } = await supabase.rpc('fn_convertir_lead_a_cliente', {
        p_lead_id: leadId,
        p_actor_id: session.user.id,
      })
      if (rpcError) throw new Error(rpcError.message)
      if (data?.error) throw new Error(data.error === 'lead_not_found' ? 'El lead no existe o fue eliminado.' : String(data.error))
      if (typeof data?.cliente_id !== 'string' || !data.cliente_id) {
        throw new Error('No se pudo confirmar la conversión. Actualiza la lista antes de reintentar.')
      }
      completed.current = true
      setEligible(false)
      setConfirmOpen(false)
      showToast('Lead convertido a cliente.', 'success')
      try {
        await onConverted()
      } catch {
        showToast('El cliente se creó, pero no se pudo actualizar la lista. Recarga la página.', 'error')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo convertir el lead.')
    } finally {
      inFlight.current = false
      setConverting(false)
    }
  }

  if (!session || (!eligible && !confirmOpen)) return null

  return (
    <>
      {eligible && (
        <button type="button" className="btn ghost" disabled={disabled || converting}
          title={disabled ? 'Guarda los cambios del lead antes de convertirlo.' : undefined}
          onClick={() => { setError(null); setConfirmOpen(true) }}>
          Convertir a cliente
        </button>
      )}
      <Modal open={confirmOpen} title="Convertir lead a cliente" size="sm"
        onClose={() => { if (!inFlight.current) setConfirmOpen(false) }}
        actions={
          <>
            <button type="button" className="btn ghost" disabled={converting} onClick={() => setConfirmOpen(false)}>Cancelar</button>
            <button type="button" className="btn primary" disabled={converting || disabled || !eligible} onClick={() => void convert()}>
              {converting ? 'Convirtiendo…' : 'Confirmar conversión'}
            </button>
          </>
        }>
        <p>Se creará un cliente con los datos guardados de <strong>{leadName}</strong> y el lead pasará a Cierre.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </Modal>
    </>
  )
}
