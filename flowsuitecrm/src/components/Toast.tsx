import { useCallback, useMemo, useState } from 'react'
import { ToastContext, type ToastTone } from './ToastContext'
export { useToast } from './useToast'

type ToastItem = {
  id: string
  message: string
  tone: ToastTone
}

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = createId()
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 3000)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <Toast key={toast.id} tone={toast.tone} message={toast.message} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

type ToastProps = {
  message: string
  tone: ToastTone
}

export function Toast({ message, tone }: ToastProps) {
  return (
    <div className={`toast ${tone}`}>
      <span className="toast-icon" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
