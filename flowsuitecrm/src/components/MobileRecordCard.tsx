import type { ReactNode } from 'react'

export type MobileRecordMetaItem = {
  label?: ReactNode
  value: ReactNode
}

export type MobileRecordDetailItem = {
  label: ReactNode
  value: ReactNode
}

type MobileRecordCardProps = {
  title?: ReactNode
  subtitle?: ReactNode
  meta?: MobileRecordMetaItem[]
  badges?: ReactNode[]
  actions?: ReactNode
  children?: ReactNode
  details?: MobileRecordDetailItem[]
  onClick?: () => void
  loading?: boolean
  className?: string
}

const hasContent = (value: ReactNode) => value !== null && value !== undefined && value !== ''

export function MobileRecordCard({
  title,
  subtitle,
  meta,
  badges,
  actions,
  children,
  details,
  onClick,
  loading = false,
  className,
}: MobileRecordCardProps) {
  const interactiveProps = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        },
      }
    : {}

  if (loading) {
    return (
      <article className={`mobile-record-card skeleton-card ${className ?? ''}`.trim()}>
        <div className="skeleton-line wide" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </article>
    )
  }

  return (
    <article
      className={`mobile-record-card ${onClick ? 'clickable' : ''} ${className ?? ''}`.trim()}
      {...interactiveProps}
    >
      <div className="mobile-record-card-header">
        <div className="mobile-record-card-title-wrap">
          {hasContent(title) && <h3 className="mobile-record-card-title">{title}</h3>}
          {hasContent(subtitle) && <p className="mobile-record-card-subtitle">{subtitle}</p>}
        </div>
        {badges && badges.length > 0 && (
          <div className="mobile-record-card-badges">
            {badges.map((badge, index) => (
              <span key={index} className="mobile-record-card-badge">
                {badge}
              </span>
            ))}
          </div>
        )}
      </div>

      {meta && meta.length > 0 && (
        <div className="mobile-record-card-meta">
          {meta.map((item, index) => (
            <span key={index}>
              {hasContent(item.label) && <strong>{item.label}: </strong>}
              {item.value}
            </span>
          ))}
        </div>
      )}

      {details && details.length > 0 && (
        <dl className="mobile-record-card-details">
          {details.map((item, index) => (
            <div key={index}>
              <dt>{item.label}</dt>
              <dd>{hasContent(item.value) ? item.value : '-'}</dd>
            </div>
          ))}
        </dl>
      )}

      {children && <div className="mobile-record-card-content">{children}</div>}

      {actions && (
        <div className="mobile-record-card-actions" onClick={(event) => event.stopPropagation()}>
          {actions}
        </div>
      )}
    </article>
  )
}
