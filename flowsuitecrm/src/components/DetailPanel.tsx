type DetailPanelProps = {
  open: boolean
  title: string
  items: { label: string; value: React.ReactNode }[]
  onClose: () => void
  action?: React.ReactNode
  tabs?: { key: string; label: string }[]
  activeTab?: string
  onTabChange?: (key: string) => void
}

export function DetailPanel({ open, title, items, onClose, action, tabs, activeTab, onTabChange }: DetailPanelProps) {
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
          {tabs && tabs.length > 0 && activeTab && onTabChange && (
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onTabChange(tab.key)}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '9999px',
                    border: '1px solid var(--color-border, #e5e7eb)',
                    background: activeTab === tab.key ? 'var(--color-primary, #3b82f6)' : 'var(--color-surface, #f9fafb)',
                    color: activeTab === tab.key ? 'white' : 'var(--color-text, #111827)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
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
