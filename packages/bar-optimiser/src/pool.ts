// Scheduling for the browser's solve pool (docs/browser_solve_planing.md
// §4.2, B9, B10), kept free of Web Workers so the API's Jest can test it.
// One pool serves every report running in a tab: a task is one profile of
// one report, served first come first served, so the first report's
// profiles all go before the next report's and it finishes first.

/** At most this many workers, whatever the computer: each holds its own
 * HiGHS (7–62 MB measured), and the PC must stay light (B10). */
export const MAX_POOL_WORKERS = 4;

/** An idle worker is closed after this long, giving its memory back. */
export const IDLE_WORKER_MS = 30_000;

/** Half the cores, at least 1, at most `MAX_POOL_WORKERS`; 2 when the
 * browser doesn't say (`navigator.hardwareConcurrency` missing). */
export function poolSize(cores: number | undefined): number {
  if (!cores || !Number.isFinite(cores) || cores < 1) return 2;
  return Math.min(MAX_POOL_WORKERS, Math.max(1, Math.floor(cores / 2)));
}

export interface QueuedTask<T> {
  report: string;
  task: T;
}

/** The tasks waiting for a free worker, oldest first. */
export class TaskQueue<T> {
  private items: QueuedTask<T>[] = [];
  /** Each report's place in line: the order it first added tasks. */
  private rank = new Map<string, number>();
  private nextRank = 0;

  /** A report's tasks, in its own order, after everything already waiting. */
  add(report: string, tasks: T[]): void {
    this.rankOf(report);
    for (const task of tasks) this.items.push({ report, task });
  }

  /** Tasks a report needs next (a profile's mixed solve once its single
   * lengths are in, docs/report_speed_planing.md §4): ahead of the
   * report's other waiting tasks, never ahead of an older report's. */
  addNext(report: string, tasks: T[]): void {
    const rank = this.rankOf(report);
    let at = this.items.findIndex(
      (item) => (this.rank.get(item.report) ?? Infinity) >= rank,
    );
    if (at < 0) at = this.items.length;
    this.items.splice(at, 0, ...tasks.map((task) => ({ report, task })));
  }

  private rankOf(report: string): number {
    let rank = this.rank.get(report);
    if (rank === undefined) {
      rank = this.nextRank++;
      this.rank.set(report, rank);
    }
    return rank;
  }

  /** The next task for a free worker, or `undefined` when none waits. */
  next(): QueuedTask<T> | undefined {
    return this.items.shift();
  }

  /** Stop: removes a report's waiting tasks and returns them. */
  drop(report: string): T[] {
    this.rank.delete(report);
    const dropped = this.items.filter((i) => i.report === report);
    this.items = this.items.filter((i) => i.report !== report);
    return dropped.map((i) => i.task);
  }

  waiting(report?: string): number {
    return report === undefined
      ? this.items.length
      : this.items.filter((i) => i.report === report).length;
  }
}
