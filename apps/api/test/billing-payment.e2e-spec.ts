import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import {
  periodEnd,
  type BillingDocumentSummary,
  type MarkPaidInput,
  type QuotationInput,
} from '@repo/types/billing-documents';
import { addDays, cairoDateOf } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Record payment (docs/payment_cycle_planing.md §6, P12, P14, P22, P23):
 * an expired quotation is paid only after the warning, a different amount
 * needs a note, a reference is used once per method, the money can't
 * arrive tomorrow, and the paid history row keeps the subscription from
 * before (the same-day undo). The invoice's default recipients are the
 * company admins.
 */
describe('Billing payments (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E BP Aluminium';
  const adminEmail = 'e2e-bp-admin@test.local';
  const userEmail = 'e2e-bp-user@test.local';
  const superEmail = 'e2e-bp-super@test.local';
  const password = 'TestPassword123!';
  const today = cairoDateOf(new Date());

  let companyId: string;
  let superId: string;
  let userId: string;
  let superToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());

    const company = await app.get(TenantProvisioningService).provision({
      name: companyName,
      admin: { email: adminEmail, password },
    });
    companyId = company.company.id;
    const hash = await app.get(PasswordService).hash(password);
    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [superEmail, hash, UserRole.SUPER_ADMIN],
    );
    superId = rows[0].id;
    // Paused by Free: the payment brings it back, and records that it did.
    const user: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status, plan_deactivated)
       VALUES ($1, $2, $3, $4, 'inactive', true) RETURNING id`,
      [userEmail, hash, UserRole.USER, companyId],
    );
    userId = user[0].id;
    await controlPlane.query(
      `INSERT INTO billing_profile (id, legal_name_en, legal_name_ar, address_en, address_ar,
         tax_id, commercial_register, billing_email, bank_account)
       VALUES (1, 'Aluminia Software LLC', 'ألومينيا', 'Cairo', 'القاهرة', '512', '184', 'billing@aluminia.test', 'CIB')
       ON CONFLICT (id) DO NOTHING`,
    );
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: superEmail, password })
      .expect(200);
    superToken = (res.body as LoginResponse).accessToken;
  });

  afterAll(async () => {
    try {
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
      for (const sql of [
        `DELETE FROM billing WHERE company_id = $1`,
        `DELETE FROM billing_documents WHERE company_id = $1 AND kind = 'invoice'`,
        `DELETE FROM billing_documents WHERE company_id = $1`,
        `DELETE FROM users WHERE company_id = $1`,
        `DELETE FROM companies WHERE id = $1`,
      ]) {
        await controlPlane.query(sql, [companyId]);
      }
      await controlPlane.query(`DELETE FROM users WHERE id = $1`, [superId]);
    } finally {
      await app.close();
    }
  });

  const as = () => ({ Authorization: `Bearer ${superToken}` });
  const server = () => app.getHttpServer();
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

  const create = (over: Partial<QuotationInput> = {}) =>
    request(server())
      .post(`/admin/companies/${companyId}/quotations`)
      .set(as())
      .send({
        purpose: 'new',
        planKey: 'pro',
        extraSeats: 0,
        extraSeatPrice: 0,
        months: 1,
        startsOn: today,
        endsOn: periodEnd(today, 1),
        currency: 'EGP',
        fxRate: null,
        unitPrice: 6000,
        discountKind: null,
        discountValue: null,
        vatRate: 14,
        validUntil: addDays(today, 14),
        note: null,
        ...over,
      } satisfies QuotationInput);
  const pay = (id: string, over: Partial<MarkPaidInput> = {}) =>
    request(server())
      .post(`/admin/billing/documents/${id}/pay`)
      .set(as())
      .send({
        paidOn: today,
        amountReceived: 6840,
        method: 'bank_transfer',
        reference: 'BP-1001',
        ...over,
      } satisfies MarkPaidInput);

  let invoice: BillingDocumentSummary;

  it('pays an expired quotation only after the warning (P14)', async () => {
    const expired = (
      await create({ validUntil: addDays(today, -1) }).expect(201)
    ).body as BillingDocumentSummary;
    expect(expired.status).toBe('expired');
    expect(code(await pay(expired.id).expect(409))).toBe('quotation_expired');

    // The money can't arrive tomorrow; a different amount needs a note.
    expect(
      code(
        await pay(expired.id, {
          acknowledgeExpired: true,
          paidOn: addDays(today, 1),
        }).expect(400),
      ),
    ).toBe('paid_in_future');
    expect(
      code(
        await pay(expired.id, {
          acknowledgeExpired: true,
          amountReceived: 6800,
        }).expect(400),
      ),
    ).toBe('note_required');

    invoice = (
      await pay(expired.id, {
        acknowledgeExpired: true,
        amountReceived: 6800,
        note: '  Bank fee of 40 EGP  ',
      }).expect(200)
    ).body as BillingDocumentSummary;
    expect(invoice).toMatchObject({
      kind: 'invoice',
      amountReceived: 6800,
      paymentNote: 'Bank fee of 40 EGP',
      paymentReference: 'BP-1001',
    });
    expect(invoice.totals.total).toBe(6840);
    expect(
      Math.abs(Date.parse(invoice.paymentRecordedAt!) - Date.now()),
    ).toBeLessThan(60_000);
  });

  it('keeps the subscription from before on the paid history row (P22)', async () => {
    const rows: Array<{ previous: Record<string, unknown> }> =
      await controlPlane.query(
        `SELECT previous FROM billing WHERE company_id = $1 AND reason = 'paid'`,
        [companyId],
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].previous).toMatchObject({
      maxUsers: 1,
      endsAt: null,
      isTrial: false,
      reactivatedUserIds: [userId],
    });
  });

  it('uses a reference once per method, any case (§6)', async () => {
    const q = (await create({ purpose: 'renewal' }).expect(201))
      .body as BillingDocumentSummary;
    expect(code(await pay(q.id, { reference: ' bp-1001 ' }).expect(409))).toBe(
      'reference_used',
    );
    // The same number under another method is another payment.
    await pay(q.id, { method: 'cheque', reference: 'BP-1001' }).expect(200);
  });

  it('defaults the invoice email to the company admins (P23)', async () => {
    const res = await request(server())
      .get(`/admin/billing/documents/${invoice.id}/send-defaults`)
      .set(as())
      .expect(200);
    expect(res.body).toMatchObject({ to: [adminEmail] });
  });
});
