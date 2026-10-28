import { z } from 'zod'
import { MAX_PLAN_SEATS, PLAN_KEYS, type PlanKey } from './plans.ts'

// A company's subscription (docs/subscriptions_planing.md §3b, B2, B9,
// B11). Pure and shared: the API enforces with it, the web shows it.

// Q4 (Mario 2026-10-28). Plans are priced in EGP; a quotation in another
// currency converts at that day's rate.
export const BILLING_CURRENCIES = ['EGP', 'SAR', 'AED', 'USD', 'EUR'] as const
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number]

export const DEFAULT_CURRENCY: BillingCurrency = 'EGP'
export const DEFAULT_VAT_RATE = 14
export const TRIAL_DEFAULT_DAYS = 14
export const MAX_TRIAL_DAYS = 90

// The end-of-subscription warnings (B15): the bar and the tag show from
// 30 days out, red for the last 5.
export const ENDING_SOON_DAYS = 30
export const ENDING_RED_DAYS = 5

// Every subscription ends at 23:59:59 Cairo time of its end date (B9).
export const BILLING_TIME_ZONE = 'Africa/Cairo'

const cairoParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BILLING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsOf(instant: Date): WallClock {
  const out: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const part of cairoParts.formatToParts(instant)) {
    if (part.type in out) out[part.type as keyof WallClock] = Number(part.value)
  }
  return out
}

/** A YYYY-MM-DD day as [year, month 1–12, day]. */
function ymd(date: string): [number, number, number] {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return [y, m, d]
}

/** The calendar day (YYYY-MM-DD) an instant falls on in Cairo. */
export function cairoDateOf(instant: Date): string {
  const p = partsOf(instant)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** 23:59:59 Cairo time of a YYYY-MM-DD day, as an instant (Egypt has summer time, so the offset is looked up). */
export function endOfCairoDay(date: string): Date {
  const [y, m, d] = ymd(date)
  const wall = Date.UTC(y, m - 1, d, 23, 59, 59)
  // Cairo's offset at that moment: how far its wall clock is from UTC.
  const p = partsOf(new Date(wall))
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wall
  return new Date(wall - offset)
}

/** A YYYY-MM-DD day moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Whole days from one YYYY-MM-DD day to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = ymd(from)
  const [ty, tm, td] = ymd(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

export type EndingTone = 'yellow' | 'red'

// Computed, never stored: nothing needs a job to flip a company from
// active to expired. `daysLeft` 0 = ends today. A trial past its end is
// `free` (B11): it drops to Free, it is never blocked.
export type SubscriptionState =
  | { kind: 'free' }
  | { kind: 'trial'; endDate: string; daysLeft: number; tone: EndingTone | null }
  | { kind: 'active'; endDate: string; daysLeft: number }
  | { kind: 'ending'; endDate: string; daysLeft: number; tone: EndingTone }
  | { kind: 'expired'; endDate: string }

export interface SubscriptionFacts {
  planKey: PlanKey
  /** ISO instant; null on Free. */
  endsAt: string | Date | null
  isTrial: boolean
}

function toneOf(daysLeft: number): EndingTone | null {
  if (daysLeft > ENDING_SOON_DAYS) return null
  return daysLeft <= ENDING_RED_DAYS ? 'red' : 'yellow'
}

export function subscriptionState(facts: SubscriptionFacts, now: Date): SubscriptionState {
  if (facts.planKey === 'free' || facts.endsAt === null) return { kind: 'free' }
  const endsAt = new Date(facts.endsAt)
  const endDate = cairoDateOf(endsAt)
  if (now.getTime() > endsAt.getTime()) {
    return facts.isTrial ? { kind: 'free' } : { kind: 'expired', endDate }
  }
  const daysLeft = daysBetween(cairoDateOf(now), endDate)
  const tone = toneOf(daysLeft)
  if (facts.isTrial) return { kind: 'trial', endDate, daysLeft, tone }
  return tone ? { kind: 'ending', endDate, daysLeft, tone } : { kind: 'active', endDate, daysLeft }
}

// Why a history row was written (§3c). `paid` arrives with step 6.
export const BILLING_REASONS = ['created', 'edited', 'trial_started', 'paid', 'trial_ended', 'dropped_to_free'] as const
export type BillingReason = (typeof BILLING_REASONS)[number]

// The Edit subscription dialog (B2, `bill-cd-edit-sub`). On Free the end
// date, trial and seats are ignored (Free is fixed: one seat, never
// ends); `keepAdminId` picks the one admin who stays active there (B13,
// null = the oldest). A trial is a paid plan with `isTrial` and an end
// date the dialog fills from its days.
export const updateSubscriptionSchema = z
  .object({
    planKey: z.enum(PLAN_KEYS),
    maxUsers: z.number().int().min(1).max(MAX_PLAN_SEATS),
    endDate: z.iso.date().nullable(),
    isTrial: z.boolean(),
    currency: z.enum(BILLING_CURRENCIES),
    vatRate: z.number().min(0).max(100),
    note: z.string().trim().max(300).nullable(),
    keepAdminId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.planKey === 'free') {
      if (value.isTrial) ctx.addIssue({ code: 'custom', path: ['isTrial'], message: 'Trials are only on paid plans.' })
      return
    }
    if (value.endDate === null) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'A paid plan needs an end date.' })
    }
  })
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>
