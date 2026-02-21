type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
  bodyClassName?: string
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
}: ModalProps) {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal ${className ?? ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3 id="modal-title">{title}</h3>
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
