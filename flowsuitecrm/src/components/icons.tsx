type IconProps = {
  className?: string
}

const baseProps = {
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconDashboard({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </svg>
  )
}

export function IconPipeline({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M4 7h6v10H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M14 14h6v6h-6z" />
    </svg>
  )
}

export function IconLeads({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M12 3l3 6 6 .5-4.5 4 1.5 6-6-3.3-6 3.3 1.5-6L3 9.5 9 9z" />
    </svg>
  )
}

export function IconCustomers({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="8" r="3" />
      <path d="M3 20c.5-3 3-5 5-5s4.5 2 5 5" />
      <path d="M12 20c.4-2.2 2.5-4 4.6-4 2 0 3.9 1.8 4.4 4" />
    </svg>
  )
}

export function IconSales({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M6 8h12l-1.2 11H7.2L6 8z" />
      <path d="M9 8V6a3 3 0 016 0v2" />
    </svg>
  )
}

export function IconProducts({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M4 7l8-4 8 4-8 4-8-4z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </svg>
  )
}

export function IconPrograms({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </svg>
  )
}

export function IconConnections({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M8 7c-2.2 0-4 1.8-4 4s1.8 4 4 4c1.3 0 2.4-.6 3.1-1.6" />
      <path d="M16 17c2.2 0 4-1.8 4-4s-1.8-4-4-4c-1.3 0-2.4.6-3.1 1.6" />
      <path d="M10 12h4" />
    </svg>
  )
}

export function Icon4en14({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </svg>
  )
}

export function IconService({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      <path d="M12 20a4 4 0 004-4" />
      <path d="M8 20a4 4 0 01-4-4" />
      <path d="M12 12v3" />
      <circle cx="12" cy="18" r="1" />
    </svg>
  )
}

export function IconUsers({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  )
}

export function IconWhatsapp({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M7 10a5 5 0 015-5h0a5 5 0 110 10H9l-4 4 1.5-4.5A5 5 0 017 10z" />
      <path d="M10 10h4" />
      <path d="M10 12h3" />
    </svg>
  )
}

export function IconSms({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M4 6h16a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 4v-4H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
      <path d="M8 10h8" />
    </svg>
  )
}

export function IconMail({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

export function IconTrash({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <rect x="6" y="7" width="12" height="13" rx="2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

export function IconSwap({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M7 7h10" />
      <path d="M13 3l4 4-4 4" />
      <path d="M17 17H7" />
      <path d="M11 21l-4-4 4-4" />
    </svg>
  )
}

export function IconRestore({ className }: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" className={className}>
      <path d="M4 12a8 8 0 1114 5" />
      <path d="M4 12V6" />
      <path d="M4 6h6" />
    </svg>
  )
}
