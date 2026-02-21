import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastTone = 'success' | 'error'

type ToastItem = {
  id: string
  message: string
  tone: ToastTone
}

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

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

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
