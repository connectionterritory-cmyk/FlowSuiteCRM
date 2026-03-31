import type { CiReferido } from '../../hooks/useConexiones'
import type { EtapaReferido, ReferidoEmbudo } from '../../types/referidos'

type ReferidoSnapshot = Pick<
  CiReferido,
  'estado' | 'lead_id' | 'notas' | 'cita_id' | 'modo_gestion' | 'liberado_a_telemercadeo_at'
>

const STAGE_LABELS: Record<EtapaReferido, string> = {
  capturado: 'Capturado',
  whatsapp_enviado: 'WhatsApp enviado',
  llamada_gestionada: 'Llamada gestionada',
  cita_agendada: 'Cita agendada',
  cita_realizada: 'Cita realizada',
  convertido: 'Convertido',
  cerrado: 'Cerrado',
}

const NEXT_STEP: Record<EtapaReferido, string> = {
  capturado: 'Enviar WhatsApp',
  whatsapp_enviado: 'Llamar',
  llamada_gestionada: 'Agendar cita o reintentar',
  cita_agendada: 'Registrar resultado de cita',
  cita_realizada: 'Registrar desenlace',
  convertido: 'Ver resultados',
  cerrado: 'Reabrir si aplica',
}

export function getReferidoStageLabel(etapa: EtapaReferido) {
  return STAGE_LABELS[etapa]
}

export function getReferidoStage(snapshot: ReferidoSnapshot): EtapaReferido {
  if (snapshot.estado === 'regalo_entregado') return 'convertido'
  if (snapshot.estado === 'presentacion_hecha') return 'cita_realizada'
  if (snapshot.cita_id || snapshot.estado === 'cita_agendada') return 'cita_agendada'
  if (snapshot.estado === 'contactado' || snapshot.lead_id) return 'llamada_gestionada'
  if (snapshot.estado === 'telemercadeo' || snapshot.liberado_a_telemercadeo_at) return 'whatsapp_enviado'
  return 'capturado'
}

export function buildReferidoEmbudo(snapshot: ReferidoSnapshot): ReferidoEmbudo {
  const etapa = getReferidoStage(snapshot)
  const notas = snapshot.notas?.trim()

  if (etapa === 'convertido') {
    return {
      etapa,
      ultimaAccion: snapshot.estado === 'regalo_entregado' ? 'Resultado registrado' : STAGE_LABELS[etapa],
      siguientePaso: NEXT_STEP[etapa],
    }
  }

  if (etapa === 'cita_realizada') {
    return {
      etapa,
      ultimaAccion: 'Presentacion realizada',
      siguientePaso: NEXT_STEP[etapa],
    }
  }

  if (etapa === 'cita_agendada') {
    return {
      etapa,
      ultimaAccion: snapshot.cita_id ? 'Cita creada' : 'Cita agendada',
      siguientePaso: NEXT_STEP[etapa],
    }
  }

  if (etapa === 'llamada_gestionada') {
    return {
      etapa,
      ultimaAccion: snapshot.lead_id ? 'Lead creado' : 'Llamada trabajada',
      siguientePaso: NEXT_STEP[etapa],
    }
  }

  if (etapa === 'whatsapp_enviado') {
    return {
      etapa,
      ultimaAccion: snapshot.modo_gestion === 'telemercadeo' ? 'Enviado a telemercadeo' : 'WhatsApp enviado',
      siguientePaso: NEXT_STEP[etapa],
    }
  }

  return {
    etapa,
    ultimaAccion: notas ? 'Capturado con nota' : 'Capturado en lista',
    siguientePaso: NEXT_STEP[etapa],
  }
}

