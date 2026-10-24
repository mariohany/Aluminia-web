import type { CutPlan, OptimiserSettings } from '@repo/bar-optimiser/optimise'
import type { ProjectPiece } from '@repo/bar-optimiser/project'

// What the solve pool and its workers say to each other.

/** One part of a profile's solve (docs/report_speed_planing.md §4): one
 * stock length, or the mixed plan starting from the cheapest of those. */
export type SolvePart = { kind: 'single'; length: number } | { kind: 'mixed'; start: CutPlan<number> | null }

export interface SolveWorkerRequest {
  taskId: number
  /** The profile's piece lines, ref = line number. */
  list: ProjectPiece<number>[]
  settings: OptimiserSettings
  part: SolvePart
}

/** Why a worker gave up: `too_big` = out of memory (B11). */
export type SolveFailure = 'too_big' | 'failed'

export type SolveWorkerReply =
  | { type: 'done'; taskId: number; plan: CutPlan<number> | null }
  | { type: 'error'; taskId: number; error: SolveFailure; message: string }
