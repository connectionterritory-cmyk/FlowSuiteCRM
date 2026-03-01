import type { TFunction } from 'i18next'

const OPPORTUNITY_STAGE_ALIASES: Record<string, string> = {
  calificado: 'cita',
  demostracion: 'demo',
}

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
