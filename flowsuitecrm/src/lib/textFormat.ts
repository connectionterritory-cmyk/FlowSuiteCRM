const toTitleCase = (value: string) => {
  const lower = value.toLowerCase()
  return lower.replace(/(^|[.\s])(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
}

export const formatProperName = (value: string) => toTitleCase(value.trim())

export const formatProperText = (value: string) => toTitleCase(value.trim())

export const formatStateRegion = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (/^[A-Za-z]{2,3}$/.test(trimmed)) return trimmed.toUpperCase()
  return toTitleCase(trimmed)
}
