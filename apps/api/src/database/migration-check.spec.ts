import type { DataSource, MigrationInterface } from 'typeorm';
import {
  findPendingMigrations,
  migrationName,
  pendingTenantMigrations,
} from './migration-check';
import { tenantMigrations } from './tenant/migrations';

// The boot gate's comparison, isolated from the queries that feed it —
// the half that decides whether the API refuses to start.
describe('pendingTenantMigrations', () => {
  const expected = ['AddOne1', 'AddTwo2', 'AddThree3'];

  it('says nothing is pending when a schema has run every migration', () => {
    const applied = new Map([['tenant_acme', new Set(expected)]]);

    expect(pendingTenantMigrations(expected, applied, ['tenant_acme'])).toEqual(
      [],
    );
  });

  it('reports only the migrations a schema is actually missing', () => {
    const applied = new Map([['tenant_acme', new Set(['AddOne1'])]]);

    expect(pendingTenantMigrations(expected, applied, ['tenant_acme'])).toEqual(
      [{ schemaName: 'tenant_acme', pending: ['AddTwo2', 'AddThree3'] }],
    );
  });

  // A schema with no tenant_migrations table at all never reaches the
  // map — a half-provisioned tenant, which has run nothing.
  it('treats a schema with no bookkeeping table as having run nothing', () => {
    expect(
      pendingTenantMigrations(expected, new Map(), ['tenant_new']),
    ).toEqual([{ schemaName: 'tenant_new', pending: expected }]);
  });

  it('reports each lagging schema separately and skips the healthy ones', () => {
    const applied = new Map([
      ['tenant_acme', new Set(expected)],
      ['tenant_beta', new Set(['AddOne1', 'AddTwo2'])],
    ]);

    expect(
      pendingTenantMigrations(expected, applied, [
        'tenant_acme',
        'tenant_beta',
      ]),
    ).toEqual([{ schemaName: 'tenant_beta', pending: ['AddThree3'] }]);
  });

  it('is empty for a platform with no companies yet', () => {
    expect(pendingTenantMigrations(expected, new Map(), [])).toEqual([]);
  });
});

describe('migrationName', () => {
  class Declared1000 implements MigrationInterface {
    name = 'Declared1000';
    public async up(): Promise<void> {}
    public async down(): Promise<void> {}
  }

  class Undeclared2000 implements MigrationInterface {
    public async up(): Promise<void> {}
    public async down(): Promise<void> {}
  }

  // This track's migrations are inconsistent about declaring `name`;
  // TypeORM records the declared one when present and the class name
  // otherwise, and the comparison above is only valid if we match it.
  it('reads the declared name when the migration sets one', () => {
    expect(migrationName(Declared1000)).toBe('Declared1000');
  });

  it('falls back to the class name when it does not', () => {
    expect(migrationName(Undeclared2000)).toBe('Undeclared2000');
  });
});

// The queries around that comparison, against a fake control plane that
// answers by SQL text. Only the tenant track is exercised: no
// control-plane migrations are registered and all of them have run.
describe('findPendingMigrations', () => {
  const allTenantMigrations = tenantMigrations.map(migrationName);
  const undefinedTable = Object.assign(new Error('relation does not exist'), {
    code: '42P01',
  });

  // `unionResults` is consumed one per UNION read, so a test can make the
  // first read hit a schema dropped since the table check.
  function fakeControlPlane(
    tablesBySchemaCheck: string[][],
    unionResults: Array<Error | string[]>,
  ) {
    const query = jest.fn((sql: string) => {
      if (sql.includes("table_name = 'migrations'"))
        return Promise.resolve([{ table_name: 'migrations' }]);
      if (sql.startsWith('SELECT name FROM migrations'))
        return Promise.resolve([]);
      if (sql.includes('FROM companies'))
        return Promise.resolve([
          { schema_name: 'tenant_kept' },
          { schema_name: 'tenant_dropped' },
        ]);
      if (sql.includes('information_schema.tables')) {
        const schemas = tablesBySchemaCheck.shift() ?? [];
        return Promise.resolve(
          schemas.map((table_schema) => ({ table_schema })),
        );
      }
      const next = unionResults.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(
        (next ?? []).flatMap((schema) =>
          allTenantMigrations.map((name) => ({ schema_name: schema, name })),
        ),
      );
    });
    return { migrations: [], query } as unknown as DataSource;
  }

  it('asks again when a schema is dropped between the table check and the read', async () => {
    const controlPlane = fakeControlPlane(
      [['tenant_kept', 'tenant_dropped'], ['tenant_kept']],
      [undefinedTable, ['tenant_kept']],
    );

    const pending = await findPendingMigrations(controlPlane);

    expect(
      pending.tenantSchemas.find((t) => t.schemaName === 'tenant_kept'),
    ).toBeUndefined();
  });

  it('gives up after three reads that keep hitting a dropped table', async () => {
    const controlPlane = fakeControlPlane(
      [['tenant_kept'], ['tenant_kept'], ['tenant_kept']],
      [undefinedTable, undefinedTable, undefinedTable],
    );

    await expect(findPendingMigrations(controlPlane)).rejects.toBe(
      undefinedTable,
    );
  });

  it('does not retry any other database error', async () => {
    const otherError = Object.assign(new Error('permission denied'), {
      code: '42501',
    });
    const controlPlane = fakeControlPlane(
      [['tenant_kept'], ['tenant_kept']],
      [otherError, ['tenant_kept']],
    );

    await expect(findPendingMigrations(controlPlane)).rejects.toBe(otherError);
  });
});
