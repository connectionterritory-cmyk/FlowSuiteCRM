type StatCardProps = {
  label: string
  value: string
  accent?: 'gold' | 'blue'
  hint?: string
}

export function StatCard({ label, value, accent = 'blue', hint }: StatCardProps) {
  return (
    <div className={`card stat-card ${accent}`}>
      <div>
        <p className="stat-label">{label}</p>
        <h3 className="stat-value">{value}</h3>
      </div>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  )
}
