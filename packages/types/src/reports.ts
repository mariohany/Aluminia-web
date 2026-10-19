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

// ---- The report snapshot the browser draws (docs/browser_pdf_planing.md) --

/** One piece on a drawn bar: its length and what it is (D17, D26). */
export interface BarOptimiserReportPiece {
  lengthMm: number
  windowName: string
  member: ReportMember
  at: ReportPieceAt
}

/** One bar to scale: pieces in cutting order, the offcut, the waste. */
export interface BarOptimiserReportBar {
  stockMm: number
  wasteMm: number
  offcutMm: number
  pieces: BarOptimiserReportPiece[]
}

/** One profile's least-waste plan, as the cutting-plan pages draw it. */
export interface BarOptimiserReportPlan {
  profile: string
  profileNo: string | null
  member: ReportMember
  best: { mix: StockMix; wastePct: number; piecesMm: number; bars: BarOptimiserReportBar[] } | null
}

/** Everything frozen at Generate (P6): the numbers, the plans with their
 * piece labels, and the project and client names in both languages. */
export interface BarOptimiserReport {
  generatedAt: string
  project: { enName: string; arName: string | null }
  client: { enName: string; arName: string | null } | null
  summary: BarOptimiserSummary
  plans: BarOptimiserReportPlan[]
  /** Panels per window, for "panel 2 ·" in multi-panel labels. */
  panelCounts: Record<string, number>
}

/** The company as printed today, always the latest (P7). `enName` is the
 * company profile's, else the account name. */
export interface ReportCompany {
  enName: string
  arName: string | null
  logoFileId: string | null
}

/** GET …/bar-optimiser/report. */
export interface BarOptimiserReportResponse {
  report: BarOptimiserReport
  company: ReportCompany
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

/** The print job making this language's PDF (docs/browser_solve_planing.md
 * B7). Printing waits for a free Chrome slot (report queue C1). */
export interface ReportJobStatus {
  /** `queued`: waiting for a free slot (docs/report_queue_planing.md C1). */
  state: 'queued' | 'running' | 'failed'
  startedAt: string
  /** Always empty for a print; kept for the progress card's shape. */
  groups: ReportProgressGroup[]
  /** While queued: how many jobs are ahead of this one (0 = next). `null`
   * when not queued, or when another API instance holds the job (C4, C6). */
  queuePosition: number | null
  /** `interrupted` (its server died) or the failure's message. */
  error: string | null
}

/** Why a solve ended without a result (docs/browser_solve_planing.md). */
export const SolveError = {
  /** Its browser stopped sending progress (tab closed, B5). */
  STOPPED: 'stopped',
  /** The device ran out of memory (B11). */
  TOO_BIG: 'too_big',
  /** Windows changed while it ran: the result was refused (Q1). */
  WINDOWS_CHANGED: 'windows_changed',
  /** The solver failed in the browser. */
  FAILED: 'failed',
} as const
export type SolveError = (typeof SolveError)[keyof typeof SolveError]

/** The project's solve being made in someone's browser (B5). */
export interface ReportSolveStatus {
  state: 'solving' | 'failed'
  startedAt: string
  /** Who is solving, for "being made by … on their computer". */
  startedByEmail: string | null
  /** Started by the user asking (possibly in another tab). */
  startedByMe: boolean
  groups: ReportProgressGroup[]
  error: SolveError | null
}

export interface ReportStatus {
  /** This language's PDF. `none`: never printed; `stale`: inputs changed
   * since (D14/D15). */
  state: 'none' | 'fresh' | 'stale'
  generatedAt: string | null
  /** Windows added, removed or edited since the project's last solve. */
  changedWindows: number
  hasPdf: boolean
  /** The project has a solve for today's inputs: this language can be
   * printed without solving (B4, B8). */
  hasSolve: boolean
  summary: BarOptimiserSummary | null
  /** The print job. */
  job: ReportJobStatus | null
  solve: ReportSolveStatus | null
}

// ---- Browser solve requests (docs/browser_solve_planing.md §7) -----------

/** Machine-readable `code` on a refused solve request's error body. */
export const SolveRefusal = {
  /** The browser's optimiser is older or newer than the API's (B12). */
  OUTDATED_CLIENT: 'outdated_client',
  /** Someone else's browser is solving this project. */
  SOLVING_ELSEWHERE: 'solving_elsewhere',
  /** The token no longer holds the solve (stopped, taken over). */
  SOLVE_LOST: 'solve_lost',
  /** Windows changed while solving (Q1). */
  WINDOWS_CHANGED: 'windows_changed',
  /** No current solve to print from. */
  NO_SOLVE: 'no_solve',
} as const
export type SolveRefusal = (typeof SolveRefusal)[keyof typeof SolveRefusal]

export const startSolveSchema = z.object({ optimiserVersion: z.number().int() }).strict()
export type StartSolveInput = z.infer<typeof startSolveSchema>

/** One piece line: `count` pieces of one length of one profile. A line's
 * number is its position in `lines`. */
export interface SolveLine {
  profile: string
  member: ReportMember
  lengthMm: number
  count: number
}

export interface SolveStart {
  token: string
  settings: { lengths: number[]; kerfMm: number; endTrimMm: number }
  lines: SolveLine[]
  /** Profile ref → its number, for the progress card. */
  profileNos: Record<string, string | null>
  status: ReportStatus
}

const progressGroupSchema = z
  .object({
    member: z.enum([ReportMember.FRAME, ReportMember.SASH, ReportMember.DIVIDER, ReportMember.BEAD]),
    state: z.enum(['waiting', 'running', 'done']),
    profilesDone: z.number().int().min(0),
    profilesTotal: z.number().int().min(0),
    currentProfile: z.string().max(100).nullable(),
  })
  .strict()

export const solveProgressSchema = z
  .object({ token: z.uuid(), groups: z.array(progressGroupSchema).max(4) })
  .strict()
export type SolveProgressInput = z.infer<typeof solveProgressSchema>

const solvedPlanSchema = z
  .array(
    z
      .object({
        stockMm: z.number().int().positive(),
        pieces: z.array(z.number().int().min(0)).min(1),
      })
      .strict(),
  )
  .nullable()

/** Bars as piece-line numbers (`@repo/bar-optimiser/solve-result`); the
 * API checks them against its own lines. */
export const solveResultSchema = z
  .object({
    token: z.uuid(),
    optimiserVersion: z.number().int(),
    profiles: z.array(
      z
        .object({
          profile: z.string().min(1).max(200),
          best: solvedPlanSchema,
          single: z.record(z.string().regex(/^\d+$/), solvedPlanSchema),
        })
        .strict(),
    ),
  })
  .strict()
export type SolveResultInput = z.infer<typeof solveResultSchema>

export const stopSolveSchema = z
  .object({
    token: z.uuid(),
    /** Set when the browser gave up (out of memory, solver error); absent
     * when the user pressed Stop. */
    error: z.enum([SolveError.TOO_BIG, SolveError.FAILED]).optional(),
  })
  .strict()
export type StopSolveInput = z.infer<typeof stopSolveSchema>
