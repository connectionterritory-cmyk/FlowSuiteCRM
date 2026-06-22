import type { StatementPdfData, StatementLine, StatementLineType } from './statementPdfTypes'

// ── Raw types from Supabase queries ──────────────────────────────────────────

export type CvResumenRaw = {
  id: string
  case_id: string
  cliente_id: string
  periodo_inicio: string
  periodo_fin: string
  fecha_corte: string
  approval_date_snapshot: string | null
  statement_date_snapshot: string | null
  due_date_snapshot: string | null
  interest_period_start_snapshot: string | null
  interest_period_end_snapshot: string | null
  interest_days_snapshot: number | null
  interest_apr_snapshot: number | null
  interest_amount_periodo: number
  balance_proyectado_due_date: number | null
  monto_original: number
  saldo_apertura_periodo: number
  pagos_periodo: number
  pagos_acumulados: number
  fee_plataforma_periodo: number
  creditos_periodo: number
  ajustes_periodo: number
  saldo_pendiente_corte: number
  proximo_pago_esperado: number | null
  fecha_proximo_pago: string | null
  status: 'draft' | 'enviado' | 'anulado'
}

export type CvResumenLineRaw = {
  id: string
  line_number: number
  line_type: string
  event_date: string | null
  description: string
  monto_aplicado_balance: number
  fee_plataforma: number
  monto_total_cobrado_cliente: number
  running_balance_after: number | null
}

export type ClienteSnap = {
  nombre: string | null
  apellido: string | null
  hycite_id: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
}

// ── CV → normalized ───────────────────────────────────────────────────────────

function resolveAccountNumber(caseId: string, hyciteId: string | null | undefined): string {
  if (hyciteId) return hyciteId
  return caseId.toUpperCase().slice(0, 8)
}

export function cvResumenToStatementData(
  resumen: CvResumenRaw,
  lines: CvResumenLineRaw[],
  cliente: ClienteSnap,
  caseId: string,
  caseEstado: string,
): StatementPdfData {
  const sortedLines = [...lines].sort((a, b) => a.line_number - b.line_number)

  const normalizedLines: StatementLine[] = sortedLines.map(l => ({
    date: l.event_date,
    description: l.description,
    type: mapCvLineType(l.line_type),
    amount: l.monto_aplicado_balance > 0
      ? l.monto_aplicado_balance
      : l.monto_total_cobrado_cliente,
    runningBalance: l.running_balance_after,
  }))

  const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || 'Cliente'

  return {
    accountType: 'cargo_vuelta',
    caseId,
    accountNumber: resolveAccountNumber(caseId, cliente.hycite_id),
    emissionDate: resumen.fecha_corte,
    periodStart: resumen.periodo_inicio,
    periodEnd: resumen.periodo_fin,

    clientName: nombre,
    address: cliente.direccion,
    city: cliente.ciudad,
    state: cliente.estado_region,
    zip: cliente.codigo_postal,
    phone: cliente.telefono,
    email: cliente.email,

    originalAmount: resumen.monto_original,
    previousBalance: resumen.saldo_apertura_periodo,
    paymentsAccumulated: resumen.pagos_acumulados,
    paymentsPeriod: resumen.pagos_periodo,
    creditsPeriod: resumen.creditos_periodo + resumen.ajustes_periodo,
    interestCharges: resumen.interest_amount_periodo,
    feesPeriod: resumen.fee_plataforma_periodo,
    pendingBalance: resumen.saldo_pendiente_corte,
    projectedDueBalance: resumen.balance_proyectado_due_date,

    agreedMonthlyPayment: resumen.proximo_pago_esperado,
    nextPaymentDate: resumen.fecha_proximo_pago,
    accountStatus: caseEstado,
    approvalDate: resumen.approval_date_snapshot,
    statementDate: resumen.statement_date_snapshot,
    dueDate: resumen.due_date_snapshot,
    interestPeriodStart: resumen.interest_period_start_snapshot,
    interestPeriodEnd: resumen.interest_period_end_snapshot,
    interestDays: resumen.interest_days_snapshot,

    apr: null,
    interestApr: resumen.interest_apr_snapshot,
    interestBasis: null,
    ytdInterest: null,
    ytdFees: null,

    lines: normalizedLines,
    documentStatus: resumen.status === 'enviado' ? 'enviado' : resumen.status === 'anulado' ? 'anulado' : 'draft',
  }
}

function mapCvLineType(raw: string): StatementLineType {
  const map: Record<string, StatementLineType> = {
    saldo_apertura: 'saldo_apertura',
    pago: 'pago',
    credito: 'credito',
    ajuste: 'ajuste',
    cargo_interes: 'cargo_interes',
    saldo_cierre: 'saldo_cierre',
    proximo_pago: 'proximo_pago',
  }
  return map[raw] ?? 'ajuste'
}

// ── DFP → normalized (stub, Phase 2) ─────────────────────────────────────────
// When DFP is implemented, add dfpStatementToStatementData() here following
// the same contract. The template receives the same StatementPdfData shape.
