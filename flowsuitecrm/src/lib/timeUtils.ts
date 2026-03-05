/**
 * Normalizes a time string into the HH:mm format required by <input type="time">.
 * Handles:
 * - HH:mm:ss, HH:mm, or H:mm:ss, H:mm
 * - AM/PM formats: "5:30 PM", "05:30PM", "5:30pm", etc.
 */
export function normalizeTimeValue(value?: string | null): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  // 1. Handle formats HH:mm:ss, HH:mm, H:mm, etc. (without AM/PM)
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})/)
  if (timeMatch && !trimmed.toLowerCase().includes('m')) {
    const hours = timeMatch[1].padStart(2, '0')
    const minutes = timeMatch[2]
    return `${hours}:${minutes}`
  }

  // 2. Handle AM/PM formats (e.g. "5:30 PM", "05:30PM", "5:30pm")
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])/)
  if (ampmMatch) {
    let hours = Number(ampmMatch[1])
    const minutes = ampmMatch[2]
    const period = ampmMatch[3].toLowerCase()

    if (period === 'pm' && hours < 12) hours += 12
    if (period === 'am' && hours === 12) hours = 0

    return `${String(hours).padStart(2, '0')}:${minutes}`
  }

  // If already matches HH:mm but didn't match above for some reason
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed

  return trimmed
}
