import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { InitialTenantSchema1785971048351 } from './../src/database/tenant/migrations/1785971048351-InitialTenantSchema';

// Runs against the real docker-compose Postgres. Provisioning is DDL
// plus transactions — mocking the database would test nothing that
// matters here.
describe('TenantProvisioning (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let provisioning: TenantProvisioningService;

  const testCompanyName = 'E2E Test Fabricators';
  const testAdminEmail = 'e2e-admin@test.local';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get<DataSource>(getDataSourceToken());
    provisioning = app.get(TenantProvisioningService);
  });

  afterEach(async () => {
    // Remove anything a test created, in FK-safe order.
    const companies: Array<{ id: string; schema_name: string }> =
      await dataSource.query(
        `SELECT id, schema_name FROM companies WHERE name = $1`,
        [testCompanyName],
      );
    for (const company of companies) {
      await dataSource.query(
        `DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`,
      );
      await dataSource.query(`DELETE FROM users WHERE company_id = $1`, [
        company.id,
      ]);
      await dataSource.query(`DELETE FROM billing WHERE company_id = $1`, [
        company.id,
      ]);
      await dataSource.query(`DELETE FROM companies WHERE id = $1`, [
        company.id,
      ]);
    }
    await dataSource.query(`DELETE FROM users WHERE email = $1`, [
      testAdminEmail,
    ]);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const input = () => ({
    name: testCompanyName,
    plan: 'starter',
    maxUsers: 5,
    admin: { email: testAdminEmail, password: 'TestPassword123!' },
  });

  async function schemaExists(schemaName: string): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists`,
      [schemaName],
    );
    return rows[0].exists;
  }

  async function companyCount(): Promise<number> {
    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM companies WHERE name = $1`,
      [testCompanyName],
    );
    return Number(rows[0].count);
  }

  it('provisions a company with its own migrated schema', async () => {
    const { company, admin } = await provisioning.provision(input());

    expect(company.schemaName).toMatch(/^tenant_[a-z0-9_]+$/);
    expect(admin.companyId).toBe(company.id);
    expect(await schemaExists(company.schemaName)).toBe(true);

    const tables: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [company.schemaName],
    );
    // Every table in the tenant track, in alphabetical order. Asserted
    // exhaustively rather than with `toContain`: a new tenant must come
    // up with the FULL current schema, and this test failing when a
    // migration is added is the point — it forces a deliberate look at
    // whether provisioning and `migrate:tenants` still agree.
    expect(tables.map((t) => t.table_name)).toEqual([
      'clients',
      'company_color',
      'company_glass',
      'company_glass_combination',
      'company_glass_combination_item',
      'company_paint_brand',
      'company_painting_price',
      'company_system_brand',
      'company_system_catalog',
      'company_system_profile',
      'projects',
      'tenant_info',
      'tenant_migrations',
    ]);

    // Those tables belong to THIS schema and must not also exist in the
    // control plane. A tenant table that leaked into `public` would let
    // this company work while breaking the next one provisioned — the
    // failure mode that `tenant-data-source.ts`'s search_path fixes.
    const leaked: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('clients', 'projects', 'company_color', 'company_glass')`,
    );
    expect(leaked).toEqual([]);

    // The tenant schema records which company owns it — the cross-check
    // that makes a mis-resolved tenant detectable rather than silent.
    const info: Array<{ company_id: string }> = await dataSource.query(
      `SELECT company_id FROM "${company.schemaName}".tenant_info`,
    );
    expect(info).toHaveLength(1);
    expect(info[0].company_id).toBe(company.id);

    // Migrations are recorded in TypeORM's format so the
    // migrate-all-tenants runner sees them as applied, not pending.
    const migrations: Array<{ name: string }> = await dataSource.query(
      `SELECT name FROM "${company.schemaName}".tenant_migrations`,
    );
    expect(migrations.map((m) => m.name)).toContain(
      'InitialTenantSchema1785971048351',
    );

    // The initial plan is recorded in the append-only billing history.
    const billing: Array<{ plan: string; max_users: number }> =
      await dataSource.query(
        `SELECT plan, max_users FROM billing WHERE company_id = $1`,
        [company.id],
      );
    expect(billing).toHaveLength(1);
    expect(billing[0].plan).toBe('starter');
  });

  it('gives two companies with the same name distinct schemas', async () => {
    const first = await provisioning.provision(input());
    const second = await provisioning.provision({
      ...input(),
      admin: { email: 'e2e-admin-2@test.local', password: 'TestPassword123!' },
    });

    expect(first.company.schemaName).not.toBe(second.company.schemaName);
    expect(await schemaExists(second.company.schemaName)).toBe(true);

    await dataSource.query(`DELETE FROM users WHERE email = $1`, [
      'e2e-admin-2@test.local',
    ]);
  });

  it('leaves nothing behind when the control-plane insert fails', async () => {
    // Duplicate email trips the unique constraint on users.email.
    await provisioning.provision(input());
    const countAfterFirst = await companyCount();

    await expect(
      provisioning.provision({ ...input(), name: testCompanyName }),
    ).rejects.toThrow();

    // No second company row survived the failure.
    expect(await companyCount()).toBe(countAfterFirst);
  });

  it('rolls back the CREATE SCHEMA when a tenant migration fails', async () => {
    // The case that actually matters: failure AFTER the schema exists.
    // Postgres DDL is transactional, and provisioning deliberately runs
    // everything on one connection, so the schema must vanish too.
    jest
      .spyOn(InitialTenantSchema1785971048351.prototype, 'up')
      .mockRejectedValueOnce(new Error('simulated migration failure'));

    await expect(provisioning.provision(input())).rejects.toThrow(
      'simulated migration failure',
    );

    expect(await companyCount()).toBe(0);

    // Scoped to THIS suite's company, not every schema starting with
    // `tenant_e2e`. The broader pattern passed while this was the only
    // e2e suite provisioning companies, then started failing when other
    // suites — running in parallel Jest workers against the same
    // database — had their own schemas alive at this moment. An
    // assertion that depends on no one else existing is a flake waiting
    // for a second test file.
    const orphanSchemas: Array<{ schema_name: string }> =
      await dataSource.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_e2e_test_fabricators%'`,
      );
    expect(orphanSchemas).toEqual([]);

    const orphanUsers: Array<{ email: string }> = await dataSource.query(
      `SELECT email FROM users WHERE email = $1`,
      [testAdminEmail],
    );
    expect(orphanUsers).toEqual([]);
  });
});
