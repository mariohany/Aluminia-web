import type { PlanRef } from './plans.ts'
import type { BillingCurrency } from './subscriptions.ts'

// Billing › To-do (docs/payment_cycle_planing.md §8, Mario 2026-11-05: its
// own page, first in the Billing group, with a count badge). What the
// super admin should act on now; each row opens the company's Billing tab.

/** A plan or trial ending soon without what would continue it. */
export const TODO_ENDING_DAYS = 30
export const TODO_TRIAL_DAYS = 7
/** A sent quotation expiring this soon is flagged. */
export const TODO_EXPIRING_DAYS = 3
/** Payments whose amount differed stay listed this long. */
export const TODO_DIFFERENCE_DAYS = 30

export interface TodoCompany {
  companyId: string
  companyName: string
}

export interface BillingTodo {
  /** Sent, not paid, not expired: oldest first. */
  waiting: Array<
    TodoCompany & {
      documentId: string
      number: string
      currency: BillingCurrency
      total: number
      /** When it was last emailed, else created. */
      sentAt: string
      /** Days until it expires (0 = its last day). */
      expiresIn: number
    }
  >
  /** A paid plan ending in ≤ 30 days with no renewal or upgrade quotation sent. */
  endingNoQuotation: Array<TodoCompany & { plan: PlanRef; endsAt: string; daysLeft: number }>
  /** Trials ending in ≤ 7 days. */
  trialsEnding: Array<TodoCompany & { plan: PlanRef; endsAt: string; daysLeft: number }>
  /** Invoices of the last 30 days whose money differed from the total (P12). */
  differences: Array<
    TodoCompany & {
      documentId: string
      number: string
      currency: BillingCurrency
      total: number
      amountReceived: number
      note: string | null
      paidOn: string
    }
  >
}

/** The sidebar badge: everything listed. */
export function todoCount(todo: BillingTodo): number {
  return todo.waiting.length + todo.endingNoQuotation.length + todo.trialsEnding.length + todo.differences.length
}
