/// <reference lib="webworker" />
import highsWasmUrl from 'highs/runtime?url'
import { configureSolver, solveMixed, solveSingleLength, type OptimiserSettings } from '@repo/bar-optimiser/optimise'
import type { ProjectPiece } from '@repo/bar-optimiser/project'
import type { SolveWorkerReply, SolveWorkerRequest } from './solve-messages'

// One worker of the browser's solve pool (docs/browser_solve_planing.md
// §4.2): solves one part of a profile at a time — one stock length, or
// the mixed plan (docs/report_speed_planing.md §4) — with its own HiGHS,
// loaded on the first task and kept for the next. The pool closes it
// when idle.

configureSolver({ locateFile: () => highsWasmUrl })

self.onmessage = async (event: MessageEvent<SolveWorkerRequest>) => {
  const { taskId, list, settings, part } = event.data
  const pieces = list as ProjectPiece<number>[]
  try {
    const plan =
      part.kind === 'single'
        ? await solveSingleLength(pieces, settings as OptimiserSettings, part.length)
        : await solveMixed(pieces, settings as OptimiserSettings, part.start)
    reply({ type: 'done', taskId, plan })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reply({ type: 'error', taskId, error: isOutOfMemory(error, message) ? 'too_big' : 'failed', message })
  }
}

function reply(message: SolveWorkerReply) {
  self.postMessage(message)
}

/** HiGHS (Emscripten) aborts with "OOM"; the browser refuses a bigger
 * WebAssembly memory with a RangeError about memory (B11). Any other
 * RangeError ("Maximum call stack size exceeded", "Set maximum size
 * exceeded") is an optimiser bug, reported as `failed` (bug-128). */
function isOutOfMemory(error: unknown, message: string): boolean {
  return /\bOOM\b|out of memory|allocat/i.test(message) || (error instanceof RangeError && /memory/i.test(message))
}
