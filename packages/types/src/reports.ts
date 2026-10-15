import { z } from 'zod'

// Reports section + Bar optimiser (docs/reports_planing.md).

export const ReportKind = {
  BAR_OPTIMISER: 'bar_optimiser',
} as const
export type ReportKind = (typeof ReportKind)[keyof typeof ReportKind]

/** The PDF's language, picked at download; cached per language (D13). */
export const ReportLanguage = {
  EN: 'en',
  AR: 'ar',
} as const
export type ReportLanguage = (typeof ReportLanguage)[keyof typeof ReportLanguage]
export const reportLanguageSchema = z.enum([ReportLanguage.EN, ReportLanguage.AR])

/** Always tried, never stored, never removable (D7). */
export const DEFAULT_STOCK_LENGTHS_MM = [6000, 6500] as const

/** What the settings popover accepts (Q2, Mario 2026-10-15). The tenant
 * migration's CHECKs mirror these. */
export const CUTTING_LIMITS = {
  kerfMm: { min: 0, max: 10, step: 0.5 },
  endTrimMm: { min: 0, max: 100 },
  stockLengthMm: { min: 1000, max: 12000 },
  maxExtraLengths: 10,
} as const

export const DEFAULT_CUTTING_SETTINGS = {
  kerfMm: 4,
  endTrimMm: 10,
  extraLengthsMm: [] as number[],
}

/** One set per company (D8); edited from the report's popover (D9). */
export const cuttingSettingsSchema = z
  .object({
    kerfMm: z.number().min(CUTTING_LIMITS.kerfMm.min).max(CUTTING_LIMITS.kerfMm.max).multipleOf(CUTTING_LIMITS.kerfMm.step),
    endTrimMm: z.number().int().min(CUTTING_LIMITS.endTrimMm.min).max(CUTTING_LIMITS.endTrimMm.max),
    extraLengthsMm: z
      .array(z.number().int().min(CUTTING_LIMITS.stockLengthMm.min).max(CUTTING_LIMITS.stockLengthMm.max))
      .max(CUTTING_LIMITS.maxExtraLengths),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<number>(DEFAULT_STOCK_LENGTHS_MM)
    value.extraLengthsMm.forEach((length, index) => {
      if (seen.has(length)) {
        ctx.addIssue({ code: 'custom', path: ['extraLengthsMm', index], message: 'This stock length is already tried.' })
      }
      seen.add(length)
    })
  })
export type CuttingSettingsInput = z.infer<typeof cuttingSettingsSchema>

export interface CuttingSettings extends CuttingSettingsInput {
  /** Defaults + extras, longest first — what the optimiser tries. */
  stockLengthsMm: number[]
  updatedAt: string | null
}

/** Every length the optimiser tries for these settings, longest first. */
export function stockLengthsOf(settings: Pick<CuttingSettingsInput, 'extraLengthsMm'>): number[] {
  return [...new Set([...DEFAULT_STOCK_LENGTHS_MM, ...settings.extraLengthsMm])].sort((a, b) => b - a)
}
