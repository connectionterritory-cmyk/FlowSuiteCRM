import { createContext } from 'react'

type ToastTone = 'success' | 'error'

export type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export type { ToastTone }
