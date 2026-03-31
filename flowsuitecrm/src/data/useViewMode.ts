import { useContext } from 'react'
import { ViewModeContext } from './ViewModeContext'

export function useViewMode() {
  const context = useContext(ViewModeContext)
  if (!context) {
    throw new Error('useViewMode must be used within ViewModeProvider')
  }
  return context
}
