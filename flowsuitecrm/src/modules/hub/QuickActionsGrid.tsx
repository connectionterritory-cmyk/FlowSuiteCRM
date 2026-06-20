import { useNavigate } from 'react-router-dom'
import type { QuickAction } from './hub.types'

type QuickActionsGridProps = {
  actions: QuickAction[]
}

export function QuickActionsGrid({ actions }: QuickActionsGridProps) {
  const navigate = useNavigate()

  const handleAction = (action: QuickAction) => {
    if (action.eventAction) {
      window.dispatchEvent(new CustomEvent('quick-actions:open', { detail: { action: action.eventAction } }))
      return
    }

    if (action.to) {
      navigate(action.to)
    }
  }

  return (
    <section className="page-stack">
      <div className="hub-section-heading">
        <p className="hub-section-kicker">Acciones rapidas</p>
        <h3>Atajos operativos</h3>
      </div>
      <div className="hub-actions-grid">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`hub-action-card ${action.variant === 'primary' ? 'is-primary' : 'is-secondary'}`}
            onClick={() => handleAction(action)}
          >
            <strong>{action.label}</strong>
            <span>{action.description}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
