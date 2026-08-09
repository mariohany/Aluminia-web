import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { CompanyOverview, UserSummary } from '@repo/types/users';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * The company-admin user surface: who a company admin can reach, what
 * they can create, and whether the seat limit actually holds when two
 * requests arrive at once.
 *
 * Control-plane work, not tenant work — `users` lives in the shared
 * schema. The boundary under test is `companyId` from the JWT.
 */
describe('Company-admin user management (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyOneName = 'E2E CU Alpha Aluminium';
  const companyTwoName = 'E2E CU Beta Glazing';
  const seatCompanyName = 'E2E CU Seat Limited';
  const adminOneEmail = 'e2e-cu-alpha@test.local';
  const adminTwoEmail = 'e2e-cu-beta@test.local';
  const seatAdminEmail = 'e2e-cu-seat@test.local';
  const superAdminEmail = 'e2e-cu-super@test.local';
  const password = 'TestPassword123!';

  let companyOneId: string;
  let tokenOne: string;
  let tokenTwo: string;
  let seatToken: string;
  let superToken: string;
  let adminOneId: string;
  let adminTwoId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    const passwordService = app.get(PasswordService);

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
    // Three seats, one spent on the admin — so exactly two are free,
    // which is what the concurrency test races for.
    await provisioning.provision({
      name: seatCompanyName,
      plan: 'starter',
      maxUsers: 3,
      admin: { email: seatAdminEmail, password },
    });

    companyOneId = one.company.id;
    adminOneId = one.admin.id;
    adminTwoId = two.admin.id;

    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [
        superAdminEmail,
        await passwordService.hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );

    tokenOne = await loginAs(adminOneEmail);
    tokenTwo = await loginAs(adminTwoEmail);
    seatToken = await loginAs(seatAdminEmail);
    superToken = await loginAs(superAdminEmail);
  });

  afterAll(async () => {
    // Wrapped so a cleanup failure still closes the app. Without this,
    // a throw here leaves the Nest application — and its Postgres
    // pool — open, and Jest hangs forever on the open handle rather
    // than reporting the real error. Learned the hard way.
    try {
      for (const name of [companyOneName, companyTwoName, seatCompanyName]) {
        const companies: Array<{ id: string; schema_name: string }> =
          await controlPlane.query(
            `SELECT id, schema_name FROM companies WHERE name = $1`,
            [name],
          );
        for (const company of companies) {
          await controlPlane.query(
            `DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`,
          );
          // Audit rows FIRST. Unlike the other e2e suites, this one
          // exercises the audited write paths (create/deactivate/
          // delete), so `admin_audit_log.actor_user_id` now references
          // these users — and that FK is ON DELETE RESTRICT by design,
          // so an audit trail cannot be erased by deleting its actor.
          await controlPlane.query(
            `DELETE FROM admin_audit_log
              WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = $1)`,
            [company.id],
          );
          await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
            company.id,
          ]);
          await controlPlane.query(
            `DELETE FROM billing WHERE company_id = $1`,
            [company.id],
          );
          await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
            company.id,
          ]);
        }
      }
      await controlPlane.query(
        `DELETE FROM admin_audit_log
          WHERE actor_user_id IN (SELECT id FROM users WHERE email = $1)`,
        [superAdminEmail],
      );
      await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
        superAdminEmail,
      ]);
    } finally {
      await app.close();
    }
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  it('reports the caller’s own company and seat usage', async () => {
    const res = await request(app.getHttpServer())
      .get('/company/me')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    const body = res.body as CompanyOverview;
    expect(body.name).toBe(companyOneName);
    expect(body.maxUsers).toBe(5);
    expect(body.seatsUsed).toBeGreaterThanOrEqual(1);
  });

  it('lists only the caller’s own company’s users', async () => {
    const res = await request(app.getHttpServer())
      .get('/company/users')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    const emails = (res.body as UserSummary[]).map((u) => u.email);
    expect(emails).toContain(adminOneEmail);
    expect(emails).not.toContain(adminTwoEmail);
    expect(emails).not.toContain(superAdminEmail);

    // The same boundary from the other side. Asserted in both
    // directions on purpose: a scope bug that widened the query to
    // every company would still satisfy the one-sided version whenever
    // the caller happened to be the company the extra rows came from.
    const mirror = await request(app.getHttpServer())
      .get('/company/users')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);

    const mirrorEmails = (mirror.body as UserSummary[]).map((u) => u.email);
    expect(mirrorEmails).toContain(adminTwoEmail);
    expect(mirrorEmails).not.toContain(adminOneEmail);
    expect(mirrorEmails).not.toContain(superAdminEmail);
  });

  it('creates plain users only, ignoring a smuggled role and company', async () => {
    const res = await request(app.getHttpServer())
      .post('/company/users')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        email: 'e2e-cu-escalate@test.local',
        password,
        // Neither field exists on createCompanyUserSchema, so Zod
        // strips them. This asserts the escalation attempt is inert,
        // not merely unvalidated.
        role: UserRole.COMPANY_ADMIN,
        companyId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(201);

    const body = res.body as UserSummary;
    expect(body.role).toBe(UserRole.USER);
    expect(body.companyId).toBe(companyOneId);
  });

  it('refuses a plain user every route on the company-admin surface', async () => {
    const userToken = await loginAs('e2e-cu-escalate@test.local');
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${userToken}` };

    await request(server).get('/company/users').set(auth).expect(403);
    await request(server)
      .post('/company/users')
      .set(auth)
      .send({ email: 'nope@test.local', password })
      .expect(403);

    // But the company itself is readable — everyone in the workspace
    // needs the company name in the chrome.
    await request(server).get('/company/me').set(auth).expect(200);
  });

  it('refuses a super admin, who belongs to no company', async () => {
    await request(app.getHttpServer())
      .get('/company/users')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(403);
  });

  it('refuses every operation on another company’s user, with 404', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${tokenOne}` };

    // 404 rather than 403 throughout: a 403 would confirm that the user
    // exists, which is an existence oracle across a company boundary.
    await request(server)
      .post(`/company/users/${adminTwoId}/deactivate`)
      .set(auth)
      .expect(404);
    await request(server)
      .post(`/company/users/${adminTwoId}/reset-password`)
      .set(auth)
      .send({ password: 'Hijacked123!' })
      .expect(404);
    await request(server)
      .delete(`/company/users/${adminTwoId}`)
      .set(auth)
      .send({ confirmEmail: adminTwoEmail })
      .expect(404);

    // And the target is genuinely untouched: they can still log in
    // with their original password.
    await loginAs(adminTwoEmail);
  });

  it('refuses a company admin locking themselves out', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${tokenOne}` };

    await request(server)
      .post(`/company/users/${adminOneId}/deactivate`)
      .set(auth)
      .expect(403);
    await request(server)
      .delete(`/company/users/${adminOneId}`)
      .set(auth)
      .send({ confirmEmail: adminOneEmail })
      .expect(403);
  });

  it('enforces the seat limit under concurrency', async () => {
    const before = await request(app.getHttpServer())
      .get('/company/me')
      .set('Authorization', `Bearer ${seatToken}`)
      .expect(200);
    const free =
      (before.body as CompanyOverview).maxUsers -
      (before.body as CompanyOverview).seatsUsed;
    expect(free).toBe(2);

    // Six at once for two seats. This is the test that matters: a
    // sequential version would still pass with the FOR UPDATE lock in
    // lockCompanyForSeatCheck removed, which makes it worthless as a
    // regression guard. Concurrent, it fails without the lock.
    const attempts = Array.from({ length: 6 }, (_, i) =>
      request(app.getHttpServer())
        .post('/company/users')
        .set('Authorization', `Bearer ${seatToken}`)
        .send({ email: `e2e-cu-race${i}@test.local`, password }),
    );
    const results = await Promise.all(attempts);
    const created = results.filter((r) => r.status === 201);

    expect(created).toHaveLength(2);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);

    const after = await request(app.getHttpServer())
      .get('/company/me')
      .set('Authorization', `Bearer ${seatToken}`)
      .expect(200);
    expect((after.body as CompanyOverview).seatsUsed).toBe(3);
  });

  it('lets a super admin create several company admins for one company', async () => {
    // The documented recovery path when a company loses its only admin.
    // True today by accident of the schema; asserted here so it becomes
    // a guarantee instead.
    const second = await request(app.getHttpServer())
      .post('/admin/users')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        email: 'e2e-cu-admin2@test.local',
        password,
        role: UserRole.COMPANY_ADMIN,
        companyId: companyOneId,
      })
      .expect(201);

    expect((second.body as UserSummary).role).toBe(UserRole.COMPANY_ADMIN);

    // Both admins can actually log in and use the surface — the point
    // of the recovery path, not just that a row was inserted.
    const secondToken = await loginAs('e2e-cu-admin2@test.local');
    await request(app.getHttpServer())
      .get('/company/users')
      .set('Authorization', `Bearer ${secondToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/company/users')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
  });
});
