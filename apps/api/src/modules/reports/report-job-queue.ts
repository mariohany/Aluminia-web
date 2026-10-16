// How many report jobs run at once on this API instance, and the line the
// rest wait in (docs/report_queue_planing.md C1, C3, C6). Plain first-come,
// in memory: a restart drops the line, and the heartbeat then reports those
// jobs `interrupted`, as for a running one.

type Task = () => Promise<unknown>;

export class ReportJobQueue {
  private running = 0;
  private readonly waiting: {
    key: string;
    task: Task;
    onRemoved?: () => void;
  }[] = [];

  constructor(readonly slots: number) {
    if (!Number.isInteger(slots) || slots < 1) {
      throw new Error(`Report job slots must be a whole number ≥ 1: ${slots}`);
    }
  }

  /** Whether a job enqueued now would start at once. */
  hasFreeSlot(): boolean {
    return this.running < this.slots && this.waiting.length === 0;
  }

  /** Runs `task` when a slot is free; a failing task still frees it.
   * `onRemoved` is called instead if the job is taken out of the line. */
  enqueue(key: string, task: Task, onRemoved?: () => void): void {
    this.waiting.push({ key, task, onRemoved });
    this.drain();
  }

  /** Takes a waiting job out of the line (cancel while queued, C8). False
   * when it isn't waiting here: already started, finished, or elsewhere. */
  remove(key: string): boolean {
    const index = this.waiting.findIndex((w) => w.key === key);
    if (index === -1) return false;
    const [removed] = this.waiting.splice(index, 1);
    removed.onRemoved?.();
    return true;
  }

  /** Jobs ahead of `key` in the line (0 = next), or null if it isn't
   * waiting here: running, finished, or held by another instance. */
  positionOf(key: string): number | null {
    const index = this.waiting.findIndex((w) => w.key === key);
    return index === -1 ? null : index;
  }

  private drain(): void {
    while (this.running < this.slots && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.running++;
      let run: Promise<unknown>;
      try {
        run = next.task();
      } catch (error) {
        // A task that throws at once still frees its slot.
        run = Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      void run
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}

/** One job's place in the line: its row and the run it belongs to. */
export function jobQueueKey(cacheId: string, startedAt: Date): string {
  return `${cacheId}@${startedAt.toISOString()}`;
}
