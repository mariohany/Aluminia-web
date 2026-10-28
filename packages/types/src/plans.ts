import { z } from 'zod'

// The four plans are fixed rows (docs/subscriptions_planing.md §3a, B1):
// the super admin edits them on the Plans page but never adds or deletes
// one. The code only ever refers to `free` by key.
export const PLAN_KEYS = ['free', 'individual', 'pro', 'ultimate'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export const PAID_PLAN_KEYS = ['individual', 'pro', 'ultimate'] as const
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number]

// What a plan can switch on. Window editing is never a feature: every
// plan, Free included, has it. `quotes` and `work_orders` are reserved
// for features not built yet, so they aren't offered as switches.
export const PLAN_FEATURES = ['reports', 'data', 'project_settings'] as const
export type PlanFeature = (typeof PLAN_FEATURES)[number]

// Free is fixed in code, not edited on the Plans page (Mario 2026-10-28):
// one seat, one client, one project, no features, no price. Only Free
// has client / project limits; paid plans are unlimited.
export const FREE_PLAN_LIMITS = { seats: 1, maxClients: 1, maxProjects: 1 } as const

// Seats a paid plan may offer: the 15 of Ultimate plus headroom.
export const MAX_PLAN_SEATS = 50

// Prices are EGP only (B6); other currencies convert when a quotation
// is made. Free has none.
export interface PlanSummary {
  id: string
  key: PlanKey
  nameEn: string
  nameAr: string
  seats: number
  monthlyEgp: number | null
  annualEgp: number | null
  features: PlanFeature[]
  updatedAt: string
}

const price = z.number().positive().max(9_999_999_999.99)

// One paid plan as the Plans page saves it. `key` picks the row; it is
// never changed. Plain numbers, no coercion (see createCompanySchema).
export const paidPlanInputSchema = z
  .object({
    key: z.enum(PAID_PLAN_KEYS),
    nameEn: z.string().trim().min(1).max(60),
    nameAr: z.string().trim().min(1).max(60),
    seats: z.number().int().min(1).max(MAX_PLAN_SEATS),
    monthlyEgp: price,
    annualEgp: price,
    features: z.array(z.enum(PLAN_FEATURES)),
  })
  .strict()
export type PaidPlanInput = z.infer<typeof paidPlanInputSchema>

// The page has one Save for every column, so all three paid plans go
// in one request, each exactly once.
export const updatePlansSchema = z
  .object({
    plans: z
      .array(paidPlanInputSchema)
      .length(PAID_PLAN_KEYS.length)
      .refine((plans) => new Set(plans.map((p) => p.key)).size === plans.length, {
        message: 'Each plan once.',
      }),
  })
  .strict()
export type UpdatePlansInput = z.infer<typeof updatePlansSchema>

/** What a year costs against paying monthly, in whole percent (negative = dearer). */
export function annualSavingPercent(monthlyEgp: number, annualEgp: number): number {
  if (!(monthlyEgp > 0)) return 0
  return Math.round((1 - annualEgp / (12 * monthlyEgp)) * 100)
}
