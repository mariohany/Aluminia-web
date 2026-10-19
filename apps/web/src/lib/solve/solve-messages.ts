import type { OptimiserSettings } from '@repo/bar-optimiser/optimise'
import type { ProjectPiece } from '@repo/bar-optimiser/project'
import type { SolvedProfile } from '@repo/bar-optimiser/solve-result'

// What the solve pool and its workers say to each other.

export interface SolveWorkerRequest {
  taskId: number
  profile: string
  /** The profile's piece lines, ref = line number. */
  list: ProjectPiece<number>[]
  settings: OptimiserSettings
}

/** Why a worker gave up: `too_big` = out of memory (B11). */
export type SolveFailure = 'too_big' | 'failed'

export type SolveWorkerReply =
  | { type: 'done'; taskId: number; result: SolvedProfile }
  | { type: 'error'; taskId: number; error: SolveFailure; message: string }
