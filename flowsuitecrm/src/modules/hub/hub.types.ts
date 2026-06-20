import type { ComponentType } from 'react'

export type BusinessUnitStatus = 'active' | 'coming_soon' | 'requires_license'

export type BusinessUnitLink = {
  label: string
  to?: string
  disabled?: boolean
}

export type BusinessUnit = {
  title: string
  subtitle: string
  description: string[]
  status: BusinessUnitStatus
  theme: 'emerald' | 'teal' | 'navy' | 'gold'
  badge: string
  icon: ComponentType<{ className?: string }>
  links: BusinessUnitLink[]
}

export type HubStat = {
  key: string
  label: string
  value: string
  hint?: string
  accent?: 'gold' | 'blue'
  to?: string
}

export type QuickAction = {
  key: string
  label: string
  description: string
  to?: string
  variant?: 'primary' | 'secondary'
  eventAction?: 'newLead' | 'note' | 'nextAction' | 'opportunity' | 'venta'
}
