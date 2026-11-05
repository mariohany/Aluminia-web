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
  type UndoPaymentResult,
} from '@repo/types/billing-documents';
import { addDays, cairoDateOf } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { MAILER } from './../src/mail/mailer';
import { LogMailer } from './../src/mail/log-mailer';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Same-day undo (docs/payment_cycle_planing.md P22, P23): only the latest
 * invoice, only on the day it was recorded. The invoice goes and its
 * number is reused, the quotation is payable again, the company and the
 * users the payment brought back are as before, the history says why,
 * and the client is told the invoice was cancelled.
 *
 * Invoice numbers are platform-wide: an invoice another suite issues
 * between a pay and its undo here would make it "not the latest". Run in
 * band (CI does).
 */
describe('Billing undo (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let mailer: LogMailer;

  const companyName = 'E2E BX Aluminium';
  const adminEmail = 'e2e-bx-admin@test.local';
  const userEmail = 'e2e-bx-user@test.local';
  const superEmail = 'e2e-bx-super@test.local';
  const password = 'TestPassword123!';
  const today = cairoDateOf(new Date());
  const pdfBase64 = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

  let companyId: string;
  let superId: string;
  let superToken: string;
  let quotation: BillingDocumentSummary;
  let firstNumber: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());
    mailer = app.get<LogMailer>(MAILER);

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
  const pay = (id: string, reference = 'BX-1') =>
    request(server())
      .post(`/admin/billing/documents/${id}/pay`)
      .set(as())
      .send({
        paidOn: today,
        amountReceived: 6840,
        method: 'bank_transfer',
        reference,
      });
  const undo = (id: string, reason = 'Recorded on the wrong company') =>
    request(server())
      .post(`/admin/billing/documents/${id}/undo`)
      .set(as())
      .send({ reason });

  async function state() {
    const rows: Array<{
      key: string;
      max_users: number;
      ends_at: Date | null;
      status: string;
      plan_deactivated: boolean;
    }> = await controlPlane.query(
      `SELECT p.key, c.max_users, c.ends_at, u.status, u.plan_deactivated
       FROM companies c JOIN plans p ON p.id = c.plan_id JOIN users u ON u.email = $2
       WHERE c.id = $1`,
      [companyId, userEmail],
    );
    return rows[0];
  }

  it('undoes today’s latest payment and puts everything back', async () => {
    quotation = (await create().expect(201)).body as BillingDocumentSummary;
    await request(server())
      .post(`/admin/billing/documents/${quotation.id}/send`)
      .set(as())
      .send({
        to: [adminEmail],
        subject: 'Quotation',
        copyMe: false,
        pdfBase64,
      })
      .expect(200);

    const invoice = (await pay(quotation.id).expect(200))
      .body as BillingDocumentSummary;
    firstNumber = invoice.number;
    expect(invoice.canUndo).toBe(true);
    expect(await state()).toMatchObject({ key: 'pro', status: 'active' });

    await undo(invoice.id, '  ').expect(400);
    const res = (await undo(invoice.id).expect(200)).body as UndoPaymentResult;
    expect(res).toMatchObject({ emailed: true, to: [adminEmail] });
    // Sent before the payment, so sent again: payable.
    expect(res.quotation).toMatchObject({ id: quotation.id, status: 'sent' });

    expect(await state()).toEqual({
      key: 'free',
      max_users: 1,
      ends_at: null,
      status: 'inactive',
      plan_deactivated: true,
    });
    await request(server())
      .get(`/admin/billing/documents/${invoice.id}`)
      .set(as())
      .expect(404);

    const history: Array<{ reason: string; notes: string }> =
      await controlPlane.query(
        `SELECT reason, notes FROM billing WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [companyId],
      );
    expect(history[0].reason).toBe('payment_undone');
    expect(history[0].notes).toContain(invoice.number);
    expect(history[0].notes).toContain('Recorded on the wrong company');

    const mail = mailer.sent.at(-1)!;
    expect(mail.to).toEqual([adminEmail]);
    expect(mail.subject).toBe(`Invoice ${invoice.number} has been cancelled`);
    expect(mail.attachments ?? []).toHaveLength(0);
  });

  it('reuses the number and the reference on the next payment', async () => {
    const again = (await pay(quotation.id).expect(200))
      .body as BillingDocumentSummary;
    expect(again.number).toBe(firstNumber);
    expect(again.paymentReference).toBe('BX-1');
  });

  it('refuses an invoice that is no longer the latest, or not from today', async () => {
    const [older] = (
      await request(server())
        .get(`/admin/companies/${companyId}/documents`)
        .set(as())
        .expect(200)
    ).body as BillingDocumentSummary[];
    expect(older.kind).toBe('invoice');

    const renewal = (await create({ purpose: 'renewal' }).expect(201))
      .body as BillingDocumentSummary;
    const latest = (await pay(renewal.id, 'BX-2').expect(200))
      .body as BillingDocumentSummary;
    expect(code(await undo(older.id).expect(409))).toBe('undo_not_allowed');

    await controlPlane.query(
      `UPDATE billing_documents SET payment_recorded_at = now() - interval '2 days' WHERE id = $1`,
      [latest.id],
    );
    expect(code(await undo(latest.id).expect(409))).toBe('undo_not_allowed');
  });
});
