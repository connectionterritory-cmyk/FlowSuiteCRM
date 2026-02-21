export const MIN_REFERIDOS_CI = 20
export const MIN_REFERIDOS_DRAFT = 1

export const CI_REFERIDO_ESTADOS = [
  'pendiente',
  'contactado',
  'cita_agendada',
  'presentacion_hecha',
  'regalo_entregado',
] as const

export const CI_RELACIONES = ['familiar', 'amigo', 'companero'] as const

export type CiReferidoEstado = (typeof CI_REFERIDO_ESTADOS)[number]
export type CiRelacion = (typeof CI_RELACIONES)[number]

export type ReferidoFormRow = {
  nombre: string
  telefono: string
  relacion: CiRelacion
}

export type ActivationState = 'borrador' | 'activo' | 'completo'

export type ActivationStateInput = {
  referidosCount: number
  photoPath: string | null
  whatsappAt: string | null
}

export const formatPhone = (value: string) => {
  const digits = stripPhone(value).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export const stripPhone = (value: string) => value.replace(/\D/g, '')

export const toE164 = (value: string, defaultCountryCode = '1') => {
  const digits = stripPhone(value)
  if (!digits) return null
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`
  if (digits.startsWith('+')) return digits
  return `+${digits}`
}

export const isReferidoComplete = (row: ReferidoFormRow) =>
  row.nombre.trim() !== '' && stripPhone(row.telefono).length > 0

export const isReferidoPartial = (row: ReferidoFormRow) => {
  const hasName = row.nombre.trim() !== ''
  const hasPhone = stripPhone(row.telefono).length > 0
  return (hasName || row.telefono.trim() !== '') && (!hasName || !hasPhone)
}

export const normalizeReferido = (row: ReferidoFormRow) => ({
  nombre: row.nombre.trim(),
  telefono: stripPhone(row.telefono),
  relacion: row.relacion,
})

export const getActivationState = ({ referidosCount, photoPath, whatsappAt }: ActivationStateInput) => {
  if (whatsappAt) return 'completo'
  if (referidosCount >= MIN_REFERIDOS_CI && photoPath) return 'activo'
  return 'borrador'
}
