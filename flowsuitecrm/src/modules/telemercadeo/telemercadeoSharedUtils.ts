import type { Cliente } from './TelemercadeoShared'

export function nombreCompleto(c: Cliente): string {
  return [c.nombre, c.apellido].filter(Boolean).join(' ') || 'Sin nombre'
}

export function segmentoColor(dias: number | null, _moroso: number | null): string {
  if (!dias || dias <= 0) return '#10b981'
  if (dias >= 91) return '#7c3aed'
  if (dias >= 61) return '#dc2626'
  if (dias >= 31) return '#ea580c'
  return '#f59e0b'
}

export function segmentoLabel(dias: number | null, _moroso: number | null): string {
  if (!dias || dias <= 0) return 'Al dia'
  if (dias >= 91) return '+90 dias'
  if (dias >= 61) return '61-90 dias'
  if (dias >= 31) return '31-60 dias'
  return '0-30 dias'
}

export function resultadoLabel(resultado: string): string {
  const map: Record<string, string> = {
    llamada: 'Llamada',
    contesto: 'Contesto',
    no_contesta: 'No contesto',
    ocupado: 'Ocupado',
    buzon_voz: 'Buzon de voz',
    cita_agendada: 'Cita agendada',
    promesa_pago: 'Promesa de pago',
    pago_prometido: 'Promesa de pago',
    pago_realizado: 'Pago',
    interesado: 'Interesado',
    no_interesado: 'No interesado',
    numero_equivocado: 'Numero equivocado',
  }
  return map[resultado] ?? resultado
}

export function resultadoColor(resultado: string): string {
  const map: Record<string, string> = {
    llamada: '#6b7280',
    contesto: '#10b981',
    no_contesta: '#6b7280',
    ocupado: '#f59e0b',
    buzon_voz: '#64748b',
    cita_agendada: '#3b82f6',
    promesa_pago: '#f59e0b',
    pago_prometido: '#f59e0b',
    pago_realizado: '#10b981',
    interesado: '#10b981',
    no_interesado: '#ef4444',
    numero_equivocado: '#9ca3af',
  }
  return map[resultado] ?? '#6b7280'
}

export function formatFechaCorta(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function diasParaCumple(fechaNacimiento: string | null): number {
  if (!fechaNacimiento) return 999
  const hoy = new Date()
  const hoyNorm = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const nac = new Date(`${fechaNacimiento}T00:00:00`)
  const proxCumple = new Date(hoy.getFullYear(), nac.getMonth(), nac.getDate())
  if (proxCumple < hoyNorm) proxCumple.setFullYear(hoy.getFullYear() + 1)
  return Math.round((proxCumple.getTime() - hoyNorm.getTime()) / (1000 * 60 * 60 * 24))
}
