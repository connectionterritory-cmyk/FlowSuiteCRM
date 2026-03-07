export type PlaceholderOption = {
  group: string
  label: string
  token: string
}

const ALIAS_MAP: Record<string, string> = {
  cliente: 'nombre',
  vendedor: 'vendedor_nombre',
  responsable: 'responsable_nombre',
  recomendado_por: 'recomendado_por_nombre',
  telefono_vendedor: 'vendedor_telefono',
}

export const PLACEHOLDER_OPTIONS: PlaceholderOption[] = [
  { group: 'Basico', label: 'Nombre', token: '{nombre}' },
  { group: 'Basico', label: 'Telefono', token: '{telefono}' },
  { group: 'Basico', label: 'Email', token: '{email}' },
  { group: 'Relacion', label: 'Vendedor', token: '{vendedor_nombre}' },
  { group: 'Relacion', label: 'Telefono vendedor', token: '{vendedor_telefono}' },
  { group: 'Relacion', label: 'Responsable', token: '{responsable_nombre}' },
  { group: 'Relacion', label: 'Recomendado por', token: '{recomendado_por_nombre}' },
  { group: 'Origen', label: 'Fuente', token: '{fuente}' },
  { group: 'Origen', label: 'Programa', token: '{programa}' },
  { group: 'Origen', label: 'Ciudad', token: '{ciudad}' },
  { group: 'Cartera', label: 'Cuenta Hycite', token: '{cuenta_hycite}' },
  { group: 'Cartera', label: 'Saldo actual', token: '{saldo_actual}' },
  { group: 'Cartera', label: 'Monto moroso', token: '{monto_moroso}' },
  { group: 'Cartera', label: 'Dias atraso', token: '{dias_atraso}' },
  { group: 'Cartera', label: 'Estado morosidad', token: '{estado_morosidad}' },
]

const removeAccents = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export const normalizePlaceholderName = (value: string) =>
  removeAccents(value)
    .replace(/[{}]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')

const toCanonicalName = (value: string) => {
  const normalized = normalizePlaceholderName(value)
  return ALIAS_MAP[normalized] ?? normalized
}

export const canonicalizeTemplate = (message: string) =>
  message.replace(/\{([^}]+)\}/g, (_match, key) => `{${toCanonicalName(key)}}`)

export const extractPlaceholders = (message: string) => {
  const keys = new Set<string>()
  const canonical = canonicalizeTemplate(message)
  canonical.replace(/\{([^}]+)\}/g, (_match, key) => {
    keys.add(toCanonicalName(key))
    return ''
  })
  return Array.from(keys)
}

export const resolveTemplate = (
  message: string,
  variables: Record<string, string | null | undefined>
) => {
  const missing: string[] = []
  const canonical = canonicalizeTemplate(message)
  const text = canonical.replace(/\{([^}]+)\}/g, (_match, key) => {
    const canonicalKey = toCanonicalName(key)
    const value = variables[canonicalKey]
    if (value === null || value === undefined || value === '') {
      missing.push(canonicalKey)
      return ''
    }
    return String(value)
  })

  return {
    text,
    missing: Array.from(new Set(missing)),
    canonical,
  }
}
