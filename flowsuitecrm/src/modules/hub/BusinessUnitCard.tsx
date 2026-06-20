import { Link } from 'react-router-dom'
import { Badge } from '../../components/Badge'
import type { BusinessUnit } from './hub.types'

type BusinessUnitCardProps = {
  unit: BusinessUnit
}

export function BusinessUnitCard({ unit }: BusinessUnitCardProps) {
  const Icon = unit.icon
  const badgeTone = unit.status === 'active' ? 'emerald' : unit.status === 'coming_soon' ? 'blue' : 'neutral'

  return (
    <article className={`hub-business-card status-${unit.status} theme-${unit.theme}`}>
      <div className="hub-business-header">
        <div className="hub-business-title-row">
          <div className="hub-business-icon-wrap">
            <Icon className="hub-business-icon" />
          </div>
          <div>
            <h3>{unit.title}</h3>
            <p className="hub-business-subtitle">{unit.subtitle}</p>
          </div>
        </div>
        <Badge
          label={unit.badge}
          tone={badgeTone}
          className={unit.status === 'requires_license' ? 'hub-badge-license' : undefined}
        />
      </div>

      <div className="hub-business-body">
        {unit.description.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>

      <div className="hub-business-links">
        {unit.links.map((link) =>
          link.disabled || !link.to ? (
            <span key={link.label} className="hub-business-link disabled">
              {link.label}
            </span>
          ) : (
            <Link key={link.label} to={link.to} className="hub-business-link">
              {link.label}
            </Link>
          ),
        )}
      </div>
    </article>
  )
}
