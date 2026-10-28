import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { CompanyDetail, CompanySummary } from '@repo/types/companies';
import type { UpdateSubscriptionInput } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Step 2 of docs/subscriptions_planing.md: a new company starts on Free
 * with both names (B12, B20); Edit subscription sets plan, seats, end,
 * trial, currency and VAT with history rows (B2, B11); seats never go
 * below the users (B3); Free keeps ONE picked admin and deactivates the
 * rest (B13); a paid plan brings back exactly those (B14).
 */
describe('Company subscription (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let passwords: PasswordService;

  const superAdminEmail = 'e2e-cs-super@test.local';
  const password = 'TestPassword123!';
  const email = (name: string) => `e2e-cs-${name}@test.local`;

  let superToken: string;
  let companyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());
    passwords = app.get(PasswordService);

    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [superAdminEmail, await passwords.hash(password), UserRole.SUPER_ADMIN],
    );
    superToken = await loginAs(superAdminEmail);
  });

  afterAll(async () => {
    try {
      const rows: Array<{ id: string; schema_name: string }> =
        await controlPlane.query(
          `SELECT id, schema_name FROM companies WHERE name LIKE 'E2E CS %'`,
        );
      for (const row of rows) {
        await controlPlane.query(
          `DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`,
        );
        await controlPlane.query(
          `DELETE FROM admin_audit_log WHERE target_id = $1`,
          [row.id],
        );
        await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
          row.id,
        ]);
        await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
          row.id,
        ]);
        await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
          row.id,
        ]);
      }
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE email = $1)`,
        [superAdminEmail],
      );
      await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
        superAdminEmail,
      ]);
    } finally {
      await app.close();
    }
  });

  async function loginAs(address: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: address, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  function loginStatus(address: string): Promise<number> {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: address, password })
      .then((res) => res.status);
  }

  async function addUser(
    address: string,
    role: UserRole,
    status: 'active' | 'inactive' = 'active',
  ): Promise<string> {
    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [address, await passwords.hash(password), role, companyId, status],
    );
    return rows[0].id;
  }

  async function userRows(): Promise<
    Record<string, { status: string; planDeactivated: boolean }>
  > {
    const rows: Array<{
      email: string;
      status: string;
      plan_deactivated: boolean;
    }> = await controlPlane.query(
      `SELECT email, status, plan_deactivated FROM users WHERE company_id = $1`,
      [companyId],
    );
    return Object.fromEntries(
      rows.map((r) => [
        r.email,
        { status: r.status, planDeactivated: r.plan_deactivated },
      ]),
    );
  }

  function edit(
    overrides: Partial<UpdateSubscriptionInput>,
    token = superToken,
  ) {
    const body: UpdateSubscriptionInput = {
      planKey: 'pro',
      maxUsers: 5,
      endDate: '2027-01-16',
      isTrial: false,
      currency: 'SAR',
      vatRate: 15,
      note: null,
      keepAdminId: null,
      ...overrides,
    };
    return request(app.getHttpServer())
      .patch(`/admin/companies/${companyId}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('creates a company on Free with both names, and needs the Arabic one', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${superToken}` };

    await request(server)
      .post('/admin/companies')
      .set(auth)
      .send({
        name: 'E2E CS No Arabic',
        admin: { email: email('none'), password },
      })
      .expect(400);

    const res = await request(server)
      .post('/admin/companies')
      .set(auth)
      .send({
        name: 'E2E CS Gulf Facades',
        nameAr: 'واجهات الخليج',
        admin: { email: email('admin1'), password },
      })
      .expect(201);
    const company = res.body as CompanySummary;
    companyId = company.id;
    expect(company).toMatchObject({
      nameAr: 'واجهات الخليج',
      plan: { key: 'free' },
      maxUsers: 1,
      endsAt: null,
      isTrial: false,
      currency: 'EGP',
      vatRate: 14,
    });
  });

  it('refuses a company admin', async () => {
    const adminToken = await loginAs(email('admin1'));
    await edit({}, adminToken).expect(403);
  });

  it('sets plan, seats, end date, currency and VAT with a history row', async () => {
    const res = await edit({ note: 'Signed on the phone' }).expect(200);
    const detail = res.body as CompanyDetail;
    expect(detail).toMatchObject({
      plan: { key: 'pro' },
      maxUsers: 5,
      // 23:59:59 Cairo (UTC+2 in January).
      endsAt: '2027-01-16T21:59:59.000Z',
      currency: 'SAR',
      vatRate: 15,
    });
    expect(detail.billing[0]).toMatchObject({
      plan: { key: 'pro' },
      reason: 'edited',
      notes: 'Signed on the phone',
      actorEmail: superAdminEmail,
    });
    expect(detail.billing.at(-1)).toMatchObject({
      plan: { key: 'free' },
      reason: 'created',
    });
  });

  it('starts a trial on a paid plan', async () => {
    const res = await edit({ isTrial: true, endDate: '2026-11-11' }).expect(
      200,
    );
    const detail = res.body as CompanyDetail;
    expect(detail.isTrial).toBe(true);
    expect(detail.billing[0].reason).toBe('trial_started');
    await edit({ planKey: 'free', isTrial: true, endDate: null }).expect(400);
  });

  it('never lets seats go below the users (B3)', async () => {
    await addUser(email('admin2'), UserRole.COMPANY_ADMIN);
    await addUser(email('user3'), UserRole.USER);
    await addUser(email('user4'), UserRole.USER);

    const res = await edit({ maxUsers: 3 }).expect(400);
    expect((res.body as { code?: string }).code).toBe('seats_below_users');
    await edit({ maxUsers: 4 }).expect(200);
  });

  it('drops to Free keeping the picked admin, everyone else deactivated (B13)', async () => {
    // A user the company admin deactivated themselves.
    await controlPlane.query(
      `UPDATE users SET status = 'inactive' WHERE email = $1`,
      [email('user4')],
    );
    const user3Token = await loginAs(email('user3'));

    const users = (
      (
        await request(app.getHttpServer())
          .get(`/admin/companies/${companyId}`)
          .set('Authorization', `Bearer ${superToken}`)
          .expect(200)
      ).body as CompanyDetail
    ).users;
    const admin2 = users.find((u) => u.email === email('admin2'))!;
    const user3 = users.find((u) => u.email === email('user3'))!;

    const refused = await edit({
      planKey: 'free',
      endDate: null,
      keepAdminId: user3.id,
    }).expect(400);
    expect((refused.body as { code?: string }).code).toBe('free_admin_invalid');

    const res = await edit({
      planKey: 'free',
      endDate: null,
      keepAdminId: admin2.id,
    }).expect(200);
    const detail = res.body as CompanyDetail;
    expect(detail).toMatchObject({
      plan: { key: 'free' },
      maxUsers: 1,
      endsAt: null,
      isTrial: false,
    });
    expect(detail.billing[0].reason).toBe('dropped_to_free');

    expect(await userRows()).toEqual({
      [email('admin1')]: { status: 'inactive', planDeactivated: true },
      [email('admin2')]: { status: 'active', planDeactivated: false },
      [email('user3')]: { status: 'inactive', planDeactivated: true },
      [email('user4')]: { status: 'inactive', planDeactivated: false },
    });
    // Logged out at once, not when the token runs out.
    await request(app.getHttpServer())
      .get('/company/me')
      .set('Authorization', `Bearer ${user3Token}`)
      .expect(401);
    expect(await loginStatus(email('admin1'))).toBe(401);
    expect(await loginStatus(email('admin2'))).toBe(200);
  });

  it('swaps the kept admin while on Free', async () => {
    const admin1 = (
      (
        await request(app.getHttpServer())
          .get(`/admin/companies/${companyId}`)
          .set('Authorization', `Bearer ${superToken}`)
          .expect(200)
      ).body as CompanyDetail
    ).users.find((u) => u.email === email('admin1'))!;

    await edit({
      planKey: 'free',
      endDate: null,
      keepAdminId: admin1.id,
    }).expect(200);
    const rows = await userRows();
    expect(rows[email('admin1')]).toEqual({
      status: 'active',
      planDeactivated: false,
    });
    expect(rows[email('admin2')]).toEqual({
      status: 'inactive',
      planDeactivated: true,
    });
  });

  it('brings back exactly who Free deactivated, with a seat each (B14)', async () => {
    // All four users come back as seats: 3 is too few.
    await edit({ maxUsers: 3 }).expect(400);

    await edit({ maxUsers: 4 }).expect(200);
    expect(await userRows()).toEqual({
      [email('admin1')]: { status: 'active', planDeactivated: false },
      [email('admin2')]: { status: 'active', planDeactivated: false },
      [email('user3')]: { status: 'active', planDeactivated: false },
      // Deactivated by hand, so it stays deactivated.
      [email('user4')]: { status: 'inactive', planDeactivated: false },
    });
  });
});
