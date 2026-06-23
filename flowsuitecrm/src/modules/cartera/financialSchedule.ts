const MS_PER_DAY = 24 * 60 * 60 * 1000

function parseYmdAsUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatUtcYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

export type ApprovedFinancingFirstStatementSchedule = {
  approvalDate: string
  statementDate: string
  dueDate: string
  interestPeriodStart: string
  interestPeriodEnd: string
  interestDays: number
}

export function calculateApprovedFinancingFirstStatementSchedule(
  approvalDate: string,
): ApprovedFinancingFirstStatementSchedule {
  const approval = parseYmdAsUtc(approvalDate)
  const statement = addUtcDays(approval, 10)
  const due = addUtcDays(statement, 10)

  return {
    approvalDate,
    statementDate: formatUtcYmd(statement),
    dueDate: formatUtcYmd(due),
    interestPeriodStart: approvalDate,
    interestPeriodEnd: formatUtcYmd(statement),
    interestDays: Math.max(Math.round((statement.getTime() - approval.getTime()) / MS_PER_DAY), 0),
  }
}

export function calculateDailySimple365Interest(
  principal: number,
  apr: number,
  days: number,
): number {
  if (!Number.isFinite(principal) || !Number.isFinite(apr) || !Number.isFinite(days)) return 0
  if (principal <= 0 || apr <= 0 || days <= 0) return 0
  return Math.round((principal * apr / 365 * days) * 100) / 100
}
