/// <reference lib="webworker" />
import highsWasmUrl from 'highs/runtime?url'
import { configureSolver, optimiseProfile, type OptimiserSettings } from '@repo/bar-optimiser/optimise'
import type { ProjectPiece } from '@repo/bar-optimiser/project'
import { solvedProfileOf } from '@repo/bar-optimiser/solve-result'
import type { SolveWorkerReply, SolveWorkerRequest } from './solve-messages'

// One worker of the browser's solve pool (docs/browser_solve_planing.md
// §4.2): solves one profile at a time with its own HiGHS, loaded on the
// first task and kept for the next. The pool closes it when idle.

configureSolver({ locateFile: () => highsWasmUrl })

self.onmessage = async (event: MessageEvent<SolveWorkerRequest>) => {
  const { taskId, profile, list, settings } = event.data
  try {
    const result = await optimiseProfile(list as ProjectPiece<number>[], settings as OptimiserSettings)
    reply({ type: 'done', taskId, result: solvedProfileOf(profile, result) })
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
