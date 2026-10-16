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

// ---- Bar optimiser: status + summary (docs/reports_planing.md §7) ----------

/** The four member groups, in report order (frames first). */
export const ReportMember = {
  FRAME: 'frame',
  SASH: 'sash',
  DIVIDER: 'divider',
  BEAD: 'bead',
} as const
export type ReportMember = (typeof ReportMember)[keyof typeof ReportMember]

/** Where a piece sits on its window — @repo/geometry's `PieceAt`, kept
 * here structurally so the API response doesn't depend on the geometry
 * package. The PDF/screen turn it into words (D17). */
export interface ReportPieceAt {
  panelIndex: number
  sectionIndex: number | null
  sashIndex: number | null
  position: 'top' | 'bottom' | 'left' | 'right' | 'head' | 'edge' | 'bar'
  positionIndex?: number
  divider?: { kind: 'mullion' | 'transom'; number: number }
}

export interface ReportPlanTotals {
  barCount: number
  boughtMm: number
  wasteMm: number
  wastePct: number
}

/** Bars per stock length; JSON keys are the length in mm. */
export type StockMix = Record<string, number>

export interface BarOptimiserSummary {
  stockLengthsMm: number[]
  kerfMm: number
  endTrimMm: number
  /** Window types in the project, and Σ quantity. */
  windowCount: number
  unitCount: number
  total: ReportPlanTotals & { mix: StockMix; pieceCount: number }
  members: {
    member: ReportMember
    pieceCount: number
    /** Profile refs, in report order. */
    profiles: string[]
    /** Each stock length alone; `null` when a piece doesn't fit it. */
    single: Record<string, ReportPlanTotals | null>
    best: ReportPlanTotals & { mix: StockMix }
  }[]
  profiles: {
    profile: string
    profileNo: string | null
    member: ReportMember
    pieceCount: number
    single: Record<string, ReportPlanTotals | null>
    best: (ReportPlanTotals & { mix: StockMix }) | null
    /** Pieces longer than the longest usable bar: not cut. */
    tooLong: { lengthMm: number; count: number; windowName: string; at: ReportPieceAt }[]
  }[]
  /** Parts with no profile to cut them from (D16). */
  skipped: { windowId: string; windowName: string; member: ReportMember; at: ReportPieceAt }[]
  /** Sash/divider/bead lengths come from stand-in widths (D1). */
  approximate: boolean
}

/** One member group's line on the progress card (D22). */
export interface ReportProgressGroup {
  member: ReportMember
  state: 'waiting' | 'running' | 'done'
  profilesDone: number
  profilesTotal: number
  /** Profile number being optimised, while running. */
  currentProfile: string | null
}

export interface ReportJobStatus {
  /** `queued`: waiting for a free slot (docs/report_queue_planing.md C1). */
  state: 'queued' | 'running' | 'failed'
  startedAt: string
  groups: ReportProgressGroup[]
  /** While queued: how many jobs are ahead of this one (0 = next). `null`
   * when not queued, or when another API instance holds the job (C4, C6). */
  queuePosition: number | null
  /** `interrupted` (its server died), `timeout` (the solve ran past the
   * safety cap, C5), or the failure's message. */
  error: string | null
}

export interface ReportStatus {
  /** `none`: never generated; `stale`: inputs changed since (D14/D15). */
  state: 'none' | 'fresh' | 'stale'
  generatedAt: string | null
  /** Windows added, removed or edited since the cached report. */
  changedWindows: number
  hasPdf: boolean
  summary: BarOptimiserSummary | null
  job: ReportJobStatus | null
}
