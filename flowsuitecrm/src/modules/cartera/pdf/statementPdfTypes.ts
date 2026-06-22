// ── Normalized data contract for StatementPdfTemplate ────────────────────────
// Both DFP (cob_statements) and Cargo de Vuelta (cob_cv_resumenes) must be
// converted to this shape before being passed to the PDF template.

export type AccountType = 'cargo_vuelta' | 'dfp'

export type StatementLineType =
  | 'saldo_apertura'
  | 'pago'
  | 'credito'
  | 'ajuste'
  | 'cargo_interes'
  | 'cargo_fee'
  | 'saldo_cierre'
  | 'proximo_pago'

export type StatementLine = {
  date: string | null        // ISO date
  description: string
  type: StatementLineType
  amount: number             // always positive; sign conveyed by type
  runningBalance: number | null
}

export type StatementPdfData = {
  // Document identity
  accountType: AccountType
  caseId: string
  accountNumber: string      // hycite_id if available, else first-8 of caseId
  emissionDate: string       // ISO date — fecha_corte or today
  periodStart: string        // ISO date
  periodEnd: string          // ISO date

  // Client
  clientName: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null

  // Account summary
  originalAmount: number          // monto_original (CV) | saldo_principal_inicial (DFP)
  previousBalance: number         // saldo_apertura_periodo (CV) | balance_previo (DFP)
  paymentsAccumulated: number     // pagos_acumulados (CV) | — (DFP n/a)
  paymentsPeriod: number          // pagos_periodo (both)
  creditsPeriod: number           // creditos_periodo + ajustes_periodo (CV) | otros_creditos (DFP)
  interestCharges: number         // 0 for CV | cargos_interes_periodo (DFP)
  feesPeriod: number              // fee_plataforma_periodo (CV) | cargos_totales_periodo (DFP)
  pendingBalance: number          // saldo_pendiente_corte (CV) | nuevo_balance (DFP)
  projectedDueBalance: number | null

  // Payment info
  agreedMonthlyPayment: number | null   // proximo_pago_esperado (CV) | pago_minimo (DFP)
  nextPaymentDate: string | null        // fecha_proximo_pago (CV) | fecha_vencimiento (DFP)
  accountStatus: string                 // derived from case estado
  approvalDate: string | null
  statementDate: string | null
  dueDate: string | null
  interestPeriodStart: string | null
  interestPeriodEnd: string | null
  interestDays: number | null

  // DFP-only fields (null for CV)
  apr: number | null              // apr_tae (DFP)
  interestApr: number | null      // APR snapshoteado del statement CV
  interestBasis: number | null    // balance_sujeto_interes (DFP)
  ytdInterest: number | null
  ytdFees: number | null

  // Transactions detail
  lines: StatementLine[]

  // Status
  documentStatus: 'draft' | 'enviado' | 'final' | 'anulado'
}
