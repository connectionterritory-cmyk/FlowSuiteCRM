import { expect, test } from '@playwright/test'
import {
  calculateApprovedFinancingFirstStatementSchedule,
  calculateDailySimple365Interest,
} from '../../src/modules/cartera/financialSchedule'

test('alinea el primer statement aprobado para CV y DFP', async () => {
  const schedule = calculateApprovedFinancingFirstStatementSchedule('2025-08-14')

  expect(schedule).toEqual({
    approvalDate: '2025-08-14',
    statementDate: '2025-08-24',
    dueDate: '2025-09-03',
    interestPeriodStart: '2025-08-14',
    interestPeriodEnd: '2025-08-24',
    interestDays: 10,
  })

  const interest = calculateDailySimple365Interest(2499.11, 0.18, schedule.interestDays)
  expect(interest).toBe(12.32)
})
