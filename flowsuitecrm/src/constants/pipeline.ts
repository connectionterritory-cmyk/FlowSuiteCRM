import type { TFunction } from 'i18next'

export const LEAD_PIPELINE_FALLBACK_STAGES = ['demo', 'cierre'] as const
export const LEAD_PIPELINE_FOLLOWUP_STAGES = ['contactado', 'cita', 'demo'] as const
export const LEAD_PIPELINE_NEW_STAGES = ['nuevo'] as const
export const LEAD_PIPELINE_URGENT_DAYS = 3

const LEAD_STAGE_ALIASES: Record<string, string> = {
  calificado: 'cita',
  demostracion: 'demo',
}

export type LeadStageVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const normalizeLeadStage = (stage?: string | null) => {
  if (!stage) return 'otro'
  return LEAD_STAGE_ALIASES[stage] ?? stage
}

export const getLeadStageLabel = (stage: string | null | undefined, t: TFunction) => {
  const normalized = normalizeLeadStage(stage)
  const labelKey = `pipeline.columns.${normalized}`
  const label = t(labelKey)
  if (label === labelKey) return t('leads.stage.other')
  return label
}

export const getLeadStageBadgeVariant = (stage: string | null | undefined): LeadStageVariant => {
  const normalized = normalizeLeadStage(stage)
  if (normalized === 'cierre') return 'success'
  if (normalized === 'demo' || normalized === 'cita') return 'warning'
  if (normalized === 'contactado' || normalized === 'nuevo') return 'info'
  if (normalized === 'descartado') return 'neutral'
  return 'neutral'
}
