import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { CompanySubscription } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Step 3 of docs/subscriptions_planing.md (§4a, §4b): a paid plan past its
 * end blocks everyone (B10); a trial past its end drops to Free on the
 * next request, keeping the oldest admin (B11, B13); Free locks features
 * (B12), allows one client and one project, and only the picked project
 * is editable, viewing and deleting aside (Q5); a paid plan unlocks it all
 * and brings the deactivated users back (B14). One company walks the
 * whole story, so the tests run in order.
 */
describe('Subscription enforcement (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E SE Aluminium';
  const adminEmail = 'e2e-se-admin@test.local';
  const userEmail = 'e2e-se-user@test.local';
  const superEmail = 'e2e-se-super@test.local';
  const password = 'TestPassword123!';

  let companyId: string;
  let userId: string;
  let adminToken: string;
  let userToken: string;
  let superToken: string;
  let firstProjectId: string;
  let secondProjectId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());
    const passwords = app.get(PasswordService);

    const company = await app.get(TenantProvisioningService).provision({
      name: companyName,
      planKey: 'pro',
      admin: { email: adminEmail, password },
    });
    companyId = company.company.id;
    const hash = await passwords.hash(password);
    const users: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [userEmail, hash, UserRole.USER, companyId],
    );
    userId = users[0].id;
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [superEmail, hash, UserRole.SUPER_ADMIN],
    );

    adminToken = await loginAs(adminEmail);
    userToken = await loginAs(userEmail);
    superToken = await loginAs(superEmail);
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
        `DELETE FROM admin_audit_log WHERE target_id = $1 OR actor_user_id IN (SELECT id FROM users WHERE company_id = $1 OR email = $2)`,
        [companyId, superEmail],
      );
      await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
        companyId,
      ]);
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
        companyId,
      ]);
      await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
        companyId,
      ]);
      await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
        superEmail,
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

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;
  const server = () => app.getHttpServer();

  async function subscription(): Promise<CompanySubscription> {
    const res = await request(server())
      .get('/company/subscription')
      .set(as(adminToken))
      .expect(200);
    return res.body as CompanySubscription;
  }

  it('lets a paid plan create clients and projects', async () => {
    const client = await request(server())
      .post('/clients')
      .set(as(adminToken))
      .send({ enName: 'SE Client' })
      .expect(201);
    const clientId = (client.body as { id: string }).id;
    const create = (enName: string) =>
      request(server())
        .post('/projects')
        .set(as(adminToken))
        .send({ clientId, enName })
        .expect(201)
        .then((res) => (res.body as { id: string }).id);
    firstProjectId = await create('SE One');
    secondProjectId = await create('SE Two');
    await request(server())
      .get('/reports/cutting-settings')
      .set(as(adminToken))
      .expect(200);

    const sub = await subscription();
    expect(sub).toMatchObject({
      state: { kind: 'active' },
      features: ['reports', 'data', 'project_settings'],
      limits: { clients: null, projects: null },
      counts: { clients: 1, projects: 2 },
      needsProjectPick: false,
    });
  });

  it('blocks every user once a paid plan ended (B10), and lets them back on renewal', async () => {
    await controlPlane.query(
      `UPDATE companies SET ends_at = now() - interval '1 minute' WHERE id = $1`,
      [companyId],
    );
    const blocked = await request(server())
      .get('/clients')
      .set(as(userToken))
      .expect(403);
    expect(code(blocked)).toBe('subscription_ended');
    await request(server()).get('/me').set(as(adminToken)).expect(403);
    const login = await request(server())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(401);
    expect(code(login)).toBe('subscription_ended');

    await controlPlane.query(
      `UPDATE companies SET ends_at = now() + interval '30 days' WHERE id = $1`,
      [companyId],
    );
    await request(server()).get('/clients').set(as(userToken)).expect(200);
  });

  it('drops a lapsed trial to Free on the next request, keeping the oldest admin (B11, B13)', async () => {
    await controlPlane.query(
      `UPDATE companies SET is_trial = true, ends_at = now() - interval '1 minute' WHERE id = $1`,
      [companyId],
    );
    const res = await request(server())
      .get('/clients')
      .set(as(userToken))
      .expect(401);
    expect(code(res)).toBe('plan_deactivated');

    const rows: Array<{ key: string; max_users: number; is_trial: boolean }> =
      await controlPlane.query(
        `SELECT p.key, c.max_users, c.is_trial FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = $1`,
        [companyId],
      );
    expect(rows[0]).toEqual({ key: 'free', max_users: 1, is_trial: false });
    const history: Array<{ reason: string; actor_id: string | null }> =
      await controlPlane.query(
        `SELECT reason, actor_id FROM billing WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [companyId],
      );
    expect(history[0]).toEqual({ reason: 'trial_ended', actor_id: null });

    const login = await request(server())
      .post('/auth/login')
      .send({ email: userEmail, password })
      .expect(401);
    expect(code(login)).toBe('plan_deactivated');
    // The admin carries on.
    await request(server()).get('/clients').set(as(adminToken)).expect(200);
  });

  it('locks paid features on Free, reads aside (B12)', async () => {
    const sub = await subscription();
    expect(sub).toMatchObject({
      state: { kind: 'free' },
      features: [],
      limits: { clients: 1, projects: 1 },
      needsProjectPick: true,
    });

    const locked = await request(server())
      .get('/reports/cutting-settings')
      .set(as(adminToken))
      .expect(403);
    expect(code(locked)).toBe('feature_locked');
    await request(server())
      .get('/company/lookups/version')
      .set(as(adminToken))
      .expect(200);
    const dataWrite = await request(server())
      .post('/company/lookups/colors')
      .set(as(adminToken))
      .send({})
      .expect(403);
    expect(code(dataWrite)).toBe('feature_locked');
    await request(server())
      .get('/project-statuses')
      .set(as(adminToken))
      .expect(200);
    const settingsWrite = await request(server())
      .patch('/project-settings')
      .set(as(adminToken))
      .send({})
      .expect(403);
    expect(code(settingsWrite)).toBe('feature_locked');
  });

  it('allows one client and one project on Free', async () => {
    const client = await request(server())
      .post('/clients')
      .set(as(adminToken))
      .send({ enName: 'SE Second Client' })
      .expect(409);
    expect(code(client)).toBe('plan_limit');
    const clients = await request(server())
      .get('/clients')
      .set(as(adminToken))
      .expect(200);
    const project = await request(server())
      .post('/projects')
      .set(as(adminToken))
      .send({
        clientId: (clients.body as Array<{ id: string }>)[0].id,
        enName: 'SE Three',
      })
      .expect(409);
    expect(code(project)).toBe('plan_limit');
  });

  it('never reactivates past the one Free seat', async () => {
    const res = await request(server())
      .post(`/company/users/${userId}/reactivate`)
      .set(as(adminToken))
      .expect(409);
    expect(code(res)).toBe('plan_limit');
  });

  it('keeps only the picked project editable; viewing and deleting stay (B13, Q5)', async () => {
    const rename = (id: string, enName: string) =>
      request(server())
        .patch(`/projects/${id}`)
        .set(as(adminToken))
        .send({ enName });

    // Nothing picked yet, two projects: both read-only.
    expect(code(await rename(firstProjectId, 'SE One b').expect(403))).toBe(
      'project_read_only',
    );
    await request(server())
      .get(`/projects/${firstProjectId}`)
      .set(as(adminToken))
      .expect(200);

    const picked = await request(server())
      .post('/company/subscription/free-project')
      .set(as(adminToken))
      .send({ projectId: firstProjectId })
      .expect(200);
    expect(picked.body).toMatchObject({
      freeProjectId: firstProjectId,
      needsProjectPick: false,
    });
    // Once: only the super admin resets it.
    const again = await request(server())
      .post('/company/subscription/free-project')
      .set(as(adminToken))
      .send({ projectId: secondProjectId })
      .expect(409);
    expect(code(again)).toBe('free_project_picked');

    await rename(firstProjectId, 'SE One b').expect(200);
    expect(code(await rename(secondProjectId, 'SE Two b').expect(403))).toBe(
      'project_read_only',
    );

    await request(server())
      .delete(`/admin/companies/${companyId}/free-project`)
      .set(as(superToken))
      .expect(200);
    expect((await subscription()).needsProjectPick).toBe(true);

    // Deleting a read-only project is allowed, and one project left is
    // editable without a pick.
    await request(server())
      .delete(`/projects/${secondProjectId}`)
      .set(as(adminToken))
      .send({ confirmName: 'SE Two' })
      .expect(204);
    await rename(firstProjectId, 'SE One c').expect(200);
  });

  it('unlocks everything on a paid plan and brings the deactivated user back (B14)', async () => {
    await request(server())
      .patch(`/admin/companies/${companyId}/subscription`)
      .set(as(superToken))
      .send({
        planKey: 'pro',
        maxUsers: 5,
        endDate: '2099-12-31',
        isTrial: false,
        currency: 'EGP',
        vatRate: 14,
        note: null,
        keepAdminId: null,
      })
      .expect(200);

    const freshUser = await loginAs(userEmail);
    await request(server()).get('/clients').set(as(freshUser)).expect(200);
    await request(server())
      .get('/reports/cutting-settings')
      .set(as(adminToken))
      .expect(200);
    const sub = await subscription();
    expect(sub).toMatchObject({
      state: { kind: 'active' },
      limits: { clients: null, projects: null },
      freeProjectId: null,
    });
  });
});
