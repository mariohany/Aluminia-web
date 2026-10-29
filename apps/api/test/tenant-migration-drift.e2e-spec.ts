import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { migrateTenantSchema } from './../src/database/tenant/migrate-all-tenants';
import { findPendingMigrations } from './../src/database/migration-check';

/**
 * Stability S10: tenant migrations are applied two ways: provisioning
 * runs the list itself inside its own transaction and writes the
 * `tenant_migrations` rows by hand, while `migrate:tenants` (and so the
 * deploy) uses TypeORM's runner. If the rows provisioning writes ever
 * stop matching what TypeORM recognises, new companies and old ones
 * drift apart. This provisions a company, then asks both the runner
 * and the boot gate about its schema: neither may find anything to do.
 *
 * Only this suite's own schema is checked: other suites provision and
 * drop companies in parallel.
 */
describe('Tenant migration drift (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let companyId: string;
  let schemaName: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());

    const { company } = await app.get(TenantProvisioningService).provision({
      name: `E2E Drift ${Date.now()}`,
      planKey: 'pro',
      maxUsers: 5,
      admin: {
        email: `e2e-drift-${Date.now()}@test.local`,
        password: 'TestPassword123!',
      },
    });
    companyId = company.id;
    schemaName = company.schemaName;
  });

  afterAll(async () => {
    try {
      await controlPlane.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
        companyId,
      ]);
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
        companyId,
      ]);
      await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
        companyId,
      ]);
    } finally {
      await app.close();
    }
  });

  it("TypeORM's runner finds nothing to apply on a freshly provisioned schema", async () => {
    await expect(migrateTenantSchema(schemaName)).resolves.toEqual([]);
  });

  it('the boot gate reports nothing pending for it', async () => {
    const pending = await findPendingMigrations(controlPlane);
    expect(
      pending.tenantSchemas.find((tenant) => tenant.schemaName === schemaName),
    ).toBeUndefined();
  });
});
