import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement>

const baseProps = {
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconDashboard(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </svg>
  )
}

export function IconPipeline(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 7h6v10H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M14 14h6v6h-6z" />
    </svg>
  )
}

export function IconLeads(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M12 3l3 6 6 .5-4.5 4 1.5 6-6-3.3-6 3.3 1.5-6L3 9.5 9 9z" />
    </svg>
  )
}

export function IconCustomers(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="8" r="3" />
      <path d="M3 20c.5-3 3-5 5-5s4.5 2 5 5" />
      <path d="M12 20c.4-2.2 2.5-4 4.6-4 2 0 3.9 1.8 4.4 4" />
    </svg>
  )
}

export function IconSales(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M6 8h12l-1.2 11H7.2L6 8z" />
      <path d="M9 8V6a3 3 0 016 0v2" />
    </svg>
  )
}

export function IconProducts(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 7l8-4 8 4-8 4-8-4z" />
      <path d="M4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </svg>
  )
}

export function IconPrograms(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </svg>
  )
}

export function IconConnections(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M8 7c-2.2 0-4 1.8-4 4s1.8 4 4 4c1.3 0 2.4-.6 3.1-1.6" />
      <path d="M16 17c2.2 0 4-1.8 4-4s-1.8-4-4-4c-1.3 0-2.4.6-3.1 1.6" />
      <path d="M10 12h4" />
    </svg>
  )
}

export function Icon4en14(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </svg>
  )
}

export function IconService(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      <path d="M12 20a4 4 0 004-4" />
      <path d="M8 20a4 4 0 01-4-4" />
      <path d="M12 12v3" />
      <circle cx="12" cy="18" r="1" />
    </svg>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  )
}

export function IconWhatsapp(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M7 10a5 5 0 015-5h0a5 5 0 110 10H9l-4 4 1.5-4.5A5 5 0 017 10z" />
      <path d="M10 10h4" />
      <path d="M10 12h3" />
    </svg>
  )
}

export function IconSms(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 6h16a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 4v-4H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
      <path d="M8 10h8" />
    </svg>
  )
}

export function IconMail(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <rect x="6" y="7" width="12" height="13" rx="2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

export function IconSwap(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M7 7h10" />
      <path d="M13 3l4 4-4 4" />
      <path d="M17 17H7" />
      <path d="M11 21l-4-4 4-4" />
    </svg>
  )
}

export function IconRestore(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 12a8 8 0 1114 5" />
      <path d="M4 12V6" />
      <path d="M4 6h6" />
    </svg>
  )
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 5.5l4-2 3 3-2 4c1.6 2.3 3.7 4.4 6 6l4-2 3 3-2 4" />
      <path d="M7 3.5c0 8.5 6.9 15.5 15.5 15.5" />
    </svg>
  )
}

export function IconPaperclip(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

export function IconFile(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M13 2v7h7" />
    </svg>
  )
}

export function IconX(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

export function IconLoader(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

export function IconImage(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}

export function IconBold(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
      <path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
    </svg>
  )
}

export function IconItalic(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  )
}

export function IconList(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

export function IconClock(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

export function IconSave(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function IconCloud(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
    </svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

export function IconShare(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
    </svg>
  )
}

export function IconFilter(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function IconSend(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export function IconSendHorizontal(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M22 2L2 8.66l5.33 2.67L22 2zM22 2l-7.33 14.67-2.67-5.34L22 2zM9 13v7l3-3" />
    </svg>
  )
}

export function IconNavigation(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  )
}

export function IconUser(props: IconProps) {
  return (
    <svg {...baseProps} viewBox="0 0 24 24" {...props}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

// Aliases for the messaging module
export { 
  IconWhatsapp as WhatsappIcon,
  IconMail as MailIcon,
  IconSms as MessageSquareIcon,
  IconPaperclip as PaperclipIcon,
  IconFile as FileIcon,
  IconX as XIcon,
  IconLoader as LoaderIcon,
  IconImage as ImageIcon,
  IconBold as BoldIcon,
  IconItalic as ItalicIcon,
  IconList as ListIcon,
  IconClock as ClockIcon,
  IconSave as SaveIcon,
  IconSearch as SearchIcon,
  IconCloud as CloudIcon,
  IconSettings as SettingsIcon,
  IconShare as ShareIcon,
  IconFilter as FilterIcon,
  IconPlus as PlusIcon,
  IconSend as SendIcon,
  IconSendHorizontal as SendHorizontalIcon,
  IconNavigation as NavigationIcon,
  IconUser as UserIcon,
  IconTrash as TrashIcon
}
