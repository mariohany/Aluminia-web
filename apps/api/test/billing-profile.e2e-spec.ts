import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type {
  BillingProfile,
  UpdateBillingProfileInput,
} from '@repo/types/billing-profile';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Billing › Billing profile (docs/subscriptions_planing.md B17, §3e): the
 * seller details, the platform's own logo (a file owned by no company),
 * and this year's next numbers, which only go up. The profile row and the
 * counters are shared by every suite, so this one puts back what it found.
 */
describe('Admin billing profile (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E BP Aluminium';
  const companyAdminEmail = 'e2e-bp-admin@test.local';
  const superAdminEmail = 'e2e-bp-super@test.local';
  const password = 'TestPassword123!';
  // A real 1 × 1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  let companyId: string;
  let companyAdminToken: string;
  let superToken: string;
  let superId: string;
  let originalProfile: Array<Record<string, unknown>>;
  let originalCounters: Array<{ kind: string; year: number; last: number }>;
  let original: BillingProfile;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());

    const company = await app.get(TenantProvisioningService).provision({
      name: companyName,
      planKey: 'pro',
      admin: { email: companyAdminEmail, password },
    });
    companyId = company.company.id;
    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [
        superAdminEmail,
        await app.get(PasswordService).hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );
    superId = rows[0].id;
    originalProfile = await controlPlane.query(`SELECT * FROM billing_profile`);
    originalCounters = await controlPlane.query(
      `SELECT kind, year, last FROM billing_counters`,
    );

    companyAdminToken = await loginAs(companyAdminEmail);
    superToken = await loginAs(superAdminEmail);
    original = await get();
  });

  afterAll(async () => {
    try {
      await controlPlane.query(`DELETE FROM billing_profile`);
      for (const row of originalProfile ?? []) {
        const columns = Object.keys(row);
        await controlPlane.query(
          `INSERT INTO billing_profile (${columns.map((c) => `"${c}"`).join(', ')})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
          columns.map((c) => row[c]),
        );
      }
      await controlPlane.query(`DELETE FROM billing_counters`);
      for (const c of originalCounters ?? []) {
        await controlPlane.query(
          `INSERT INTO billing_counters (kind, year, last) VALUES ($1, $2, $3)`,
          [c.kind, c.year, c.last],
        );
      }
      await controlPlane.query(
        `DELETE FROM files WHERE company_id IS NULL AND uploaded_by_user_id = $1`,
        [superId],
      );
      const schemas: Array<{ schema_name: string }> = await controlPlane.query(
        `SELECT schema_name FROM companies WHERE id = $1`,
        [companyId],
      );
      await controlPlane.query(
        `DROP SCHEMA IF EXISTS "${schemas[0]?.schema_name ?? ''}" CASCADE`,
      );
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id = $1 OR target_id = $2`,
        [superId, companyId],
      );
      await controlPlane.query(
        `DELETE FROM users WHERE company_id = $1 OR id = $2`,
        [companyId, superId],
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

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function get(): Promise<BillingProfile> {
    const res = await request(app.getHttpServer())
      .get('/admin/billing-profile')
      .set(as(superToken))
      .expect(200);
    return res.body as BillingProfile;
  }

  const upload = (token: string, purpose: string) =>
    request(app.getHttpServer())
      .post('/files')
      .set(as(token))
      .field('purpose', purpose)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });

  const input = (
    over: Partial<UpdateBillingProfileInput> = {},
  ): UpdateBillingProfileInput => ({
    legalNameEn: 'Aluminia Software LLC',
    legalNameAr: 'ألومينيا للبرمجيات',
    addressEn: '12 Tahrir St, Cairo',
    addressAr: '١٢ شارع التحرير، القاهرة',
    taxId: '512-884-901',
    commercialRegister: '184522',
    billingEmail: 'billing@aluminia.test',
    phone: null,
    bankAccount: 'CIB · EG38 0019 0005',
    instapay: null,
    logoFileId: null,
    nextQuotation: original.numbering.nextQuotation,
    nextInvoice: original.numbering.nextInvoice,
    ...over,
  });

  it('is for the super admin only', async () => {
    await request(app.getHttpServer())
      .get('/admin/billing-profile')
      .set(as(companyAdminToken))
      .expect(403);
    expect(original.numbering.year).toBeGreaterThanOrEqual(2026);
  });

  it('refuses a form with a required field missing', async () => {
    await request(app.getHttpServer())
      .put('/admin/billing-profile')
      .set(as(superToken))
      .send({ ...input(), taxId: '' })
      .expect(400);
  });

  it('keeps the platform logo apart from company files', async () => {
    await upload(companyAdminToken, 'billing_logo').expect(403);
    await upload(superToken, 'logo').expect(403);
    const res = await upload(superToken, 'billing_logo').expect(201);
    const id = (res.body as { id: string }).id;
    await request(app.getHttpServer())
      .get(`/files/${id}`)
      .set(as(superToken))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/files/${id}`)
      .set(as(companyAdminToken))
      .expect(404);
  });

  it('saves the details, the logo and higher next numbers, with an audit entry', async () => {
    const logo = await upload(superToken, 'billing_logo').expect(201);
    const logoFileId = (logo.body as { id: string }).id;
    const next = {
      nextQuotation: original.numbering.nextQuotation + 42,
      nextInvoice: original.numbering.nextInvoice + 18,
    };
    const res = await request(app.getHttpServer())
      .put('/admin/billing-profile')
      .set(as(superToken))
      .send(input({ logoFileId, ...next }))
      .expect(200);
    const saved = res.body as BillingProfile;
    expect(saved.details).toMatchObject({
      legalNameEn: 'Aluminia Software LLC',
      logoFileId,
    });
    expect(saved.numbering).toMatchObject(next);

    const audit: Array<{ action: string }> = await controlPlane.query(
      `SELECT action FROM admin_audit_log WHERE actor_user_id = $1`,
      [superId],
    );
    expect(audit.map((a) => a.action)).toContain('billing.profile_updated');

    // A logo replaced by none is released.
    await request(app.getHttpServer())
      .put('/admin/billing-profile')
      .set(as(superToken))
      .send(input(next))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/files/${logoFileId}`)
      .set(as(superToken))
      .expect(404);
  });

  it('never lets a next number go back down (B17)', async () => {
    const current = (await get()).numbering;
    const res = await request(app.getHttpServer())
      .put('/admin/billing-profile')
      .set(as(superToken))
      .send(
        input({
          nextQuotation: current.nextQuotation - 1,
          nextInvoice: current.nextInvoice,
        }),
      )
      .expect(400);
    expect((res.body as { code?: string }).code).toBe('number_too_low');
    expect((await get()).numbering).toEqual(current);
  });
});
