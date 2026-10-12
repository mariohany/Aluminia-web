import type { QueryRunner } from 'typeorm';
import { rollbackQuietly } from './rollback';

function fakeRunner(active: boolean, rollback: () => Promise<void>) {
  const rollbackTransaction = jest.fn(rollback);
  const runner = {
    isTransactionActive: active,
    rollbackTransaction,
  } as unknown as QueryRunner;
  return { runner, rollbackTransaction };
}

describe('rollbackQuietly', () => {
  it('rolls back an open transaction', async () => {
    const { runner, rollbackTransaction } = fakeRunner(true, () =>
      Promise.resolve(),
    );
    await rollbackQuietly(runner);
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  // A failed COMMIT already ended the transaction; rolling back would
  // throw "transaction is not started" over the real error.
  it('skips a transaction that is already over', async () => {
    const { runner, rollbackTransaction } = fakeRunner(false, () =>
      Promise.resolve(),
    );
    await rollbackQuietly(runner);
    expect(rollbackTransaction).not.toHaveBeenCalled();
  });

  it('never throws, so the caller rethrows its own error', async () => {
    const { runner } = fakeRunner(true, () =>
      Promise.reject(new Error('connection terminated')),
    );
    await expect(rollbackQuietly(runner)).resolves.toBeUndefined();
  });
});
