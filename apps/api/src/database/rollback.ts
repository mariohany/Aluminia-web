import { Logger } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

const logger = new Logger('Transaction');

/**
 * Rolls back from a catch block without hiding why the transaction
 * failed (stability S22). Call it in place of a bare
 * `queryRunner.rollbackTransaction()`, then rethrow or translate the
 * original error as before.
 *
 * Skips the rollback when the transaction is already over — a failed
 * COMMIT ends it, and rolling back a finished transaction throws. A
 * rollback that fails anyway (the connection dropped) is logged, not
 * thrown: Postgres discards an unfinished transaction when its
 * connection closes, and the caller's error is the one worth seeing.
 */
export async function rollbackQuietly(queryRunner: QueryRunner): Promise<void> {
  if (!queryRunner.isTransactionActive) return;
  try {
    await queryRunner.rollbackTransaction();
  } catch (rollbackError: unknown) {
    logger.warn({ err: rollbackError }, 'rollback failed');
  }
}
