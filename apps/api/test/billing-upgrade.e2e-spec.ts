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
  unusedCredit,
  type BillingDocumentSummary,
  type QuotationInput,
} from '@repo/types/billing-documents';
import { addDays, cairoDateOf } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Quotation types (docs/payment_cycle_planing.md P11, P15, P16, P30):
 * new only off a paid plan, renewal / upgrade only on one; an upgrade
 * starts today, keeps the end unless its length runs past it, and is
 * credited the unused days of what was paid; paying it switches plan and
 * seats now. One company walks the story, so the tests run in order.
 */
describe('Billing upgrades (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E BU Aluminium';
  const adminEmail = 'e2e-bu-admin@test.local';
  const superEmail = 'e2e-bu-super@test.local';
  const password = 'TestPassword123!';
  const today = cairoDateOf(new Date());
  // The first paid period began 30 days ago (paid on that day, from Free).
  const paidOn = addDays(today, -30);

  let companyId: string;
  let superId: string;
  let superToken: string;
  let firstInvoice: BillingDocumentSummary;

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

  const quotation = (over: Partial<QuotationInput>): QuotationInput => ({
    purpose: 'upgrade',
    planKey: 'ultimate',
    extraSeats: 0,
    extraSeatPrice: 0,
    months: 3,
    startsOn: today,
    endsOn: periodEnd(today, 3),
    currency: 'EGP',
    fxRate: null,
    unitPrice: 20000,
    discountKind: null,
    discountValue: null,
    vatRate: 14,
    validUntil: addDays(today, 14),
    note: null,
    ...over,
  });
  const create = (over: Partial<QuotationInput>) =>
    request(server())
      .post(`/admin/companies/${companyId}/quotations`)
      .set(as())
      .send(quotation(over));
  const pay = (id: string, on = today) =>
    request(server())
      .post(`/admin/billing/documents/${id}/pay`)
      .set(as())
      .send({
        paidOn: on,
        amountReceived: 1000,
        method: 'bank_transfer',
        reference: `BU-${id.slice(0, 8)}`,
        note: 'E2E',
      });

  async function company() {
    const rows: Array<{ key: string; max_users: number; ends_at: Date }> =
      await controlPlane.query(
        `SELECT p.key, c.max_users, c.ends_at FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = $1`,
        [companyId],
      );
    return { ...rows[0], endsOn: cairoDateOf(rows[0].ends_at) };
  }

  it('quotes only new on Free, and pays it into a 3-month Pro period', async () => {
    expect(code(await create({ purpose: 'renewal' }).expect(409))).toBe(
      'purpose_not_allowed',
    );
    expect(code(await create({}).expect(409))).toBe('purpose_not_allowed');

    // Pro, 3 months, 10 % off; 2 extra seats at 500 each.
    const q = (
      await create({
        purpose: 'new',
        planKey: 'pro',
        extraSeats: 2,
        extraSeatPrice: 500,
        unitPrice: 18000,
        discountKind: 'percent',
        discountValue: 10,
      }).expect(201)
    ).body as BillingDocumentSummary;
    const proSeats = q.seats - 2;
    expect(q).toMatchObject({ purpose: 'new', extraSeats: 2, credit: [] });
    expect(q.totals).toMatchObject({
      subtotal: 19000,
      extraSeatsAmount: 1000,
      discountAmount: 1900,
      creditAmount: 0,
    });

    firstInvoice = (await pay(q.id, paidOn).expect(200))
      .body as BillingDocumentSummary;
    expect(firstInvoice.startsOn).toBe(paidOn);
    expect(await company()).toMatchObject({
      key: 'pro',
      max_users: proSeats + 2,
      endsOn: firstInvoice.endsOn,
    });
    expect(code(await create({ purpose: 'new' }).expect(409))).toBe(
      'purpose_not_allowed',
    );
  });

  it('refuses a downgrade and an upgrade that changes nothing (P16)', async () => {
    expect(code(await create({ planKey: 'individual' }).expect(400))).toBe(
      'upgrade_is_downgrade',
    );
    // Pro with fewer seats than now.
    expect(code(await create({ planKey: 'pro' }).expect(400))).toBe(
      'upgrade_is_downgrade',
    );
    // Pro, same seats, a length that ends inside the period.
    expect(
      code(
        await create({ planKey: 'pro', extraSeats: 2, months: 1 }).expect(400),
      ),
    ).toBe('upgrade_changes_nothing');
  });

  it('keeps the end and credits the unused days of what was paid (P11)', async () => {
    const q = (await create({ months: 1 }).expect(201))
      .body as BillingDocumentSummary;
    const expected = unusedCredit(
      [
        {
          number: firstInvoice.number,
          startsOn: firstInvoice.startsOn,
          endsOn: firstInvoice.endsOn,
          // What was paid for the period: 19,000 − 10 %.
          valueEgp: 17100,
        },
      ],
      today,
      firstInvoice.endsOn,
    );
    expect(q).toMatchObject({
      purpose: 'upgrade',
      startsOn: today,
      endsOn: firstInvoice.endsOn,
      credit: expected,
    });
    expect(q.totals.creditAmount).toBe(expected[0].amountEgp);
    expect(q.totals.total).toBe(
      Math.round((20000 - expected[0].amountEgp) * 1.14 * 100) / 100,
    );
  });

  it('starts today for the full length when it runs past the end', async () => {
    const q = (await create({ months: 12, unitPrice: 142560 }).expect(201))
      .body as BillingDocumentSummary;
    expect(q.startsOn).toBe(today);
    expect(q.endsOn).toBe(periodEnd(today, 12));
    expect(q.credit).toHaveLength(1);
  });

  it('pays an upgrade: plan and seats now, the quoted end kept', async () => {
    const q = (
      await create({ months: 1, extraSeats: 1, extraSeatPrice: 900 }).expect(
        201,
      )
    ).body as BillingDocumentSummary;
    const invoice = (await pay(q.id).expect(200))
      .body as BillingDocumentSummary;
    expect(invoice).toMatchObject({
      purpose: 'upgrade',
      startsOn: today,
      endsOn: firstInvoice.endsOn,
      credit: q.credit,
    });
    expect(await company()).toMatchObject({
      key: 'ultimate',
      max_users: q.seats,
      endsOn: firstInvoice.endsOn,
    });
  });

  it('gives no credit for seats added to the same plan and end (P15)', async () => {
    const q = (
      await create({
        months: 1,
        extraSeats: 2,
        extraSeatPrice: 900,
        unitPrice: 0,
      }).expect(201)
    ).body as BillingDocumentSummary;
    expect(q.credit).toEqual([]);
    expect(q.totals.total).toBe(Math.round(1800 * 1.14 * 100) / 100);
  });

  it('renews from the day after the end', async () => {
    const q = (
      await create({
        purpose: 'renewal',
        startsOn: addDays(firstInvoice.endsOn, 1),
        endsOn: periodEnd(addDays(firstInvoice.endsOn, 1), 3),
      }).expect(201)
    ).body as BillingDocumentSummary;
    expect(q).toMatchObject({ purpose: 'renewal', credit: [] });
  });
});
