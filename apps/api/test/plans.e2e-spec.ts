import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { PaidPlanInput, PlanSummary } from '@repo/types/plans';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * The admin Plans page's API (docs/subscriptions_planing.md B1): the four
 * fixed plans, one PUT for the three paid ones, Free never editable,
 * an audit entry per changed plan. The plan rows are shared by every
 * suite, so this one puts back exactly what it found.
 */
describe('Admin plans (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E PL Aluminium';
  const companyAdminEmail = 'e2e-pl-admin@test.local';
  const superAdminEmail = 'e2e-pl-super@test.local';
  const password = 'TestPassword123!';

  let companyId: string;
  let companyAdminToken: string;
  let superToken: string;
  let superId: string;
  let original: PlanSummary[];

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
      name: companyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: companyAdminEmail, password },
    });
    companyId = company.company.id;

    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [
        superAdminEmail,
        await passwordService.hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );
    superId = rows[0].id;

    companyAdminToken = await loginAs(companyAdminEmail);
    superToken = await loginAs(superAdminEmail);
    original = await list();
  });

  afterAll(async () => {
    try {
      for (const plan of original ?? []) {
        await controlPlane.query(
          `UPDATE plans SET name_en = $2, name_ar = $3, seats = $4, monthly_egp = $5,
             annual_egp = $6, features = $7 WHERE key = $1`,
          [
            plan.key,
            plan.nameEn,
            plan.nameAr,
            plan.seats,
            plan.monthlyEgp,
            plan.annualEgp,
            plan.features,
          ],
        );
      }
      const schema: Array<{ schema_name: string }> = await controlPlane.query(
        `SELECT schema_name FROM companies WHERE id = $1`,
        [companyId],
      );
      await controlPlane.query(
        `DROP SCHEMA IF EXISTS "${schema[0]?.schema_name ?? ''}" CASCADE`,
      );
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = $1 OR email = $2)`,
        [companyId, superAdminEmail],
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

  async function list(): Promise<PlanSummary[]> {
    const res = await request(app.getHttpServer())
      .get('/admin/plans')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    return res.body as PlanSummary[];
  }

  function paidInput(plans: PlanSummary[]): PaidPlanInput[] {
    return plans
      .filter((plan) => plan.key !== 'free')
      .map((plan) => ({
        key: plan.key as PaidPlanInput['key'],
        nameEn: plan.nameEn,
        nameAr: plan.nameAr,
        seats: plan.seats,
        monthlyEgp: plan.monthlyEgp ?? 1,
        annualEgp: plan.annualEgp ?? 1,
        features: plan.features,
      }));
  }

  function put(plans: unknown, token = superToken) {
    return request(app.getHttpServer())
      .put('/admin/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ plans });
  }

  it('lists the four plans in order, Free without prices', () => {
    expect(original.map((plan) => plan.key)).toEqual([
      'free',
      'individual',
      'pro',
      'ultimate',
    ]);
    const free = original[0];
    expect(free.monthlyEgp).toBeNull();
    expect(free.annualEgp).toBeNull();
    expect(free.seats).toBe(1);
    expect(free.features).toEqual([]);
    for (const plan of original.slice(1)) {
      expect(typeof plan.monthlyEgp).toBe('number');
      expect(typeof plan.annualEgp).toBe('number');
    }
  });

  it('refuses a company admin', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${companyAdminToken}` };
    await request(server).get('/admin/plans').set(auth).expect(403);
    await put(paidInput(original), companyAdminToken).expect(403);
  });

  it('saves the paid plans and logs only the ones that changed', async () => {
    const input = paidInput(original);
    const pro = input.find((plan) => plan.key === 'pro')!;
    pro.nameEn = 'Pro E2E';
    pro.seats = 7;
    pro.monthlyEgp = 6123.45;
    pro.annualEgp = 66000;
    pro.features = ['data', 'reports']; // stored in PLAN_FEATURES order

    const res = await put(input).expect(200);
    const saved = (res.body as PlanSummary[]).find((p) => p.key === 'pro')!;
    expect(saved).toMatchObject({
      nameEn: 'Pro E2E',
      seats: 7,
      monthlyEgp: 6123.45,
      annualEgp: 66000,
      features: ['reports', 'data'],
    });

    const audit: Array<{
      action: string;
      target_id: string;
      metadata: { changes: Record<string, unknown> };
    }> = await controlPlane.query(
      `SELECT action, target_id, metadata FROM admin_audit_log
         WHERE actor_user_id = $1 AND action = 'plan.updated'`,
      [superId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].target_id).toBe(saved.id);
    expect(audit[0].metadata.changes.seats).toEqual({
      from: original.find((p) => p.key === 'pro')!.seats,
      to: 7,
    });

    // The same body again changes nothing and logs nothing.
    await put(input).expect(200);
    const again: Array<{ count: string }> = await controlPlane.query(
      `SELECT count(*) FROM admin_audit_log WHERE actor_user_id = $1 AND action = 'plan.updated'`,
      [superId],
    );
    expect(Number(again[0].count)).toBe(1);
  });

  it('never accepts Free, a missing plan, a duplicate or a bad price', async () => {
    const input = paidInput(original);

    await put([...input.slice(1), { ...input[0], key: 'free' }]).expect(400);
    await put(input.slice(0, 2)).expect(400);
    await put([input[0], input[0], input[1]]).expect(400);
    await put([{ ...input[0], monthlyEgp: 0 }, ...input.slice(1)]).expect(400);
    await put([{ ...input[0], seats: 0 }, ...input.slice(1)]).expect(400);
    await put([
      { ...input[0], features: ['window_editing'] },
      ...input.slice(1),
    ]).expect(400);
  });
});
