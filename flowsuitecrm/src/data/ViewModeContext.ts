import { createContext } from 'react'

export type ViewMode = 'seller' | 'distributor'

export type ViewModeContextValue = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  hasDistribuidorScope: boolean
  distributionUserIds: string[]
  distributionLoading: boolean
}

export const ViewModeContext = createContext<ViewModeContextValue | undefined>(undefined)
