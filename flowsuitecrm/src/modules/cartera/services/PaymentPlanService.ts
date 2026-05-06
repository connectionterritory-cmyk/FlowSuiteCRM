export type PaymentPlanInput = {
  balance: number
  tasa_anual_pct: number
  numero_cuotas: number
  fecha_primer_pago: string
  dia_debito: number
  fee_setup?: number
  fee_late?: number
  estadoCuotaInicial?: 'programada' | 'pendiente'
}

export type InstallmentRow = {
  numero_cuota: number
  fecha_vencimiento: string
  monto_programado: number
  principal_programado: number
  interes_programado: number
  fees_programados: number
  monto_pagado: number
  saldo_cuota: number
  estado: 'programada' | 'pendiente'
}

export type PaymentPlanSummary = {
  monto_cuota_estimado: number
  tasa_mensual_pct: number
  fecha_fin_estimada: string
  total_principal: number
  total_interes: number
  total_fees: number
  total_programado: number
}

const MAX_CUOTAS = 120
const MAX_TASA_ANUAL = 36
const MAX_DIA_DEBITO = 31
const MIN_DIA_DEBITO = 1
const CENTS = 100

function round2(value: number): number {
  return Math.round(value * CENTS) / CENTS
}

function toCents(value: number): number {
  return Math.round(value * CENTS)
}

function fromCents(value: number): number {
  return value / CENTS
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = parseDateYmd(value)
  return !Number.isNaN(d.getTime())
}

function parseDateYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDateYmd(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function lastDayOfMonthUtc(year: number, monthIndexZeroBased: number): number {
  return new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate()
}

function addMonthsWithClampedDay(baseDate: Date, monthsToAdd: number, preferredDay: number): Date {
  const year = baseDate.getUTCFullYear()
  const month = baseDate.getUTCMonth()
  const target = new Date(Date.UTC(year, month + monthsToAdd, 1))
  const maxDay = lastDayOfMonthUtc(target.getUTCFullYear(), target.getUTCMonth())
  const day = Math.min(preferredDay, maxDay)
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day))
}

export function validatePaymentPlanInput(input: PaymentPlanInput): void {
  if (!Number.isFinite(input.balance) || input.balance <= 0) {
    throw new Error('balance must be greater than 0')
  }
  if (!Number.isInteger(input.numero_cuotas) || input.numero_cuotas < 1 || input.numero_cuotas > MAX_CUOTAS) {
    throw new Error('numero_cuotas must be between 1 and 120')
  }
  if (!Number.isFinite(input.tasa_anual_pct) || input.tasa_anual_pct < 0 || input.tasa_anual_pct > MAX_TASA_ANUAL) {
    throw new Error('tasa_anual_pct must be between 0 and 36')
  }
  if (!Number.isInteger(input.dia_debito) || input.dia_debito < MIN_DIA_DEBITO || input.dia_debito > MAX_DIA_DEBITO) {
    throw new Error('dia_debito must be between 1 and 31')
  }
  if (!isValidDateString(input.fecha_primer_pago)) {
    throw new Error('fecha_primer_pago must be a valid date in YYYY-MM-DD format')
  }
  if (input.fee_setup !== undefined && (!Number.isFinite(input.fee_setup) || input.fee_setup < 0)) {
    throw new Error('fee_setup must be >= 0')
  }
  if (input.fee_late !== undefined && (!Number.isFinite(input.fee_late) || input.fee_late < 0)) {
    throw new Error('fee_late must be >= 0')
  }
}

export function calculateInstallmentAmount(params: {
  principal: number
  tasa_anual_pct: number
  numero_cuotas: number
}): number {
  const { principal, tasa_anual_pct, numero_cuotas } = params
  if (principal <= 0 || numero_cuotas <= 0) return 0

  const monthlyRate = tasa_anual_pct / 100 / 12
  if (monthlyRate === 0) return round2(principal / numero_cuotas)

  const factor = Math.pow(1 + monthlyRate, numero_cuotas)
  const cuota = principal * ((monthlyRate * factor) / (factor - 1))
  return round2(cuota)
}

export function generateInstallmentSchedule(input: PaymentPlanInput): InstallmentRow[] {
  validatePaymentPlanInput(input)

  const principalCents = toCents(input.balance)
  const n = input.numero_cuotas
  const monthlyRate = input.tasa_anual_pct / 100 / 12
  const estado = input.estadoCuotaInicial ?? 'programada'

  const firstDate = parseDateYmd(input.fecha_primer_pago)
  const preferredDay = input.dia_debito

  const cuotaBaseCents = toCents(
    calculateInstallmentAmount({
      principal: input.balance,
      tasa_anual_pct: input.tasa_anual_pct,
      numero_cuotas: n,
    }),
  )

  const rows: InstallmentRow[] = []
  let principalRemainingCents = principalCents

  for (let i = 1; i <= n; i += 1) {
    const isLast = i === n
    const dueDate = addMonthsWithClampedDay(firstDate, i - 1, preferredDay)

    const interestCents = monthlyRate === 0
      ? 0
      : Math.round(principalRemainingCents * monthlyRate)

    let principalPartCents = cuotaBaseCents - interestCents
    if (principalPartCents < 0) principalPartCents = 0

    if (isLast) {
      principalPartCents = principalRemainingCents
    } else if (principalPartCents > principalRemainingCents) {
      principalPartCents = principalRemainingCents
    }

    const installmentCents = principalPartCents + interestCents
    principalRemainingCents -= principalPartCents
    if (principalRemainingCents < 0) principalRemainingCents = 0

    rows.push({
      numero_cuota: i,
      fecha_vencimiento: formatDateYmd(dueDate),
      monto_programado: fromCents(installmentCents),
      principal_programado: fromCents(principalPartCents),
      interes_programado: fromCents(interestCents),
      fees_programados: 0,
      monto_pagado: 0,
      saldo_cuota: fromCents(installmentCents),
      estado,
    })
  }

  return rows
}

export function calculatePaymentPlanSummary(input: PaymentPlanInput): PaymentPlanSummary {
  const schedule = generateInstallmentSchedule(input)
  const tasaMensualPct = round2(input.tasa_anual_pct / 12)
  const fechaFin = schedule[schedule.length - 1]?.fecha_vencimiento ?? input.fecha_primer_pago

  const totalPrincipal = round2(schedule.reduce((sum, row) => sum + row.principal_programado, 0))
  const totalInteres = round2(schedule.reduce((sum, row) => sum + row.interes_programado, 0))
  const totalFees = round2((input.fee_setup ?? 0) + (input.fee_late ?? 0))
  const totalProgramado = round2(schedule.reduce((sum, row) => sum + row.monto_programado, 0) + totalFees)

  return {
    monto_cuota_estimado: schedule[0]?.monto_programado ?? 0,
    tasa_mensual_pct: tasaMensualPct,
    fecha_fin_estimada: fechaFin,
    total_principal: totalPrincipal,
    total_interes: totalInteres,
    total_fees: totalFees,
    total_programado: totalProgramado,
  }
}

export const PaymentPlanService = {
  validatePaymentPlanInput,
  calculateInstallmentAmount,
  generateInstallmentSchedule,
  calculatePaymentPlanSummary,
}

