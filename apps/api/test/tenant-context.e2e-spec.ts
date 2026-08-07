import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { TenantConnectionService } from './../src/modules/tenancy/tenant-connection.service';
import { TenantContextService } from './../src/modules/tenancy/tenant-context.service';
import { TenantInfo } from './../src/database/tenant/entities/tenant-info.entity';

// Runs against the real docker-compose Postgres. TenantContextService is
// request-scoped, so it's constructed directly here with a fake request
// object — the same "plain fake, not a DI container" approach as
// auth.service.spec.ts — rather than through Nest's request-scoped
// resolution machinery, which is what Phase 3's HTTP-level test exists
// to exercise.
describe('TenantContextService (e2e)', () => {
  let app: INestApplication;
  let controlPlane: DataSource;
  let provisioning: TenantProvisioningService;
  let tenantConnection: TenantConnectionService;

  const companyName = 'E2E Context Fabricators';
  const adminEmail = 'e2e-context-admin@test.local';

  let companyId: string;
  let schemaName: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    provisioning = app.get(TenantProvisioningService);
    tenantConnection = app.get(TenantConnectionService);

    const { company } = await provisioning.provision({
      name: companyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminEmail, password: 'TestPassword123!' },
    });
    companyId = company.id;
    schemaName = company.schemaName;
  });

  afterAll(async () => {
    await controlPlane.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
      adminEmail,
    ]);
    await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
      companyId,
    ]);
    await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
      companyId,
    ]);
    await app.close();
  });

  function fakeRequest(tenant: Request['tenant']): Request {
    return { tenant } as Request;
  }

  it('throws if used on a request TenantGuard never resolved', async () => {
    const context = new TenantContextService(
      fakeRequest(undefined),
      tenantConnection,
    );

    await expect(
      context.run((manager) => manager.find(TenantInfo)),
    ).rejects.toThrow(/no @TenantScoped\(\) guard/);
  });

  it('runs work inside the resolved schema', async () => {
    const context = new TenantContextService(
      fakeRequest({ companyId, companyName, schemaName }),
      tenantConnection,
    );

    const [info] = await context.run((manager) => manager.find(TenantInfo));
    expect(info.companyId).toBe(companyId);
    expect(info.companyName).toBe(companyName);
  });

  it('refuses when tenant_info disagrees with the resolved claim', async () => {
    // A companyId that does not match this schema's own tenant_info row
    // — exactly the scenario the cross-check exists to catch: a schema
    // resolved correctly by name, but recording a different owner.
    const context = new TenantContextService(
      fakeRequest({
        companyId: 'not-the-real-company-id',
        companyName,
        schemaName,
      }),
      tenantConnection,
    );

    await expect(
      context.run((manager) => manager.find(TenantInfo)),
    ).rejects.toThrow(/tenant_info does not match/);
  });

  it('only checks tenant_info once per instance, not on every call', async () => {
    const context = new TenantContextService(
      fakeRequest({ companyId, companyName, schemaName }),
      tenantConnection,
    );

    // First call establishes the correct claim and caches "verified".
    await context.run((manager) => manager.find(TenantInfo));

    // Directly corrupt this schema's own tenant_info row, bypassing the
    // service — something that should never happen in real life, but is
    // exactly what the cross-check exists to catch if it ever did. If
    // the check re-ran on every call, this next run() would now throw.
    await controlPlane.query(
      `UPDATE "${schemaName}"."tenant_info" SET company_id = gen_random_uuid()`,
    );

    // It doesn't throw — proving the flag from the first call, not a
    // fresh check, is what the second call relies on.
    const secondResult = await context.run((manager) =>
      manager.query<Array<{ ok: number }>>('SELECT 1 AS ok'),
    );
    expect(secondResult).toEqual([{ ok: 1 }]);

    // Restore it — a fresh TenantContextService instance (a new request,
    // in real life) must still catch the corruption independently.
    const freshContext = new TenantContextService(
      fakeRequest({ companyId, companyName, schemaName }),
      tenantConnection,
    );
    await expect(
      freshContext.run((manager) => manager.find(TenantInfo)),
    ).rejects.toThrow(/tenant_info does not match/);

    await controlPlane.query(
      `UPDATE "${schemaName}"."tenant_info" SET company_id = $1`,
      [companyId],
    );
  });
});
