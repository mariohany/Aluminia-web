import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { CompanyDetail, CompanySummary } from '@repo/types/companies';
import { addDays, cairoDateOf, endOfCairoDay } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Trials (docs/payment_cycle_planing.md P2, P20, P26; tasks 2.1, 2.4):
 * Grant only from Free, on the plan's own seats, bringing back the users
 * Free paused; Extend adds days to the current end (at most 90 days from
 * today); End drops to Free now. History rows only: no quotation,
 * invoice or payment is ever made.
 */
describe('Company trials (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let passwords: PasswordService;

  const superAdminEmail = 'e2e-trial-super@test.local';
  const password = 'TestPassword123!';
  const email = (name: string) => `e2e-trial-${name}@test.local`;

  let superToken: string;
  let companyId: string;
  const today = () => cairoDateOf(new Date());

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

    const res = await request(app.getHttpServer())
      .post('/admin/companies')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        name: 'E2E Trial Gulf Facades',
        nameAr: 'واجهات الخليج تجربة',
        admin: { email: email('admin1'), password },
      })
      .expect(201);
    companyId = (res.body as CompanySummary).id;
    // Two users Free paused (as a drop to Free leaves them).
    for (const name of ['admin2', 'user3']) {
      await controlPlane.query(
        `INSERT INTO users (email, password_hash, role, company_id, status, plan_deactivated)
         VALUES ($1, $2, $3, $4, 'inactive', true)`,
        [
          email(name),
          await passwords.hash(password),
          name === 'admin2' ? UserRole.COMPANY_ADMIN : UserRole.USER,
          companyId,
        ],
      );
    }
  });

  afterAll(async () => {
    try {
      const rows: Array<{ id: string; schema_name: string }> =
        await controlPlane.query(
          `SELECT id, schema_name FROM companies WHERE name LIKE 'E2E Trial %'`,
        );
      for (const row of rows) {
        await controlPlane.query(
          `DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`,
        );
        for (const table of ['admin_audit_log']) {
          await controlPlane.query(
            `DELETE FROM ${table} WHERE target_id = $1`,
            [row.id],
          );
        }
        for (const table of ['users', 'billing', 'billing_documents']) {
          await controlPlane.query(
            `DELETE FROM ${table} WHERE company_id = $1`,
            [row.id],
          );
        }
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

  function post(path: string, body: object, token = superToken) {
    return request(app.getHttpServer())
      .post(`/admin/companies/${companyId}/trial${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function seatsOf(key: string): Promise<number> {
    const rows: Array<{ seats: number }> = await controlPlane.query(
      `SELECT seats FROM plans WHERE key = $1`,
      [key],
    );
    return rows[0].seats;
  }

  async function users(): Promise<Record<string, string>> {
    const rows: Array<{ email: string; status: string }> =
      await controlPlane.query(
        `SELECT email, status FROM users WHERE company_id = $1`,
        [companyId],
      );
    return Object.fromEntries(rows.map((r) => [r.email, r.status]));
  }

  it('refuses a company admin and anything but a trial-able state', async () => {
    const adminToken = await loginAs(email('admin1'));
    await post('', { planKey: 'pro', days: 14 }, adminToken).expect(403);
    // On Free there is no trial to extend or end.
    const extend = await post('/extend', { days: 7 }).expect(409);
    expect((extend.body as { code?: string }).code).toBe('not_on_trial');
    await post('/end', { reason: null }).expect(409);
    // Free is not a trial plan; days stay 1 to 90.
    await post('', { planKey: 'free', days: 14 }).expect(400);
    await post('', { planKey: 'pro', days: 91 }).expect(400);
  });

  it('refuses a plan with fewer seats than the users (P20)', async () => {
    const proSeats = await seatsOf('pro');
    // 3 users: a plan with fewer seats can't hold them.
    const small = (await seatsOf('individual')) < 3;
    if (small) {
      const res = await post('', { planKey: 'individual', days: 14 }).expect(
        400,
      );
      expect((res.body as { code?: string }).code).toBe('seats_below_users');
    }
    expect(proSeats).toBeGreaterThanOrEqual(3);
  });

  it('grants a trial on the plan seats, bringing paused users back', async () => {
    const res = await post('', { planKey: 'pro', days: 14 }).expect(200);
    const detail = res.body as CompanyDetail;
    expect(detail).toMatchObject({
      plan: { key: 'pro' },
      maxUsers: await seatsOf('pro'),
      isTrial: true,
      endsAt: endOfCairoDay(addDays(today(), 14)).toISOString(),
    });
    expect(detail.billing[0]).toMatchObject({
      reason: 'trial_started',
      actorEmail: superAdminEmail,
    });
    expect(Object.values(await users())).toEqual([
      'active',
      'active',
      'active',
    ]);

    const again = await post('', { planKey: 'ultimate', days: 7 }).expect(409);
    expect((again.body as { code?: string }).code).toBe('not_on_free');
  });

  it('extends from the current end, at most 90 days from today', async () => {
    const res = await post('/extend', { days: 7 }).expect(200);
    const detail = res.body as CompanyDetail;
    expect(detail.endsAt).toBe(
      endOfCairoDay(addDays(today(), 21)).toISOString(),
    );
    expect(detail.isTrial).toBe(true);
    expect(detail.billing[0].reason).toBe('trial_extended');

    // 21 + 70 = 91 days from today: one too many.
    const long = await post('/extend', { days: 70 }).expect(400);
    expect((long.body as { code?: string }).code).toBe('trial_too_long');
    await post('/extend', { days: 69 }).expect(200);
  });

  it('ends the trial now: Free, the oldest admin stays', async () => {
    const res = await post('/end', { reason: 'Client asked to stop' }).expect(
      200,
    );
    const detail = res.body as CompanyDetail;
    expect(detail).toMatchObject({
      plan: { key: 'free' },
      maxUsers: 1,
      endsAt: null,
      isTrial: false,
    });
    expect(detail.billing[0]).toMatchObject({
      reason: 'trial_ended',
      notes: 'Client asked to stop',
      actorEmail: superAdminEmail,
    });
    expect(await users()).toEqual({
      [email('admin1')]: 'active',
      [email('admin2')]: 'inactive',
      [email('user3')]: 'inactive',
    });
  });

  it('made no quotation, invoice or payment, and logged every action', async () => {
    const docs: Array<{ n: number }> = await controlPlane.query(
      `SELECT count(*)::int AS n FROM billing_documents WHERE company_id = $1`,
      [companyId],
    );
    expect(docs[0].n).toBe(0);
    const audit: Array<{ action: string }> = await controlPlane.query(
      `SELECT action FROM admin_audit_log WHERE target_id = $1 AND action LIKE 'company.trial_%' ORDER BY created_at`,
      [companyId],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'company.trial_granted',
      'company.trial_extended',
      'company.trial_extended',
      'company.trial_ended',
    ]);
  });
});
