import type { StatementPdfData, StatementLine, StatementLineType } from './statementPdfTypes.js'

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

// ── DFP → normalized ──────────────────────────────────────────────────────────

export type DfpStatementRaw = {
  id: string
  case_id: string
  periodo_inicio: string
  periodo_fin: string
  fecha_corte: string
  fecha_vencimiento: string | null
  balance_previo: number
  compras_periodo: number
  cargos_interes_periodo: number
  pagos_periodo: number
  nuevo_balance: number
  pago_minimo: number
  apr_tae: number | null
  status: string
}

export type DfpStatementLineRaw = {
  id: string
  transaction_date: string | null
  posting_date: string | null
  entry_type: string | null
  description: string
  amount: number
}

export function dfpStatementToStatementData(
  statement: DfpStatementRaw,
  lines: DfpStatementLineRaw[],
  cliente: ClienteSnap,
  caseEstado: string,
): StatementPdfData {
  let runningBalance = Number(statement.balance_previo || 0)
  const normalizedLines: StatementLine[] = lines.map(line => {
    const signedAmount = Number(line.amount || 0)
    runningBalance += signedAmount
    return {
      date: line.transaction_date ?? line.posting_date,
      description: line.description || line.entry_type || 'Movimiento',
      type: mapDfpLineType(line.entry_type, signedAmount),
      amount: Math.abs(signedAmount),
      runningBalance,
    }
  })

  const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || 'Cliente'

  return {
    accountType: 'dfp',
    caseId: statement.case_id,
    accountNumber: resolveAccountNumber(statement.case_id, cliente.hycite_id),
    emissionDate: statement.fecha_corte,
    periodStart: statement.periodo_inicio,
    periodEnd: statement.periodo_fin,

    clientName: nombre,
    address: cliente.direccion,
    city: cliente.ciudad,
    state: cliente.estado_region,
    zip: cliente.codigo_postal,
    phone: cliente.telefono,
    email: cliente.email,

    originalAmount: statement.compras_periodo,
    previousBalance: statement.balance_previo,
    paymentsAccumulated: 0,
    paymentsPeriod: statement.pagos_periodo,
    creditsPeriod: 0,
    interestCharges: statement.cargos_interes_periodo,
    feesPeriod: 0,
    pendingBalance: statement.nuevo_balance,
    projectedDueBalance: null,

    agreedMonthlyPayment: statement.pago_minimo,
    nextPaymentDate: statement.fecha_vencimiento,
    accountStatus: caseEstado,
    approvalDate: null,
    statementDate: statement.fecha_corte,
    dueDate: statement.fecha_vencimiento,
    interestPeriodStart: null,
    interestPeriodEnd: null,
    interestDays: null,

    apr: statement.apr_tae,
    interestApr: null,
    interestBasis: null,
    ytdInterest: null,
    ytdFees: null,

    lines: normalizedLines,
    documentStatus: mapDocumentStatus(statement.status),
  }
}

function mapDfpLineType(raw: string | null | undefined, amount: number): StatementLineType {
  const value = (raw ?? '').toLowerCase()

  if (value.includes('principal_initial') || value.includes('saldo_apertura') || value.includes('opening')) {
    return 'saldo_apertura'
  }
  if (value.includes('interest') || value.includes('interes')) {
    return 'cargo_interes'
  }
  if (value.includes('fee') || value.includes('cargo_fee') || value.includes('late')) {
    return 'cargo_fee'
  }
  if (value.includes('payment') || value.includes('pago')) {
    return 'pago'
  }
  if (value.includes('credit') || value.includes('credito') || value.includes('refund') || value.includes('reversal')) {
    return 'credito'
  }
  if (value.includes('adjust') || value.includes('ajuste')) {
    return 'ajuste'
  }

  return amount < 0 ? 'pago' : 'ajuste'
}

function mapDocumentStatus(status: string): StatementPdfData['documentStatus'] {
  const value = status.toLowerCase()
  if (value.includes('anulad')) return 'anulado'
  if (value.includes('enviad')) return 'enviado'
  if (value.includes('final')) return 'final'
  return 'draft'
}
