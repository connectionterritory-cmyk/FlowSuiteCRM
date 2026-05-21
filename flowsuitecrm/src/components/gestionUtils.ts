import type { GestionResultado, GestionRole, GestionTipo, GestionDraft } from './RegistrarGestionModal'
import { supabase } from '../lib/supabase/client'

type ResultadoOption = {
  value: GestionResultado
  label: string
}

type TipoOption = {
  value: GestionTipo
  label: string
}

export const GESTION_TYPES_BY_ROLE: Record<GestionRole, GestionTipo[]> = {
  admin: ['llamada', 'whatsapp', 'nota', 'seguimiento', 'visita', 'email', 'cita_completada', 'venta', 'referidos', 'envio_material'],
  distribuidor: ['llamada', 'whatsapp', 'nota', 'seguimiento', 'visita', 'email', 'venta'],
  vendedor: ['llamada', 'whatsapp', 'nota', 'seguimiento', 'visita', 'email', 'cita_completada', 'venta', 'referidos', 'envio_material'],
  telemercadeo: ['llamada', 'whatsapp', 'nota', 'seguimiento'],
}

const TIPO_OPTIONS: TipoOption[] = [
  { value: 'llamada', label: 'Llamada' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'nota', label: 'Nota' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'visita', label: 'Visita' },
  { value: 'email', label: 'Email' },
  { value: 'cita_completada', label: 'Cita completada' },
  { value: 'venta', label: 'Venta' },
  { value: 'referidos', label: 'Referidos' },
  { value: 'envio_material', label: 'Envio de material' },
]

const RESULTADO_OPTIONS_BY_TYPE: Partial<Record<GestionTipo, ResultadoOption[]>> = {
  llamada: [
    { value: 'contesto', label: 'Contesto' },
    { value: 'no_contesta', label: 'No contesto' },
    { value: 'ocupado', label: 'Ocupado' },
    { value: 'buzon_voz', label: 'Buzon de voz' },
    { value: 'numero_equivocado', label: 'Numero equivocado' },
    { value: 'interesado', label: 'Interesado' },
    { value: 'no_interesado', label: 'No interesado' },
    { value: 'cita_agendada', label: 'Cita agendada' },
    { value: 'promesa_pago', label: 'Promesa de pago' },
    { value: 'pago_realizado', label: 'Pago realizado' },
  ],
  whatsapp: [
    { value: 'mensaje_enviado', label: 'Mensaje enviado' },
    { value: 'respondio', label: 'Respondio' },
    { value: 'no_respondio', label: 'No respondio' },
    { value: 'interesado', label: 'Interesado' },
    { value: 'no_interesado', label: 'No interesado' },
    { value: 'cita_agendada', label: 'Cita agendada' },
  ],
  seguimiento: [
    { value: 'contesto', label: 'Completado' },
    { value: 'reagendado', label: 'Reagendado' },
    { value: 'cancelado', label: 'Cancelado' },
    { value: 'no_show', label: 'No show' },
  ],
  visita: [
    { value: 'contesto', label: 'Realizada' },
    { value: 'reagendado', label: 'Reagendada' },
    { value: 'cancelado', label: 'Cancelada' },
    { value: 'no_show', label: 'No show' },
  ],
  email: [
    { value: 'mensaje_enviado', label: 'Correo enviado' },
    { value: 'respondio', label: 'Respondio' },
    { value: 'no_respondio', label: 'No respondio' },
  ],
  cita_completada: [
    { value: 'contesto', label: 'Completada' },
    { value: 'reagendado', label: 'Reagendada' },
    { value: 'cancelado', label: 'Cancelada' },
    { value: 'no_show', label: 'No show' },
  ],
  venta: [
    { value: 'pago_realizado', label: 'Pago realizado' },
  ],
}

export function buildGestionAutoSummary(tipo: GestionTipo, resultado: GestionResultado | null) {
  const tipoLabel = TIPO_OPTIONS.find((option) => option.value === tipo)?.label ?? tipo
  const resultadoLabel = Object.values(RESULTADO_OPTIONS_BY_TYPE)
    .flat()
    .find((option) => option.value === resultado)?.label
  return resultadoLabel ? `${tipoLabel} - ${resultadoLabel}` : tipoLabel
}

const CITA_CTA_RULES = new Set([
  'llamada:cita_agendada',
  'whatsapp:cita_agendada',
  'seguimiento:reagendado',
  'visita:reagendado',
  'cita_completada:reagendado',
])

export function shouldOfferCitaCTA(tipo: GestionTipo, resultado: GestionResultado | null) {
  if (!resultado) return false
  return CITA_CTA_RULES.has(`${tipo}:${resultado}`)
}

export async function saveGestion(draft: GestionDraft, userId: string) {
  if (!draft.contactoId || !draft.contactoTipo) {
    throw new Error('Falta contacto')
  }
  
  const payload = {
    contacto_tipo: draft.contactoTipo,
    contacto_id: draft.contactoId,
    tipo: draft.tipo,
    resumen: draft.resumen.trim() || buildGestionAutoSummary(draft.tipo, draft.resultado),
    contenido: draft.contenido.trim() || null,
    metadata: {
      canal: draft.canal,
      resultado: draft.resultado,
      followup_at: draft.followupAt || null,
      monto_prometido: draft.montoPrometido ? parseFloat(draft.montoPrometido) : null,
      modulo_origen: draft.moduloOrigen,
      origen_id: draft.origenId,
    },
    autor_id: userId,
    fecha_actividad: draft.fechaGestion || new Date().toISOString(),
  }

  const { error } = await supabase.from('contacto_actividades').insert(payload)
  
  if (error) {
    // Retry without org_id if schema cache issue
    if (error.message.toLowerCase().includes("could not find the 'org_id' column")) {
       const legacyPayload = { ...payload }
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
       delete (legacyPayload as any).org_id
       const { error: retryError } = await supabase.from('contacto_actividades').insert(legacyPayload)
       if (retryError) throw new Error(retryError.message)
       return
    }
    throw new Error(error.message)
  }
}
