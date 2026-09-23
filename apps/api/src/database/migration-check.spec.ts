import type { MigrationInterface, QueryRunner } from 'typeorm';
import { migrationName, pendingTenantMigrations } from './migration-check';

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

    expect(
      pendingTenantMigrations(expected, applied, ['tenant_acme']),
    ).toEqual([{ schemaName: 'tenant_acme', pending: ['AddTwo2', 'AddThree3'] }]);
  });

  // A schema with no tenant_migrations table at all never reaches the
  // map — a half-provisioned tenant, which has run nothing.
  it('treats a schema with no bookkeeping table as having run nothing', () => {
    expect(pendingTenantMigrations(expected, new Map(), ['tenant_new'])).toEqual(
      [{ schemaName: 'tenant_new', pending: expected }],
    );
  });

  it('reports each lagging schema separately and skips the healthy ones', () => {
    const applied = new Map([
      ['tenant_acme', new Set(expected)],
      ['tenant_beta', new Set(['AddOne1', 'AddTwo2'])],
    ]);

    expect(
      pendingTenantMigrations(expected, applied, ['tenant_acme', 'tenant_beta']),
    ).toEqual([{ schemaName: 'tenant_beta', pending: ['AddThree3'] }]);
  });

  it('is empty for a platform with no companies yet', () => {
    expect(pendingTenantMigrations(expected, new Map(), [])).toEqual([]);
  });
});

describe('migrationName', () => {
  class Declared1000 implements MigrationInterface {
    name = 'Declared1000';
    public async up(_queryRunner: QueryRunner): Promise<void> {}
    public async down(_queryRunner: QueryRunner): Promise<void> {}
  }

  class Undeclared2000 implements MigrationInterface {
    public async up(_queryRunner: QueryRunner): Promise<void> {}
    public async down(_queryRunner: QueryRunner): Promise<void> {}
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
