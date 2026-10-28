import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';
import { AuthVersionService } from './../src/modules/auth/auth-version.service';
import { clearRateLimits } from './fixtures/clear-rate-limits';

/**
 * Stability S3: a change to a user's access takes effect on their next
 * request, not when their 15-minute access token expires. Each test
 * logs a fresh user in, changes them, and replays the access token it
 * already had — which must be refused — then tries the refresh cookie:
 * a role change refreshes into the new role; everything else (company
 * move, deactivate, password reset, ended session, delete, company
 * archived) is a logout, so the refresh fails too.
 */
describe('Access revocation (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let passwordHash: string;
  let superToken: string;

  const password = 'TestPassword123!';
  const superEmail = 'e2e-revoke-super@test.local';
  const companyIds: string[] = [];
  let companyA: string;
  let companyB: string;
  let userCount = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
    await clearRateLimits(app, 'AuthController.refresh');

    controlPlane = app.get<DataSource>(getDataSourceToken());
    passwordHash = await app.get(PasswordService).hash(password);
    const provisioning = app.get(TenantProvisioningService);
    for (const name of ['E2E Revoke A', 'E2E Revoke B']) {
      const { company } = await provisioning.provision({
        name,
        planKey: 'pro',
        maxUsers: 5,
        admin: {
          email: `e2e-revoke-${companyIds.length}@test.local`,
          password,
        },
      });
      companyIds.push(company.id);
    }
    [companyA, companyB] = companyIds;

    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [superEmail, passwordHash, UserRole.SUPER_ADMIN],
    );
    superToken = (await login(superEmail)).accessToken;
  });

  afterAll(async () => {
    try {
      const rows: Array<{ schema_name: string }> = await controlPlane.query(
        `SELECT schema_name FROM companies WHERE id = ANY($1)`,
        [companyIds],
      );
      for (const row of rows) {
        await controlPlane.query(
          `DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`,
        );
      }
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = ANY($1) OR email = $2)`,
        [companyIds, superEmail],
      );
      await controlPlane.query(
        `DELETE FROM users WHERE company_id = ANY($1) OR email = $2`,
        [companyIds, superEmail],
      );
      await controlPlane.query(
        `DELETE FROM billing WHERE company_id = ANY($1)`,
        [companyIds],
      );
      await controlPlane.query(`DELETE FROM companies WHERE id = ANY($1)`, [
        companyIds,
      ]);
    } finally {
      await app.close();
    }
  });

  async function login(
    email: string,
  ): Promise<LoginResponse & { cookie: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies
      .find((value) => value.startsWith('refresh_token='))!
      .split(';')[0];
    return { ...(res.body as LoginResponse), cookie };
  }

  /** A logged-in company user: their id, access token and refresh cookie. */
  async function loggedInUser(
    companyId: string,
    role: string = UserRole.COMPANY_ADMIN,
  ) {
    const email = `e2e-revoke-user-${userCount++}@test.local`;
    const [{ id }] = await controlPlane.query<Array<{ id: string }>>(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [email, passwordHash, role, companyId],
    );
    const session = await login(email);
    // The token works before anything changes.
    await me(session.accessToken).expect(200);
    return { id, email, token: session.accessToken, cookie: session.cookie };
  }

  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
  const refresh = (cookie: string) =>
    request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
  const admin = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${superToken}`)
      .send(body ?? {});

  it('a role change refuses the old token; the refresh brings the new role', async () => {
    const user = await loggedInUser(companyA);
    await admin('patch', `/admin/users/${user.id}`, {
      role: UserRole.USER,
    }).expect(200);

    await me(user.token).expect(401);
    const res = await refresh(user.cookie).expect(200);
    const body = res.body as LoginResponse;
    expect(body.user.role).toBe(UserRole.USER);
    const meRes = await me(body.accessToken).expect(200);
    expect((meRes.body as { role: string }).role).toBe(UserRole.USER);
  });

  it('an email-only change leaves the token alone', async () => {
    const user = await loggedInUser(companyA);
    await admin('patch', `/admin/users/${user.id}`, {
      email: `renamed-${user.email}`,
    }).expect(200);
    await me(user.token).expect(200);
  });

  it('a company move logs the user out', async () => {
    const user = await loggedInUser(companyA, UserRole.USER);
    await admin('patch', `/admin/users/${user.id}`, {
      companyId: companyB,
    }).expect(200);

    await me(user.token).expect(401);
    await refresh(user.cookie).expect(401);
  });

  it('deactivating logs the user out', async () => {
    const user = await loggedInUser(companyA);
    await admin('post', `/admin/users/${user.id}/deactivate`).expect(200);

    await me(user.token).expect(401);
    await refresh(user.cookie).expect(401);
  });

  it('a password reset logs the user out', async () => {
    const user = await loggedInUser(companyA);
    await admin('post', `/admin/users/${user.id}/reset-password`, {
      password: 'Another-Pass-123',
    }).expect((res) => expect(res.status).toBeLessThan(300));

    await me(user.token).expect(401);
    await refresh(user.cookie).expect(401);
  });

  it('ending the session logs the user out', async () => {
    const user = await loggedInUser(companyA);
    await admin('post', `/admin/users/${user.id}/end-session`).expect((res) =>
      expect(res.status).toBeLessThan(300),
    );

    await me(user.token).expect(401);
    await refresh(user.cookie).expect(401);
  });

  it('deleting the user refuses their token', async () => {
    const user = await loggedInUser(companyA);
    await admin('delete', `/admin/users/${user.id}`, {
      confirmEmail: user.email,
    }).expect((res) => expect(res.status).toBeLessThan(300));

    await me(user.token).expect(401);
  });

  it('a company admin deactivating their own user logs that user out', async () => {
    const companyAdmin = await loggedInUser(companyA);
    const user = await loggedInUser(companyA, UserRole.USER);
    await request(app.getHttpServer())
      .post(`/company/users/${user.id}/deactivate`)
      .set('Authorization', `Bearer ${companyAdmin.token}`)
      .expect(200);

    await me(user.token).expect(401);
  });

  // The cache's ordering rules, against real Redis: bumps can publish out
  // of order, and a reader can try to cache a version it read just
  // before a bump or delete.
  it('never lets an older version or a cache fill overwrite a newer one', async () => {
    const versions = app.get(AuthVersionService);
    const user = await loggedInUser(companyA);
    await admin('patch', `/admin/users/${user.id}`, {
      role: UserRole.USER,
    }).expect(200);
    const after = await versions.current(user.id);

    await versions.publish([{ userId: user.id, version: (after ?? 0) - 1 }]);
    expect(await versions.current(user.id)).toBe(after);
  });

  it('keeps a deleted user deleted in the cache', async () => {
    const versions = app.get(AuthVersionService);
    const user = await loggedInUser(companyA);
    await admin('delete', `/admin/users/${user.id}`, {
      confirmEmail: user.email,
    }).expect((res) => expect(res.status).toBeLessThan(300));

    await versions.publish([{ userId: user.id, version: 99 }]);
    expect(await versions.current(user.id)).toBeNull();
  });

  // Last: archiving company B logs out everyone in it.
  it('archiving a company logs out all of its users, on every route', async () => {
    const one = await loggedInUser(companyB);
    const two = await loggedInUser(companyB, UserRole.USER);
    await admin('post', `/admin/companies/${companyB}/archive`).expect(200);

    for (const user of [one, two]) {
      await me(user.token).expect(401);
      await refresh(user.cookie).expect(401);
    }
  });
});
