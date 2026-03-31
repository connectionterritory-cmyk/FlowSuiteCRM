export type EtapaReferido =
  | 'capturado'
  | 'whatsapp_enviado'
  | 'llamada_gestionada'
  | 'cita_agendada'
  | 'cita_realizada'
  | 'convertido'
  | 'cerrado'

export type ResultadoLlamada =
  | 'no_contesta'
  | 'interesado'
  | 'no_interesa'
  | 'llamar_luego'
  | 'cita_agendada'

export type ResultadoCita =
  | 'venta'
  | 'refiere'
  | 'reclutada'
  | 'participa'
  | 'no_compra'

export type ReferidoGestionResultado = ResultadoLlamada | ResultadoCita

export type ReferidoGestion = {
  id: string
  referidoId: string
  fecha: string
  accion: string
  resultado?: ReferidoGestionResultado | null
  notas?: string | null
  creadoPor?: string | null
}

export type ReferidoEmbudo = {
  etapa: EtapaReferido
  ultimaAccion: string
  siguientePaso: string
}

export const SIGUIENTE_PASO: Record<EtapaReferido, string> = {
  capturado: 'Enviar WhatsApp',
  whatsapp_enviado: 'Llamar',
  llamada_gestionada: 'Agendar cita o reintentar',
  cita_agendada: 'Registrar resultado de cita',
  cita_realizada: 'Registrar desenlace',
  convertido: 'Ver resultados',
  cerrado: 'Reabrir si aplica',
}

