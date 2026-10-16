import { ReportJobQueue, jobQueueKey } from './report-job-queue';

/** A task that runs until `finish()` (or `fail()`) is called. */
function gate() {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  let started = false;
  return {
    task: () => {
      started = true;
      return done;
    },
    get started() {
      return started;
    },
    finish,
    fail,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('ReportJobQueue', () => {
  it('runs up to its slots at once; the rest wait first-come', async () => {
    const queue = new ReportJobQueue(2);
    const [a, b, c, d] = [gate(), gate(), gate(), gate()];
    queue.enqueue('a', a.task);
    queue.enqueue('b', b.task);
    queue.enqueue('c', c.task);
    queue.enqueue('d', d.task);

    expect([a.started, b.started, c.started, d.started]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(queue.positionOf('a')).toBeNull();
    expect(queue.positionOf('c')).toBe(0);
    expect(queue.positionOf('d')).toBe(1);

    b.finish();
    await tick();
    expect(c.started).toBe(true);
    expect(d.started).toBe(false);
    expect(queue.positionOf('d')).toBe(0);
  });

  it('a failing task still frees its slot', async () => {
    const queue = new ReportJobQueue(1);
    const [a, b] = [gate(), gate()];
    queue.enqueue('a', a.task);
    queue.enqueue('b', b.task);

    a.fail(new Error('boom'));
    await tick();
    expect(b.started).toBe(true);
    expect(queue.positionOf('b')).toBeNull();
  });

  it('a task that throws before returning a promise still frees its slot', async () => {
    const queue = new ReportJobQueue(1);
    const b = gate();
    queue.enqueue('a', () => {
      throw new Error('boom');
    });
    queue.enqueue('b', b.task);
    await tick();
    expect(b.started).toBe(true);
  });

  it('has a free slot only while nothing is running or waiting beyond it', () => {
    const queue = new ReportJobQueue(1);
    expect(queue.hasFreeSlot()).toBe(true);
    queue.enqueue('a', gate().task);
    expect(queue.hasFreeSlot()).toBe(false);
  });

  it('removes a waiting job: it never runs, and the ones behind move up', async () => {
    const queue = new ReportJobQueue(1);
    const [a, b, c] = [gate(), gate(), gate()];
    const removed = jest.fn();
    queue.enqueue('a', a.task);
    queue.enqueue('b', b.task, removed);
    queue.enqueue('c', c.task);

    expect(queue.remove('b')).toBe(true);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(queue.positionOf('c')).toBe(0);

    a.finish();
    await tick();
    expect(b.started).toBe(false);
    expect(c.started).toBe(true);
  });

  it('cannot remove a job that has started or is unknown', () => {
    const queue = new ReportJobQueue(1);
    queue.enqueue('a', gate().task);
    expect(queue.remove('a')).toBe(false);
    expect(queue.remove('nope')).toBe(false);
  });

  it('refuses fewer than one slot', () => {
    expect(() => new ReportJobQueue(0)).toThrow();
    expect(() => new ReportJobQueue(1.5)).toThrow();
  });

  it('keys a job by its row and its run', () => {
    const at = new Date('2026-10-16T10:00:00.000Z');
    expect(jobQueueKey('row-1', at)).toBe('row-1@2026-10-16T10:00:00.000Z');
  });
});
