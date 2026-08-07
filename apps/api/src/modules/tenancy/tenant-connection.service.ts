import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { assertValidSchemaName } from '../../database/tenant/schema-name';
import { TENANT_DATA_SOURCE } from '../../database/tenant/tenant-pool.data-source';

/**
 * Runs work inside one tenant's Postgres schema.
 *
 * This is the ONLY place in the codebase that switches schemas. Deliberately
 * a plain singleton that knows nothing about HTTP requests or logged-in
 * users: background jobs (BullMQ reports/email, per CLAUDE.md) and CLI
 * scripts have no request to read a tenant from, so they call this
 * directly with a schema name they resolved themselves. Web requests go
 * through `TenantContextService`, which works out *which* schema and then
 * delegates here.
 *
 * One mechanism, two ways in — rather than a request-scoped-only design
 * that forces a second, parallel implementation of tenant isolation the
 * first time a report job needs one.
 */
@Injectable()
export class TenantConnectionService {
  constructor(
    @InjectDataSource(TENANT_DATA_SOURCE)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Opens a transaction, points it at `schemaName`, and hands the caller
   * an `EntityManager` whose unqualified table names resolve inside that
   * schema. Commits on success, rolls back on any throw, and always
   * returns the connection to the pool.
   *
   * Do all of a request's tenant work inside ONE call: two nested calls
   * would open two independent transactions that can't see each other's
   * uncommitted writes.
   */
  async runInSchema<T>(
    schemaName: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    // Schema names are SQL *identifiers*, so they cannot be bind
    // parameters — they have to be interpolated into the statement
    // below. That makes this check the actual injection defence, not a
    // formatting nicety. Re-asserted here even though callers pass
    // values read from our own `companies` table: a hand-edited or
    // corrupted `schema_name` should fail loudly, not execute.
    assertValidSchemaName(schemaName);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // The whole safety argument, in one keyword.
      //
      // Connections get reused: tenant A's request borrows one, hands it
      // back to the pool, and tenant B picks up that same connection a
      // moment later. If the schema setting stuck to the connection, B
      // would read A's data — the classic multi-tenant leak.
      //
      // LOCAL scopes the setting to this transaction, so Postgres itself
      // discards it on COMMIT *and* on ROLLBACK. We are not relying on
      // our own cleanup code running; we are relying on transaction
      // semantics, which hold even if this process crashes mid-request.
      //
      // Note what is NOT on the path: `public`. With it there, a query
      // for a tenant table that doesn't exist yet would silently fall
      // through to a same-named control-plane table — real data from the
      // wrong place, with no error to notice. Excluding it turns that
      // into a loud "relation does not exist".
      await queryRunner.query(`SET LOCAL search_path TO "${schemaName}"`);

      const result = await work(queryRunner.manager);

      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      // Guarded because the transaction may already be dead — a failed
      // COMMIT ends it, and rolling back a finished transaction throws
      // an error that would mask the real one.
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
