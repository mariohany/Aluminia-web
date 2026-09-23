import type { MigrationInterface } from 'typeorm';
import { DataSource } from 'typeorm';
import { assertValidSchemaName } from './tenant/schema-name';
import { tenantMigrations } from './tenant/migrations';
import { TENANT_MIGRATIONS_TABLE } from './tenant/tenant-data-source';

/**
 * The boot gate: new code must not serve traffic against a database it
 * has out-run.
 *
 * Without this, shipping a migration and forgetting to apply it turns
 * into a 500 on every request that touches the new column — the failure
 * surfaces far from its cause, per-request, in production. Same
 * philosophy as `config/env.schema.ts`: fail loudly at boot, not lazily
 * at first use.
 *
 * Both tracks are checked, because "control plane migrated, tenants
 * forgotten" is the easier half to miss — they are separate migration
 * sets with separate runners (see tenant/tenant-data-source.ts).
 *
 * Called from `main.ts` only. An e2e app is built straight from
 * AppModule and never runs bootstrap(), so the suite is unaffected.
 */
export interface PendingMigrations {
  controlPlane: string[];
  tenantSchemas: Array<{ schemaName: string; pending: string[] }>;
}

export function hasPending(pending: PendingMigrations): boolean {
  return (
    pending.controlPlane.length > 0 || pending.tenantSchemas.length > 0
  );
}

export function describePending(pending: PendingMigrations): string {
  const lines: string[] = [];
  if (pending.controlPlane.length > 0) {
    lines.push(
      `control plane: ${pending.controlPlane.join(', ')}`,
    );
  }
  for (const tenant of pending.tenantSchemas) {
    lines.push(`${tenant.schemaName}: ${tenant.pending.join(', ')}`);
  }
  return lines.join('\n  ');
}

/**
 * TypeORM records a migration under its instance `name` when the class
 * declares one and its constructor name otherwise — mirror that rule
 * rather than assuming, since this track's migrations are inconsistent
 * about declaring it (both spellings resolve to the same string today,
 * and this keeps that from mattering).
 */
export function migrationName(
  migration: new () => MigrationInterface,
): string {
  const declared = (new migration() as { name?: string }).name;
  return declared ?? migration.name;
}

/**
 * Split out from the queries so the comparison itself is testable
 * without a database.
 *
 * A schema with no `tenant_migrations` table at all has run nothing —
 * every migration is pending, which is exactly what a half-provisioned
 * schema looks like.
 */
export function pendingTenantMigrations(
  expected: string[],
  appliedBySchema: Map<string, Set<string>>,
  schemaNames: string[],
): Array<{ schemaName: string; pending: string[] }> {
  return schemaNames
    .map((schemaName) => {
      const applied = appliedBySchema.get(schemaName) ?? new Set<string>();
      return {
        schemaName,
        pending: expected.filter((name) => !applied.has(name)),
      };
    })
    .filter((tenant) => tenant.pending.length > 0);
}

export async function findPendingMigrations(
  controlPlane: DataSource,
): Promise<PendingMigrations> {
  const controlPlanePending = await pendingControlPlaneNames(controlPlane);

  // A control plane that is itself behind may not have a `companies`
  // table to read, let alone trustworthy schema names in it — so don't
  // ask. The boot still fails on the pending list above, and the next
  // one (after migrating) checks the tenant track properly.
  if (controlPlanePending.length > 0) {
    return { controlPlane: controlPlanePending, tenantSchemas: [] };
  }

  const companies: Array<{ schema_name: string }> = await controlPlane.query(
    `SELECT schema_name FROM companies ORDER BY created_at`,
  );
  // Values read from the database and about to be interpolated into
  // SQL below — validated every time, same rule as everywhere else that
  // touches a schema name.
  const schemaNames = companies.map((row) => {
    assertValidSchemaName(row.schema_name);
    return row.schema_name;
  });

  return {
    controlPlane: controlPlanePending,
    tenantSchemas: pendingTenantMigrations(
      tenantMigrations.map(migrationName),
      await appliedTenantMigrations(controlPlane, schemaNames),
      schemaNames,
    ),
  };
}

/**
 * Read straight out of the bookkeeping table rather than via
 * `DataSource.showMigrations()`, which answers a bare yes/no and
 * creates the table as a side effect. On a database so fresh the table
 * doesn't exist yet, nothing has run — every migration is pending, and
 * saying so beats failing with a "relation does not exist" that reads
 * like a different bug entirely.
 */
async function pendingControlPlaneNames(
  controlPlane: DataSource,
): Promise<string[]> {
  const expected = controlPlane.migrations.map(
    (migration) => migration.name ?? migration.constructor.name,
  );

  const [table]: Array<{ table_name: string }> = await controlPlane.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'migrations'`,
  );
  if (!table) return expected;

  const executed: Array<{ name: string }> = await controlPlane.query(
    `SELECT name FROM migrations`,
  );
  const applied = new Set(executed.map((row) => row.name));
  return expected.filter((name) => !applied.has(name));
}

/**
 * One round trip for every schema rather than a connection per schema:
 * this runs on every boot, and the platform is capped at 250 companies
 * by design — 250 `DataSource.initialize()` calls at startup would be a
 * pool storm for a question a single UNION answers.
 */
async function appliedTenantMigrations(
  controlPlane: DataSource,
  schemaNames: string[],
): Promise<Map<string, Set<string>>> {
  const applied = new Map<string, Set<string>>();
  if (schemaNames.length === 0) return applied;

  const withTable: Array<{ table_schema: string }> = await controlPlane.query(
    `SELECT table_schema FROM information_schema.tables
      WHERE table_name = $1 AND table_schema = ANY($2)`,
    [TENANT_MIGRATIONS_TABLE, schemaNames],
  );
  if (withTable.length === 0) return applied;

  // Safe to interpolate: every name here passed assertValidSchemaName
  // (`^tenant_[a-z0-9_]{1,55}$`) and the table name is a constant.
  const rows: Array<{ schema_name: string; name: string }> =
    await controlPlane.query(
      withTable
        .map(
          (row) =>
            `SELECT '${row.table_schema}' AS schema_name, name FROM "${row.table_schema}"."${TENANT_MIGRATIONS_TABLE}"`,
        )
        .join(' UNION ALL '),
    );

  for (const row of rows) {
    const names = applied.get(row.schema_name) ?? new Set<string>();
    names.add(row.name);
    applied.set(row.schema_name, names);
  }
  return applied;
}
