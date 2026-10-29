import type { SubscriptionState } from './subscriptions.ts'

// GET /company/alerts (docs/subscriptions_planing.md Q2, Mario 2026-10-29):
// called each time a user opens the app; what to show this user now.

export interface CompanyAlerts {
  /** The expiry bar (B15): a paid plan in its last 30 days. Every user
   * sees it; `canRenew` (company admins) gets "Go to subscription". */
  ending: (Extract<SubscriptionState, { kind: 'ending' }> & { canRenew: boolean }) | null
}

/** The warning emails before the end (B15), most days first. */
export const WARNING_STEPS = [30, 15, 5, 1] as const
export type WarningStep = (typeof WARNING_STEPS)[number]

/** The warning due with `daysLeft` to go: the smallest step it has reached
 * (4 days left → the 5-day warning), or none above 30 days. */
export function dueWarningStep(daysLeft: number): WarningStep | null {
  const reached = WARNING_STEPS.filter((step) => daysLeft <= step)
  return reached.at(-1) ?? null
}
