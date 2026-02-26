export type ParsedAddress = {
  direccion: string
  ciudad: string
  estado_region: string
  codigo_postal: string
}

function capitalizeWords(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

export function capitalizeProperName(name: string): string {
  return capitalizeWords(name.trim())
}

/**
 * Parses common US address formats pasted as a single string.
 * Handles:
 *  - "103 NW 32ND AVE\n33147 MIAMI, FL"
 *  - "103 NW 32ND AVE, 33147 MIAMI, FL"
 *  - "103 NW 32ND AVE, MIAMI, FL 33147"
 *  - "103 NW 32ND AVE\nMIAMI, FL 33147"
 *  - "103 NW 32ND AVE APT 2\n33147 MIAMI, FL"
 */
export function parseUsAddress(raw: string): ParsedAddress | null {
  if (!raw || raw.trim().length < 5) return null
  const text = raw.trim()

  // Pattern 1 (newline): "STREET\nZIP CITY, STATE"
  const p1 = text.match(/^(.+)\n(\d{5})\s+([^,\n]+),\s*([A-Za-z]{2})$/)
  if (p1) {
    return {
      direccion: p1[1].trim(),
      codigo_postal: p1[2],
      ciudad: capitalizeWords(p1[3].trim()),
      estado_region: p1[4].toUpperCase(),
    }
  }

  // Pattern 2 (comma): "STREET, ZIP CITY, STATE"
  const p2 = text.match(/^(.+),\s*(\d{5})\s+([^,]+),\s*([A-Za-z]{2})$/)
  if (p2) {
    return {
      direccion: p2[1].trim(),
      codigo_postal: p2[2],
      ciudad: capitalizeWords(p2[3].trim()),
      estado_region: p2[4].toUpperCase(),
    }
  }

  // Pattern 3: "STREET, CITY, STATE ZIP"
  const p3 = text.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5})$/)
  if (p3) {
    return {
      direccion: p3[1].trim(),
      ciudad: capitalizeWords(p3[2].trim()),
      estado_region: p3[3].toUpperCase(),
      codigo_postal: p3[4],
    }
  }

  // Pattern 4 (newline): "STREET\nCITY, STATE ZIP"
  const p4 = text.match(/^(.+)\n([^,\n]+),\s*([A-Za-z]{2})\s+(\d{5})$/)
  if (p4) {
    return {
      direccion: p4[1].trim(),
      ciudad: capitalizeWords(p4[2].trim()),
      estado_region: p4[3].toUpperCase(),
      codigo_postal: p4[4],
    }
  }

  // Pattern 5: "STREET, CITY STATE ZIP" (no second comma)
  const p5 = text.match(/^(.+),\s*([A-Za-z][^,]*?)\s+([A-Za-z]{2})\s+(\d{5})$/)
  if (p5) {
    return {
      direccion: p5[1].trim(),
      ciudad: capitalizeWords(p5[2].trim()),
      estado_region: p5[3].toUpperCase(),
      codigo_postal: p5[4],
    }
  }

  return null
}

/**
 * Builds a Google Maps navigation URL from address parts.
 * No API key required — opens Google Maps in a new tab.
 */
type AddressParts = {
  direccion?: string | null
  ciudad?: string | null
  estado_region?: string | null
  codigo_postal?: string | null
}

function normalizeAddressParts(parts: AddressParts): AddressParts {
  let { direccion, ciudad, estado_region, codigo_postal } = parts
  if (direccion && direccion.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(direccion) as Partial<AddressParts> & { apartamento?: string | null }
      if (parsed && typeof parsed === 'object') {
        direccion = parsed.direccion ?? direccion
        ciudad = ciudad ?? parsed.ciudad
        estado_region = estado_region ?? parsed.estado_region
        codigo_postal = codigo_postal ?? parsed.codigo_postal
      }
    } catch {
    }
  }
  return { direccion, ciudad, estado_region, codigo_postal }
}

export function formatAddressLabel(parts: AddressParts): string | null {
  const normalized = normalizeAddressParts(parts)
  const segments = [normalized.direccion, normalized.ciudad, normalized.estado_region, normalized.codigo_postal]
    .filter(Boolean)
  if (segments.length === 0) return null
  return segments.join(', ')
}

export function buildMapsNavUrl(parts: AddressParts): string | null {
  const query = formatAddressLabel(parts)
  if (!query) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * Formats a phone number as a tel: link href (strips non-digits, adds +1 for US).
 */
export function buildTelUrl(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return `tel:${phone}`
  // If 10 digits, assume US +1
  if (digits.length === 10) return `tel:+1${digits}`
  // If already 11 digits starting with 1, add +
  if (digits.length === 11 && digits[0] === '1') return `tel:+${digits}`
  return `tel:+${digits}`
}
