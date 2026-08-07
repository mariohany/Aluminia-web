import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';
import { TenantWhoamiTestModule } from './fixtures/tenant-whoami.module';
import type { TenantWhoamiResponse } from './fixtures/tenant-whoami.controller';

/**
 * The actual point of Phase 6 (see docs/tenant_resolver_planing.md):
 * proof that two different tenants hitting the same route get two
 * different schemas, and that every fail-closed gate really refuses.
 * Real Postgres, real HTTP, real /auth/login — no mocking.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let provisioning: TenantProvisioningService;
  let passwordService: PasswordService;
  let jwtService: JwtService;

  const companyOneName = 'E2E Isolation Alpha Windows';
  const companyTwoName = 'E2E Isolation Beta Glazing';
  const adminOneEmail = 'e2e-iso-alpha@test.local';
  const adminTwoEmail = 'e2e-iso-beta@test.local';
  const superAdminEmail = 'e2e-iso-super@test.local';
  const password = 'TestPassword123!';

  let companyOneId: string;
  let companyTwoId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // TenantWhoamiTestModule exists only for this file — see its
      // comment for why it's not part of AppModule.
      imports: [AppModule, TenantWhoamiTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    provisioning = app.get(TenantProvisioningService);
    passwordService = app.get(PasswordService);
    jwtService = app.get(JwtService);

    const one = await provisioning.provision({
      name: companyOneName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminOneEmail, password },
    });
    const two = await provisioning.provision({
      name: companyTwoName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminTwoEmail, password },
    });
    companyOneId = one.company.id;
    companyTwoId = two.company.id;

    // A real super admin, created directly rather than relying on
    // seed:dev having run — this suite stands on its own.
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [
        superAdminEmail,
        await passwordService.hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );
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
    await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
      superAdminEmail,
    ]);
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  it('gives each company only its own data through the same route', async () => {
    const tokenOne = await loginAs(adminOneEmail);
    const tokenTwo = await loginAs(adminTwoEmail);

    const resOne = await request(app.getHttpServer())
      .get('/tenant/whoami')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    const bodyOne = resOne.body as TenantWhoamiResponse;
    expect(bodyOne.companyId).toBe(companyOneId);
    expect(bodyOne.companyName).toBe(companyOneName);

    const resTwo = await request(app.getHttpServer())
      .get('/tenant/whoami')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);
    const bodyTwo = resTwo.body as TenantWhoamiResponse;
    expect(bodyTwo.companyId).toBe(companyTwoId);
    expect(bodyTwo.companyName).toBe(companyTwoName);

    // The isolation claim itself, stated directly rather than only
    // implied by the two assertions above.
    expect(bodyOne.companyId).not.toBe(bodyTwo.companyId);
  });

  it('rejects a request with no token', async () => {
    await request(app.getHttpServer()).get('/tenant/whoami').expect(401);
  });

  it('rejects a super admin — authenticated, but belongs to no company', async () => {
    const token = await loginAs(superAdminEmail);

    await request(app.getHttpServer())
      .get('/tenant/whoami')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('rejects a hand-minted token naming a company that does not exist', async () => {
    // Real login can never produce this claim — only a forged or
    // corrupted one could. Signed with the app's own JwtService, so it
    // passes signature verification cleanly and is rejected purely on
    // the companyId lookup, exactly like a real forged token would be.
    const token = await jwtService.signAsync({
      sub: randomUUID(),
      role: UserRole.USER,
      companyId: randomUUID(),
    });

    await request(app.getHttpServer())
      .get('/tenant/whoami')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a still-valid token once its company is archived mid-session', async () => {
    const token = await loginAs(adminOneEmail);

    // Archived directly, bypassing the real archive endpoint — this
    // test is about TenantGuard's live re-check on every request, not
    // about the archive flow itself (covered by the Companies suite).
    // The access token above is still within its ~15-minute lifetime.
    await controlPlane.query(
      `UPDATE companies SET status = 'suspended' WHERE id = $1`,
      [companyOneId],
    );

    await request(app.getHttpServer())
      .get('/tenant/whoami')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    // Restore, so this test's side effect doesn't leak into whichever
    // test runs next.
    await controlPlane.query(
      `UPDATE companies SET status = 'active' WHERE id = $1`,
      [companyOneId],
    );
  });
});
