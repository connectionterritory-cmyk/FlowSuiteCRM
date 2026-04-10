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
    .replace(/[{}|]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')

const toCanonicalName = (value: string) => {
  const normalized = normalizePlaceholderName(value)
  return ALIAS_MAP[normalized] ?? normalized
}

// Parse a raw placeholder like "nombre" or "nombre|\"amigo\"" into {key, fallback}
function parsePlaceholder(raw: string): { key: string; fallback: string | null } {
  const pipeIdx = raw.indexOf('|')
  if (pipeIdx === -1) return { key: toCanonicalName(raw), fallback: null }
  const key = toCanonicalName(raw.slice(0, pipeIdx))
  let fallback = raw.slice(pipeIdx + 1).trim()
  if (
    (fallback.startsWith('"') && fallback.endsWith('"')) ||
    (fallback.startsWith("'") && fallback.endsWith("'"))
  ) {
    fallback = fallback.slice(1, -1)
  }
  return { key, fallback: fallback || null }
}

// Normalize placeholders while preserving fallback syntax
export const canonicalizeTemplate = (message: string) => {
  const withDouble = message.replace(/\{\{\s*([^|}]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_match, raw, fallback) => {
    if (typeof fallback === 'string') {
      return `{{${toCanonicalName(raw)}|"${fallback}"}}`
    }
    return `{{${toCanonicalName(raw)}}}`
  })
  return withDouble.replace(/\{([^}]+)\}/g, (_match, raw) => {
    const pipeIdx = raw.indexOf('|')
    if (pipeIdx === -1) return `{${toCanonicalName(raw)}}`
    const key = toCanonicalName(raw.slice(0, pipeIdx))
    const fallbackPart = raw.slice(pipeIdx + 1).trim()
    return `{${key}|${fallbackPart}}`
  })
}

export const extractPlaceholders = (message: string) => {
  const keys = new Set<string>()
  message.replace(/\{\{\s*([^|}]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_match, raw) => {
    const { key } = parsePlaceholder(raw)
    keys.add(key)
    return ''
  })
  message.replace(/\{([^}]+)\}/g, (_match, raw) => {
    const { key } = parsePlaceholder(raw)
    keys.add(key)
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
  const withFallbacks = canonical.replace(/\{\{\s*([^|}]+)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g, (_match, raw, fallback) => {
    const { key } = parsePlaceholder(raw)
    const value = variables[key]
    if (value === null || value === undefined || value === '') {
      if (typeof fallback === 'string') return fallback
      missing.push(key)
      return ''
    }
    return String(value)
  })

  const text = withFallbacks.replace(/\{([^}]+)\}/g, (_match, raw) => {
    const { key, fallback } = parsePlaceholder(raw)
    const value = variables[key]
    if (value === null || value === undefined || value === '') {
      if (fallback !== null) return fallback
      missing.push(key)
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
