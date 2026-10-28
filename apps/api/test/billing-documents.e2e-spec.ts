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
  type QuotationInput,
  type TransactionsPage,
} from '@repo/types/billing-documents';
import { addDays, cairoDateOf, daysBetween } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';
import { FX_SOURCE, FxService } from './../src/modules/billing/fx.service';

/**
 * Quotations, invoices and Transactions (docs/subscriptions_planing.md §4d,
 * B4–B8, B21, Q3): totals rebuilt by the API, QUO / INV numbers without
 * gaps under concurrent pays, the renewal start (B8), expired quotations
 * refused, and the Transactions cursor. One company walks the story, so
 * the tests run in order. The FX API is a fake.
 */
describe('Billing documents (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E BD Aluminium';
  const adminEmail = 'e2e-bd-admin@test.local';
  const userEmail = 'e2e-bd-user@test.local';
  const superEmail = 'e2e-bd-super@test.local';
  const password = 'TestPassword123!';
  const today = cairoDateOf(new Date());

  const fx = { calls: 0, fail: false };
  let companyId: string;
  let superId: string;
  let superToken: string;
  let adminToken: string;
  let todaysRates: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FX_SOURCE)
      .useValue({
        perEgp: () => {
          fx.calls++;
          if (fx.fail) return Promise.reject(new Error('down'));
          return Promise.resolve({
            SAR: 0.08,
            AED: 0.075,
            USD: 0.02,
            EUR: 0.0185,
          });
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());
    const passwords = app.get(PasswordService);

    // Starts on Free (step 2 default).
    const company = await app.get(TenantProvisioningService).provision({
      name: companyName,
      admin: { email: adminEmail, password },
    });
    companyId = company.company.id;
    const hash = await passwords.hash(password);
    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [superEmail, hash, UserRole.SUPER_ADMIN],
    );
    superId = rows[0].id;
    // A second user, deactivated by the Free plan: a paid plan brings it back.
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status, plan_deactivated)
       VALUES ($1, $2, $3, $4, 'inactive', true)`,
      [userEmail, hash, UserRole.USER, companyId],
    );
    await controlPlane.query(
      `INSERT INTO billing_profile (id, legal_name_en, legal_name_ar, address_en, address_ar,
         tax_id, commercial_register, billing_email, bank_account)
       VALUES (1, 'Aluminia Software LLC', 'ألومينيا', 'Cairo', 'القاهرة', '512', '184', 'billing@aluminia.test', 'CIB')
       ON CONFLICT (id) DO NOTHING`,
    );
    todaysRates = await controlPlane.query(
      `SELECT * FROM fx_rates WHERE date = $1`,
      [today],
    );
    await controlPlane.query(`DELETE FROM fx_rates WHERE date = $1`, [today]);

    superToken = await loginAs(superEmail);
    adminToken = await loginAs(adminEmail);
  });

  afterAll(async () => {
    try {
      await controlPlane.query(`DELETE FROM fx_rates WHERE date = $1`, [today]);
      for (const row of todaysRates ?? []) {
        await controlPlane.query(
          `INSERT INTO fx_rates (date, currency, egp_per_unit, fetched_at) VALUES ($1, $2, $3, $4)`,
          [row.date, row.currency, row.egp_per_unit, row.fetched_at],
        );
      }
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
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
        companyId,
      ]);
      await controlPlane.query(
        `DELETE FROM billing_documents WHERE company_id = $1 AND kind = 'invoice'`,
        [companyId],
      );
      await controlPlane.query(
        `DELETE FROM billing_documents WHERE company_id = $1`,
        [companyId],
      );
      await controlPlane.query(
        `DELETE FROM users WHERE company_id = $1 OR id = $2`,
        [companyId, superId],
      );
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
  const server = () => app.getHttpServer();
  const code = (res: { body: unknown }) => (res.body as { code?: string }).code;

  const quotation = (over: Partial<QuotationInput> = {}): QuotationInput => ({
    planKey: 'pro',
    seats: 5,
    months: 12,
    startsOn: today,
    endsOn: periodEnd(today, 12),
    currency: 'EGP',
    fxRate: null,
    unitPrice: 6000,
    discountKind: 'percent',
    discountValue: 10,
    vatRate: 14,
    validUntil: addDays(today, 14),
    note: null,
    ...over,
  });

  const create = (over: Partial<QuotationInput> = {}) =>
    request(server())
      .post(`/admin/companies/${companyId}/quotations`)
      .set(as(superToken))
      .send(quotation(over));

  const pay = (id: string, paidOn = today) =>
    request(server())
      .post(`/admin/billing/documents/${id}/pay`)
      .set(as(superToken))
      .send({
        paidOn,
        amountReceived: 6156,
        method: 'bank_transfer',
        reference: 'SNB-55120931',
      });

  async function company() {
    const rows: Array<{ key: string; max_users: number; ends_at: Date }> =
      await controlPlane.query(
        `SELECT p.key, c.max_users, c.ends_at FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = $1`,
        [companyId],
      );
    return rows[0];
  }

  it('is for the super admin only', async () => {
    await request(server())
      .get('/admin/billing/transactions')
      .set(as(adminToken))
      .expect(403);
  });

  it('quotes a rate once a day, and falls back to the last known one (B6)', async () => {
    const first = await request(server())
      .get('/admin/billing/fx?currency=SAR')
      .set(as(superToken))
      .expect(200);
    expect(first.body).toEqual({
      currency: 'SAR',
      date: today,
      egpPerUnit: 12.5,
      source: 'today',
    });
    await request(server())
      .get('/admin/billing/fx?currency=USD')
      .set(as(superToken))
      .expect(200);
    expect(fx.calls).toBe(1);

    fx.fail = true;
    const later = await app
      .get(FxService)
      .quote('USD', new Date(Date.now() + 3 * 86_400_000));
    expect(later).toMatchObject({ egpPerUnit: 50, source: 'last_known' });
    fx.fail = false;
  });

  it('rebuilds the totals itself and numbers the draft (§4d, B17)', async () => {
    const res = await create().expect(201);
    const doc = res.body as BillingDocumentSummary;
    expect(doc.number).toMatch(
      new RegExp(`^QUO-${today.slice(0, 4)}-\\d{4,}$`),
    );
    expect(doc.status).toBe('draft');
    expect(doc.totals).toEqual({
      subtotal: 6000,
      discountAmount: 600,
      vatAmount: 756,
      total: 6156,
      totalEgp: 6156,
    });

    // A rate only for another currency than EGP.
    await create({ fxRate: 12.5 }).expect(400);
    await create({ currency: 'SAR' }).expect(400);
    const sar = await create({
      currency: 'SAR',
      fxRate: 12.5,
      unitPrice: 480,
    }).expect(201);
    expect((sar.body as BillingDocumentSummary).totals.totalEgp).toBe(
      Math.round(492.48 * 12.5 * 100) / 100,
    );

    // A draft can be edited, its number kept.
    const edited = await request(server())
      .patch(`/admin/billing/documents/${doc.id}`)
      .set(as(superToken))
      .send(quotation({ discountKind: null, discountValue: null }))
      .expect(200);
    expect((edited.body as BillingDocumentSummary).number).toBe(doc.number);
    expect((edited.body as BillingDocumentSummary).totals.total).toBe(6840);
  });

  it('refuses a quotation past its valid-until day, and fewer seats than users (Q3, B3)', async () => {
    const old = await create({ validUntil: addDays(today, -1) }).expect(201);
    expect((old.body as BillingDocumentSummary).status).toBe('expired');
    expect(
      code(await pay((old.body as BillingDocumentSummary).id).expect(409)),
    ).toBe('quotation_expired');

    const small = await create({ seats: 1 }).expect(201);
    expect(
      code(await pay((small.body as BillingDocumentSummary).id).expect(400)),
    ).toBe('seats_below_users');
  });

  it('turns a paid quotation into an invoice and renews from the payment day on Free (B4, B8)', async () => {
    const q = (await create().expect(201)).body as BillingDocumentSummary;
    const paidOn = addDays(today, -2);
    const res = await pay(q.id, paidOn).expect(200);
    const invoice = res.body as BillingDocumentSummary;
    expect(invoice).toMatchObject({
      kind: 'invoice',
      status: 'paid',
      quotationId: q.id,
      startsOn: paidOn,
      // The quotation's length, moved to the payment day.
      endsOn: addDays(paidOn, daysBetween(today, periodEnd(today, 12))),
      paymentReference: 'SNB-55120931',
    });
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{4,}$/);
    // What the PDF prints (§5): its quotation's number and the snapshots.
    expect(invoice.quotationNumber).toBe(q.number);
    expect(invoice.seller.bankAccount).toBeTruthy();
    expect(invoice.buyer.nameEn).toBe(companyName);
    expect((await company()).key).toBe('pro');
    expect((await company()).max_users).toBe(5);

    const user: Array<{ status: string; plan_deactivated: boolean }> =
      await controlPlane.query(
        `SELECT status, plan_deactivated FROM users WHERE email = $1`,
        [userEmail],
      );
    expect(user[0]).toEqual({ status: 'active', plan_deactivated: false });

    // Paid once: no edit, no second payment, no void.
    await request(server())
      .patch(`/admin/billing/documents/${q.id}`)
      .set(as(superToken))
      .send(quotation())
      .expect(409);
    await pay(q.id).expect(409);
    const history: Array<{ reason: string; document_id: string }> =
      await controlPlane.query(
        `SELECT reason, document_id FROM billing WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [companyId],
      );
    expect(history[0]).toEqual({ reason: 'paid', document_id: invoice.id });
  });

  it('renews an active plan from the day after its end (B8)', async () => {
    const endBefore = cairoDateOf((await company()).ends_at);
    const q = (
      await create({
        months: 1,
        endsOn: periodEnd(today, 1),
        unitPrice: 600,
      }).expect(201)
    ).body as BillingDocumentSummary;
    const invoice = (await pay(q.id).expect(200))
      .body as BillingDocumentSummary;
    expect(invoice.startsOn).toBe(addDays(endBefore, 1));
    expect(cairoDateOf((await company()).ends_at)).toBe(invoice.endsOn);
  });

  it('gives concurrent pays consecutive invoice numbers, no gaps (B17)', async () => {
    const quotes = await Promise.all(
      [1, 2, 3].map(
        async () =>
          ((await create().expect(201)).body as BillingDocumentSummary).id,
      ),
    );
    const results = await Promise.all(quotes.map((id) => pay(id)));
    const numbers = results
      .map((r) => {
        expect(r.status).toBe(200);
        return Number((r.body as BillingDocumentSummary).number.split('-')[2]);
      })
      .sort((a, b) => a - b);
    expect(numbers[1] - numbers[0]).toBe(1);
    expect(numbers[2] - numbers[1]).toBe(1);
  });

  it('voids an unpaid quotation only', async () => {
    const q = (await create().expect(201)).body as BillingDocumentSummary;
    const res = await request(server())
      .post(`/admin/billing/documents/${q.id}/void`)
      .set(as(superToken))
      .expect(200);
    expect((res.body as BillingDocumentSummary).status).toBe('void');
    await pay(q.id).expect(409);
  });

  it('pages Transactions newest first with a cursor, filters and exports (B21)', async () => {
    const all = (
      await request(server())
        .get(`/admin/companies/${companyId}/documents`)
        .set(as(superToken))
        .expect(200)
    ).body as BillingDocumentSummary[];

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await request(server())
        .get('/admin/billing/transactions')
        .query({ companyId, limit: 3, ...(cursor ? { cursor } : {}) })
        .set(as(superToken))
        .expect(200);
      const page = res.body as TransactionsPage;
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.map((d) => d.id));

    const expired = (
      await request(server())
        .get('/admin/billing/transactions')
        .query({ companyId, status: 'expired' })
        .set(as(superToken))
        .expect(200)
    ).body as TransactionsPage;
    expect(expired.items.map((d) => d.status)).toEqual(['expired']);

    const invoices = (
      await request(server())
        .get('/admin/billing/transactions')
        .query({ companyId, kind: 'invoice', search: 'INV-' })
        .set(as(superToken))
        .expect(200)
    ).body as TransactionsPage;
    expect(invoices.items).toHaveLength(5);

    const csv = await request(server())
      .get('/admin/billing/transactions.csv')
      .query({ companyId })
      .set(as(superToken))
      .expect(200);
    expect(csv.text.split('\r\n')[0]).toContain('Number,Kind,Status');
    expect(csv.text).toContain(all[0].number);

    const summary = await request(server())
      .get('/admin/billing/transactions/summary')
      .set(as(superToken))
      .expect(200);
    expect((summary.body as { draftCount: number }).draftCount).toBeGreaterThan(
      0,
    );
  });
});
