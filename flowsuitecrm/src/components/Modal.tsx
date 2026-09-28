import { useEffect, useId, useRef } from 'react'

const modalStack: string[] = []

const removeModalFromStack = (id: string) => {
  const index = modalStack.lastIndexOf(id)
  if (index !== -1) modalStack.splice(index, 1)
}

type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
  backdropClassName?: string
  bodyClassName?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  actions,
  className,
  bodyClassName,
  backdropClassName,
  size = 'md',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const modalId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    removeModalFromStack(modalId)
    modalStack.push(modalId)
    const dialog = dialogRef.current
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ')
    const isTopModal = () => modalStack.at(-1) === modalId
    const focusDialog = () => {
      if (isTopModal()) dialog?.focus()
    }
    const frame = window.requestAnimationFrame(focusDialog)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => (
        !element.matches(':disabled') &&
        !element.hasAttribute('hidden') &&
        element.getAttribute('aria-hidden') !== 'true' &&
        element.getClientRects().length > 0
      ))
      if (focusable.length === 0) {
        event.preventDefault()
        focusDialog()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      const wasTopModal = isTopModal()
      removeModalFromStack(modalId)
      if (wasTopModal && openerRef.current?.isConnected && !openerRef.current.matches(':disabled')) {
        openerRef.current.focus()
      }
    }
  }, [modalId, open])

  if (!open) return null

  return (
    <div className={`modal-backdrop ${backdropClassName ?? ''}`.trim()} onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={`modal modal-${size} ${className ?? ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3 id={titleId}>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            x
          </button>
        </header>
        <div className={`modal-body ${bodyClassName ?? ''}`.trim()}>{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
