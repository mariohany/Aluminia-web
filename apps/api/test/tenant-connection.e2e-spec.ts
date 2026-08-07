import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { TenantConnectionService } from './../src/modules/tenancy/tenant-connection.service';
import { TenantInfo } from './../src/database/tenant/entities/tenant-info.entity';
import { tenantPoolDataSourceOptions } from './../src/database/tenant/tenant-pool.data-source';

// Runs against the real docker-compose Postgres. Everything under test
// here IS database behaviour — transaction scoping, search_path
// lifetime, identifier resolution — so mocking would test nothing that
// matters.
describe('TenantConnectionService (e2e)', () => {
  let app: INestApplication;
  let controlPlane: DataSource;
  let provisioning: TenantProvisioningService;

  // A dedicated pool capped at ONE connection, so "the next query gets
  // the same physical connection back" is guaranteed rather than likely.
  // Without this cap the leak test could pass by luck — pg would hand
  // out a different, never-dirtied connection and we'd learn nothing.
  let singleConnectionPool: DataSource;
  let service: TenantConnectionService;

  const companyOneName = 'E2E Conn Alpha Windows';
  const companyTwoName = 'E2E Conn Beta Glazing';
  const adminOneEmail = 'e2e-conn-alpha@test.local';
  const adminTwoEmail = 'e2e-conn-beta@test.local';

  let schemaOne: string;
  let schemaTwo: string;
  let companyOneId: string;
  let companyTwoId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    provisioning = app.get(TenantProvisioningService);

    singleConnectionPool = new DataSource({
      ...tenantPoolDataSourceOptions,
      name: 'tenant-pool-single-connection-test',
      extra: { max: 1 },
    });
    await singleConnectionPool.initialize();
    service = new TenantConnectionService(singleConnectionPool);

    // Two real, fully-provisioned tenants — the isolation claims below
    // are only meaningful against genuinely distinct schemas.
    const one = await provisioning.provision({
      name: companyOneName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminOneEmail, password: 'TestPassword123!' },
    });
    const two = await provisioning.provision({
      name: companyTwoName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminTwoEmail, password: 'TestPassword123!' },
    });

    schemaOne = one.company.schemaName;
    schemaTwo = two.company.schemaName;
    companyOneId = one.company.id;
    companyTwoId = two.company.id;
  });

  afterAll(async () => {
    for (const name of [companyOneName, companyTwoName]) {
      const companies: Array<{ id: string; schema_name: string }> =
        await controlPlane.query(
          `SELECT id, schema_name FROM companies WHERE name = $1`,
          [name],
        );
      for (const company of companies) {
        await controlPlane.query(
          `DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`,
        );
        await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
          company.id,
        ]);
        await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
          company.id,
        ]);
        await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
          company.id,
        ]);
      }
    }

    await singleConnectionPool.destroy();
    await app.close();
  });

  /** What `search_path` the pool's one connection is currently carrying. */
  async function currentSearchPath(): Promise<string> {
    const rows: Array<{ search_path: string }> =
      await singleConnectionPool.query(`SHOW search_path`);
    return rows[0].search_path;
  }

  it('resolves unqualified table names inside the requested schema', async () => {
    // Same entity, same query, two schemas — the only difference is the
    // schema name passed in. If the pool had a `schema` baked into it,
    // both of these would return the same row.
    const fromOne = await service.runInSchema(schemaOne, (manager) =>
      manager.find(TenantInfo),
    );
    const fromTwo = await service.runInSchema(schemaTwo, (manager) =>
      manager.find(TenantInfo),
    );

    expect(fromOne).toHaveLength(1);
    expect(fromOne[0].companyId).toBe(companyOneId);
    expect(fromOne[0].companyName).toBe(companyOneName);

    expect(fromTwo).toHaveLength(1);
    expect(fromTwo[0].companyId).toBe(companyTwoId);
    expect(fromTwo[0].companyName).toBe(companyTwoName);
  });

  it('leaves the pooled connection clean after a successful call', async () => {
    await service.runInSchema(schemaOne, (manager) => manager.find(TenantInfo));

    expect(await currentSearchPath()).not.toContain(schemaOne);
  });

  // The guarantee this whole phase exists to establish.
  it('leaves the pooled connection clean after the work THROWS', async () => {
    await expect(
      service.runInSchema(schemaOne, () =>
        Promise.reject(new Error('simulated handler failure')),
      ),
    ).rejects.toThrow('simulated handler failure');

    // Same physical connection (pool capped at 1). If SET LOCAL had been
    // a plain SET, this would still read `tenant_..._alpha_windows` and
    // the next tenant's request would silently read the wrong schema.
    expect(await currentSearchPath()).not.toContain(schemaOne);

    // And it is genuinely usable for a different tenant immediately.
    const fromTwo = await service.runInSchema(schemaTwo, (manager) =>
      manager.find(TenantInfo),
    );
    expect(fromTwo[0].companyId).toBe(companyTwoId);
  });

  it('leaves the pooled connection clean after a failed QUERY', async () => {
    // Distinct from the case above: here Postgres itself aborts the
    // transaction, rather than JS throwing before COMMIT.
    await expect(
      service.runInSchema(schemaOne, (manager) =>
        manager.query(`SELECT * FROM a_table_that_does_not_exist`),
      ),
    ).rejects.toThrow();

    expect(await currentSearchPath()).not.toContain(schemaOne);
  });

  it('does not put `public` on the search path', async () => {
    // Rule 4. `companies` is a control-plane table and must NOT be
    // reachable from inside a tenant schema — if it were, a query for a
    // tenant table that doesn't exist yet would silently fall through to
    // a same-named control-plane table and return real data from the
    // wrong place.
    await expect(
      service.runInSchema(schemaOne, (manager) =>
        manager.query(`SELECT id FROM companies LIMIT 1`),
      ),
    ).rejects.toThrow(/does not exist/i);
  });

  it('refuses an unsafe schema name before running any SQL', async () => {
    const work = jest.fn();

    await expect(
      service.runInSchema('public"; DROP TABLE users; --', work),
    ).rejects.toThrow(/unsafe schema name/i);

    // Not merely rejected — rejected early enough that nothing ran.
    expect(work).not.toHaveBeenCalled();
  });

  it('refuses a schema name that is real but not ours', async () => {
    // `public` is a legitimate Postgres schema, so this is not caught by
    // "does it exist" — only by the tenant_ prefix rule. Fails closed.
    await expect(
      service.runInSchema('public', (manager) => manager.find(TenantInfo)),
    ).rejects.toThrow(/unsafe schema name/i);
  });
});
