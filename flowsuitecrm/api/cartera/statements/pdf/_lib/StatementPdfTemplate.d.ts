import type { ReactElement } from 'react'

export type StatementPdfData = {
  accountType: 'cargo_vuelta' | 'dfp'
  caseId: string
  accountNumber: string
  emissionDate: string
  periodStart: string
  periodEnd: string
  clientName: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  originalAmount: number
  previousBalance: number
  paymentsAccumulated: number
  paymentsPeriod: number
  creditsPeriod: number
  interestCharges: number
  feesPeriod: number
  pendingBalance: number
  projectedDueBalance: number | null
  agreedMonthlyPayment: number | null
  nextPaymentDate: string | null
  accountStatus: string
  approvalDate: string | null
  statementDate: string | null
  dueDate: string | null
  interestPeriodStart: string | null
  interestPeriodEnd: string | null
  interestDays: number | null
  apr: number | null
  interestApr: number | null
  interestBasis: number | null
  ytdInterest: number | null
  ytdFees: number | null
  lines: Array<{
    date: string | null
    description: string
    type:
      | 'saldo_apertura'
      | 'pago'
      | 'credito'
      | 'ajuste'
      | 'cargo_interes'
      | 'cargo_fee'
      | 'saldo_cierre'
      | 'proximo_pago'
    amount: number
    runningBalance: number | null
  }>
  documentStatus: 'draft' | 'enviado' | 'final' | 'anulado'
}

export function StatementPdfTemplate(props: { data: StatementPdfData }): ReactElement
