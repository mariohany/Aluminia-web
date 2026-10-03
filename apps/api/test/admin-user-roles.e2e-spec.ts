import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * The super-admin line can't be crossed through PATCH /admin/users/:id
 * (Mario, 2026-10-03): a company user is never promoted to super admin,
 * and a super admin is never moved into a company. Plain company-role
 * changes keep working.
 */
describe('Admin user roles (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyAdminEmail = 'e2e-ur-admin@test.local';
  const superAdminEmail = 'e2e-ur-super@test.local';
  const otherSuperEmail = 'e2e-ur-super2@test.local';
  const password = 'TestPassword123!';

  let companyId: string;
  let companyAdminId: string;
  let otherSuperId: string;
  let superToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    const passwordService = app.get(PasswordService);

    const company = await provisioning.provision({
      name: 'E2E UR Aluminium',
      plan: 'starter',
      maxUsers: 5,
      admin: { email: companyAdminEmail, password },
    });
    companyId = company.company.id;

    const hash = await passwordService.hash(password);
    for (const email of [superAdminEmail, otherSuperEmail]) {
      await controlPlane.query(
        `INSERT INTO users (email, password_hash, role, company_id, status)
         VALUES ($1, $2, $3, NULL, 'active')`,
        [email, hash, UserRole.SUPER_ADMIN],
      );
    }

    const rows: Array<{ id: string; email: string }> = await controlPlane.query(
      `SELECT id, email FROM users WHERE email = ANY($1)`,
      [[companyAdminEmail, otherSuperEmail]],
    );
    companyAdminId = rows.find((r) => r.email === companyAdminEmail)!.id;
    otherSuperId = rows.find((r) => r.email === otherSuperEmail)!.id;

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: superAdminEmail, password })
      .expect(200);
    superToken = (res.body as LoginResponse).accessToken;
  });

  afterAll(async () => {
    try {
      const rows: Array<{ schema_name: string }> = await controlPlane.query(
        `SELECT schema_name FROM companies WHERE id = $1`,
        [companyId],
      );
      await controlPlane.query(
        `DROP SCHEMA IF EXISTS "${rows[0]?.schema_name ?? ''}" CASCADE`,
      );
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = $1 OR email = ANY($2))`,
        [companyId, [superAdminEmail, otherSuperEmail]],
      );
      await controlPlane.query(
        `DELETE FROM users WHERE company_id = $1 OR email = ANY($2)`,
        [companyId, [superAdminEmail, otherSuperEmail]],
      );
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

  const patch = (id: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/admin/users/${id}`)
      .set({ Authorization: `Bearer ${superToken}` })
      .send(body);

  it('refuses promoting a company user to super admin', async () => {
    await patch(companyAdminId, {
      role: UserRole.SUPER_ADMIN,
      companyId: null,
    }).expect(400);
    const rows: Array<{ role: string; company_id: string | null }> =
      await controlPlane.query(
        `SELECT role, company_id FROM users WHERE id = $1`,
        [companyAdminId],
      );
    expect(rows[0]).toEqual({
      role: UserRole.COMPANY_ADMIN,
      company_id: companyId,
    });
  });

  it('refuses moving a super admin into a company', async () => {
    await patch(otherSuperId, { role: UserRole.USER, companyId }).expect(400);
    const rows: Array<{ role: string; company_id: string | null }> =
      await controlPlane.query(
        `SELECT role, company_id FROM users WHERE id = $1`,
        [otherSuperId],
      );
    expect(rows[0]).toEqual({ role: UserRole.SUPER_ADMIN, company_id: null });
  });

  it('still allows switching between company roles', async () => {
    await patch(companyAdminId, { role: UserRole.USER }).expect(200);
    await patch(companyAdminId, { role: UserRole.COMPANY_ADMIN }).expect(200);
  });
});
