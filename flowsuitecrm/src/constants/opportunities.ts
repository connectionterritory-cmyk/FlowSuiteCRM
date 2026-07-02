import type { TFunction } from 'i18next'

const OPPORTUNITY_STAGE_ALIASES: Record<string, string> = {
  calificado: 'cita',
  demostracion: 'demo',
}

export const CLIENT_OPPORTUNITY_STAGES = [
  'nuevo',
  'contactado',
  'calificado',
  'propuesta',
  'negociacion',
  'cerrado_ganado',
  'cerrado_perdido',
  'cerrado',
] as const

export const CLIENT_OPPORTUNITY_OPEN_STAGES = [
  'nuevo',
  'contactado',
  'calificado',
  'propuesta',
  'negociacion',
] as const

export const CLIENT_OPPORTUNITY_STATUS_OPTIONS = [
  'abierta',
  'en_seguimiento',
  'bloqueada',
  'ganada',
  'perdida',
  'pospuesta',
  'cerrada',
] as const

export const CLIENT_OPPORTUNITY_SOURCE_OPTIONS = [
  'cliente_existente',
  'cliente_recuperado',
  'cross_sell',
  'referido_cliente',
  'postventa',
  'campana',
] as const

export const CLIENT_OPPORTUNITY_CHANNEL_OPTIONS = [
  'llamada',
  'whatsapp',
  'cita',
  'servicio',
  'cartera_handoff',
  'manual',
] as const

export type ClientOpportunityStage = typeof CLIENT_OPPORTUNITY_STAGES[number]
export type ClientOpportunityStatus = typeof CLIENT_OPPORTUNITY_STATUS_OPTIONS[number]
export type ClientOpportunitySource = typeof CLIENT_OPPORTUNITY_SOURCE_OPTIONS[number]
export type ClientOpportunityChannel = typeof CLIENT_OPPORTUNITY_CHANNEL_OPTIONS[number]

export type OpportunityStageVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const normalizeOpportunityStage = (stage?: string | null) => {
  if (!stage) return 'otro'
  return OPPORTUNITY_STAGE_ALIASES[stage] ?? stage
}

export const getOpportunityStageLabel = (stage: string | null | undefined, t: TFunction) => {
  const normalized = normalizeOpportunityStage(stage)
  const labelKey = `pipeline.columns.${normalized}`
  const label = t(labelKey)
  if (label === labelKey) return t('opportunities.stage.other')
  return label
}

export const getOpportunityStageBadgeVariant = (stage: string | null | undefined): OpportunityStageVariant => {
  const normalized = normalizeOpportunityStage(stage)
  if (normalized === 'cierre') return 'success'
  if (normalized === 'demo' || normalized === 'cita') return 'warning'
  if (normalized === 'contactado' || normalized === 'nuevo') return 'info'
  if (normalized === 'descartado') return 'neutral'
  return 'neutral'
}

export const isClientOpportunityClosedStage = (stage: string | null | undefined) => (
  stage === 'cerrado_ganado' || stage === 'cerrado_perdido' || stage === 'cerrado'
)

export const getClientOpportunityStageLabel = (stage: string | null | undefined) => {
  switch (stage) {
    case 'nuevo':
      return 'Nuevo'
    case 'contactado':
      return 'Contactado'
    case 'calificado':
      return 'Calificado'
    case 'propuesta':
      return 'Propuesta'
    case 'negociacion':
      return 'Negociacion'
    case 'cerrado_ganado':
      return 'Cerrado ganado'
    case 'cerrado_perdido':
      return 'Cerrado perdido'
    case 'cerrado':
      return 'Cerrado'
    default:
      return stage ?? 'Sin etapa'
  }
}

export const getClientOpportunityStatusLabel = (status: string | null | undefined) => {
  switch (status) {
    case 'abierta':
      return 'Abierta'
    case 'en_seguimiento':
      return 'En seguimiento'
    case 'bloqueada':
      return 'Bloqueada'
    case 'ganada':
      return 'Ganada'
    case 'perdida':
      return 'Perdida'
    case 'pospuesta':
      return 'Pospuesta'
    case 'cerrada':
      return 'Cerrada'
    default:
      return status ?? 'Sin estado'
  }
}
