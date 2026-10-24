import { IDLE_WORKER_MS, TaskQueue, poolSize } from '@repo/bar-optimiser/pool'
import type { CutPlan, OptimiserSettings } from '@repo/bar-optimiser/optimise'
import type { ProjectPiece } from '@repo/bar-optimiser/project'
import type { SolveFailure, SolvePart, SolveWorkerReply, SolveWorkerRequest } from './solve-messages'

// The tab's one solve pool (docs/browser_solve_planing.md §4.2, B9, B10):
// every running report's profile parts (docs/report_speed_planing.md §4)
// share half the cores (1–4), first come first served, so the PC stays
// usable and the first report finishes first. Scheduling rules live in @repo/bar-optimiser/pool (tested there).

export interface PoolTask {
  list: ProjectPiece<number>[]
  settings: OptimiserSettings
  part: SolvePart
  onStart: () => void
  onDone: (plan: CutPlan<number> | null) => void
  onError: (error: SolveFailure, message: string) => void
}

interface Slot {
  worker: Worker
  task: { id: number; report: string; task: PoolTask } | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

class SolvePool {
  private readonly size = poolSize(typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency)
  private readonly queue = new TaskQueue<PoolTask>()
  private slots: Slot[] = []
  private nextTaskId = 1

  /** Queues a report's profiles behind everything already waiting. */
  submit(report: string, tasks: PoolTask[]): void {
    this.queue.add(report, tasks)
    this.pump()
  }

  /** Tasks a report needs before its others: a profile's mixed plan. */
  submitNext(report: string, tasks: PoolTask[]): void {
    this.queue.addNext(report, tasks)
    this.pump()
  }

  /** Stop (B6) or a failure: drops the report's waiting profiles and
   * ends the workers busy on it (HiGHS can't be interrupted mid-solve). */
  stop(report: string): void {
    this.queue.drop(report)
    for (const slot of [...this.slots]) {
      if (slot.task?.report === report) this.close(slot)
    }
    this.pump()
  }

  private pump(): void {
    while (this.queue.waiting() > 0) {
      const slot = this.slots.find((s) => !s.task) ?? (this.slots.length < this.size ? this.open() : null)
      if (!slot) return
      const next = this.queue.next()
      if (!next) return
      this.assign(slot, next.report, next.task)
    }
  }

  private open(): Slot {
    const worker = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' })
    const slot: Slot = { worker, task: null, idleTimer: null }
    worker.onmessage = (event: MessageEvent<SolveWorkerReply>) => this.reply(slot, event.data)
    // An uncaught failure (the module didn't load, the worker died).
    worker.onerror = (event) => {
      event.preventDefault()
      const running = slot.task
      this.close(slot)
      running?.task.onError(/memory/i.test(event.message ?? '') ? 'too_big' : 'failed', event.message ?? '')
      this.pump()
    }
    this.slots.push(slot)
    return slot
  }

  private assign(slot: Slot, report: string, task: PoolTask): void {
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.idleTimer = null
    const id = this.nextTaskId++
    slot.task = { id, report, task }
    task.onStart()
    const request: SolveWorkerRequest = { taskId: id, list: task.list, settings: task.settings, part: task.part }
    slot.worker.postMessage(request)
  }

  private reply(slot: Slot, message: SolveWorkerReply): void {
    const running = slot.task
    if (!running || running.id !== message.taskId) return
    if (message.type === 'done') {
      slot.task = null
      slot.idleTimer = setTimeout(() => this.close(slot), IDLE_WORKER_MS)
      running.task.onDone(message.plan)
    } else {
      // A HiGHS that aborted can't be trusted with another solve.
      this.close(slot)
      running.task.onError(message.error, message.message)
    }
    this.pump()
  }

  private close(slot: Slot): void {
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.worker.terminate()
    slot.task = null
    this.slots = this.slots.filter((s) => s !== slot)
  }
}

export const solvePool = new SolvePool()
