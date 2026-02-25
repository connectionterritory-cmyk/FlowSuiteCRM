type StatCardProps = {
  label: string
  value: string
  accent?: 'gold' | 'blue'
  hint?: string
  onClick?: () => void
}

export function StatCard({ label, value, accent = 'blue', hint, onClick }: StatCardProps) {
  return (
    <div
      className={`card stat-card ${accent}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div>
        <p className="stat-label">{label}</p>
        <h3 className="stat-value">{value}</h3>
      </div>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  )
}
