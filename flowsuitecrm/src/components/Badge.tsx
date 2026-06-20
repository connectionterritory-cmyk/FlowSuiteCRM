type BadgeProps = {
  label: string
  tone?: 'neutral' | 'gold' | 'blue' | 'emerald'
  className?: string
}

export function Badge({ label, tone = 'neutral', className }: BadgeProps) {
  return <span className={`badge ${tone} ${className ?? ''}`.trim()}>{label}</span>
}
