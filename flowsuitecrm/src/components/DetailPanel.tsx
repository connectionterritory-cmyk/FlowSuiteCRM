type DetailPanelProps = {
  open: boolean
  title: string
  items: { label: string; value: React.ReactNode }[]
  onClose: () => void
  action?: React.ReactNode
}

export function DetailPanel({ open, title, items, onClose, action }: DetailPanelProps) {
  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <h3 id="drawer-title">{title}</h3>
          <div className="flex items-center gap-2">
            {action}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              x
            </button>
          </div>
        </header>
        <div className="drawer-body">
          <dl className="detail-list">
            {items.map((item) => (
              <div key={item.label} className="detail-row">
                <dt>{item.label}</dt>
                <dd>{item.value ?? '-'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  )
}
