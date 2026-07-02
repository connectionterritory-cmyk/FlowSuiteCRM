import { supabase } from './supabase/client'

export type CarteraOpportunityGuardStatus = 'blocked' | 'warning' | 'clear'

export type CarteraOpportunityGuard = {
  status: CarteraOpportunityGuardStatus
  reason: string
  clienteId: string
  caseId: string | null
  classification: string | null
  montoMoroso: number
  diasAtraso: number
  ptpsActivas: number
  ptpsVencidas: number
  planesActivos: number
  saldoOperativo: number
}

type CarteraOperativaRow = {
  cliente_id: string
  case_id: string | null
  clasificacion_cartera: string | null
  monto_moroso: number | null
  dias_atraso: number | null
  ptps_activas_count: number | null
  ptps_vencidas_count: number | null
  plan_activo_count: number | null
  saldo_operativo: number | null
}

const EMPTY_GUARD = (clienteId: string): CarteraOpportunityGuard => ({
  status: 'clear',
  reason: 'Sin bloqueos de cartera',
  clienteId,
  caseId: null,
  classification: null,
  montoMoroso: 0,
  diasAtraso: 0,
  ptpsActivas: 0,
  ptpsVencidas: 0,
  planesActivos: 0,
  saldoOperativo: 0,
})

function normalizeGuard(clienteId: string, row: CarteraOperativaRow | null): CarteraOpportunityGuard {
  if (!row) return EMPTY_GUARD(clienteId)

  const montoMoroso = Number(row.monto_moroso ?? 0)
  const diasAtraso = Number(row.dias_atraso ?? 0)
  const ptpsActivas = Number(row.ptps_activas_count ?? 0)
  const ptpsVencidas = Number(row.ptps_vencidas_count ?? 0)
  const planesActivos = Number(row.plan_activo_count ?? 0)
  const saldoOperativo = Number(row.saldo_operativo ?? 0)
  const classification = row.clasificacion_cartera ?? null

  if (row.case_id || ptpsVencidas > 0 || planesActivos > 0 || saldoOperativo > 0) {
    const parts = [
      row.case_id ? 'Caso activo en cartera' : null,
      ptpsVencidas > 0 ? `${ptpsVencidas} PTP vencido${ptpsVencidas > 1 ? 's' : ''}` : null,
      planesActivos > 0 ? `${planesActivos} acuerdo${planesActivos > 1 ? 's' : ''} activo${planesActivos > 1 ? 's' : ''}` : null,
      saldoOperativo > 0 ? `saldo operativo ${saldoOperativo.toFixed(2)}` : null,
    ].filter(Boolean)

    return {
      status: 'blocked',
      reason: parts.join(' · ') || 'Resolver cartera primero',
      clienteId,
      caseId: row.case_id,
      classification,
      montoMoroso,
      diasAtraso,
      ptpsActivas,
      ptpsVencidas,
      planesActivos,
      saldoOperativo,
    }
  }

  if (montoMoroso > 0 || diasAtraso > 0 || ptpsActivas > 0) {
    const parts = [
      montoMoroso > 0 ? `monto moroso ${montoMoroso.toFixed(2)}` : null,
      diasAtraso > 0 ? `${diasAtraso} dias de atraso` : null,
      ptpsActivas > 0 ? `${ptpsActivas} PTP activo${ptpsActivas > 1 ? 's' : ''}` : null,
    ].filter(Boolean)

    return {
      status: 'warning',
      reason: parts.join(' · ') || 'Revisar cartera antes de vender',
      clienteId,
      caseId: row.case_id,
      classification,
      montoMoroso,
      diasAtraso,
      ptpsActivas,
      ptpsVencidas,
      planesActivos,
      saldoOperativo,
    }
  }

  return {
    status: 'clear',
    reason: 'Sin bloqueos de cartera',
    clienteId,
    caseId: row.case_id,
    classification,
    montoMoroso,
    diasAtraso,
    ptpsActivas,
    ptpsVencidas,
    planesActivos,
    saldoOperativo,
  }
}

export async function getCarteraOpportunityGuard(clienteId: string): Promise<CarteraOpportunityGuard> {
  if (!clienteId) return EMPTY_GUARD(clienteId)

  const { data, error } = await supabase
    .from('v_cartera_operativa')
    .select('cliente_id, case_id, clasificacion_cartera, monto_moroso, dias_atraso, ptps_activas_count, ptps_vencidas_count, plan_activo_count, saldo_operativo')
    .eq('cliente_id', clienteId)
    .maybeSingle()

  if (!error && data) {
    return normalizeGuard(clienteId, data as CarteraOperativaRow)
  }

  const { data: clienteData } = await supabase
    .from('clientes')
    .select('id, monto_moroso, dias_atraso')
    .eq('id', clienteId)
    .maybeSingle()

  if (!clienteData) return EMPTY_GUARD(clienteId)

  return normalizeGuard(clienteId, {
    cliente_id: clienteId,
    case_id: null,
    clasificacion_cartera: null,
    monto_moroso: (clienteData as { monto_moroso?: number | null }).monto_moroso ?? 0,
    dias_atraso: (clienteData as { dias_atraso?: number | null }).dias_atraso ?? 0,
    ptps_activas_count: 0,
    ptps_vencidas_count: 0,
    plan_activo_count: 0,
    saldo_operativo: 0,
  })
}
