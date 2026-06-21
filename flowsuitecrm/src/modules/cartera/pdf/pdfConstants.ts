export const CWG = {
  name: 'CONNECTION WORLDWIDE GROUP',
  tagline: 'Distribuidor Autorizado Royal Prestige',
  phone: '(786) 291-3042',
  email: 'servicioalcliente@connectionww.com',
  address: '23501 SW 115th Ave #386, Miami, FL 33170',
  paymentUrl: 'payments.connectionww.com',
  supportEmail: 'soporte@connectionww.com',
  hours: 'Lunes a Viernes: 9:00 a.m. – 6:00 p.m. (EST)',
  privacyUrl: 'https://www.connectionww.com/privacy-policy',
  copyright: `© ${new Date().getFullYear()} Connection Worldwide Group. Todos los derechos reservados.`,
} as const

export const COLORS = {
  navy: '#0f2044',
  navyMid: '#1a3a6e',
  blue: '#1e40af',
  blueMid: '#2563eb',
  blueLight: '#dbeafe',
  green: '#15803d',
  greenLight: '#dcfce7',
  red: '#dc2626',
  redLight: '#fee2e2',
  gray: '#6b7280',
  grayLight: '#f3f4f6',
  border: '#e5e7eb',
  white: '#ffffff',
  text: '#111827',
  textMuted: '#6b7280',
  gold: '#d4af37',
} as const

export const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  oblique: 'Helvetica-Oblique',
} as const

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  cargo_vuelta: 'Cargo de Vuelta',
  dfp: 'DFP / Revolving',
}

export const LINE_TYPE_LABEL: Record<string, string> = {
  saldo_apertura: 'Saldo inicial',
  pago: 'Pago',
  credito: 'Crédito',
  ajuste: 'Ajuste',
  cargo_interes: 'Cargo de interés',
  cargo_fee: 'Fee',
  saldo_cierre: 'Saldo al cierre',
  proximo_pago: 'Próximo pago',
}
