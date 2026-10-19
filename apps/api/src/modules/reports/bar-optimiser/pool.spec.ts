import {
  MAX_POOL_WORKERS,
  TaskQueue,
  poolSize,
} from '@repo/bar-optimiser/pool';

// The browser's solve pool scheduling (docs/browser_solve_planing.md §4.2).

describe('poolSize', () => {
  it('uses half the cores, at least 1, at most 4', () => {
    expect(poolSize(1)).toBe(1);
    expect(poolSize(2)).toBe(1);
    expect(poolSize(4)).toBe(2);
    expect(poolSize(6)).toBe(3);
    expect(poolSize(8)).toBe(4);
    expect(poolSize(16)).toBe(MAX_POOL_WORKERS);
  });

  it('assumes 2 workers when the browser does not say', () => {
    expect(poolSize(undefined)).toBe(2);
    expect(poolSize(0)).toBe(2);
    expect(poolSize(Number.NaN)).toBe(2);
  });
});

describe('TaskQueue', () => {
  it('serves the first report before the next, each in its own order', () => {
    const queue = new TaskQueue<string>();
    queue.add('villa', ['frame', 'sash']);
    queue.add('tower', ['bead']);
    queue.add('villa', ['divider']); // a later add waits behind tower
    expect(
      [1, 2, 3, 4, 5].map(() => {
        const next = queue.next();
        return next && `${next.report}:${next.task}`;
      }),
    ).toEqual([
      'villa:frame',
      'villa:sash',
      'tower:bead',
      'villa:divider',
      undefined,
    ]);
  });

  it("drops only a stopped report's waiting tasks", () => {
    const queue = new TaskQueue<string>();
    queue.add('villa', ['frame', 'sash']);
    queue.add('tower', ['bead']);
    expect(queue.drop('villa')).toEqual(['frame', 'sash']);
    expect(queue.waiting('villa')).toBe(0);
    expect(queue.waiting()).toBe(1);
    expect(queue.next()).toEqual({ report: 'tower', task: 'bead' });
  });
});
