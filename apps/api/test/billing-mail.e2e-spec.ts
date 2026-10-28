import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { CompanyAlerts } from '@repo/types/alerts';
import {
  periodEnd,
  type BillingDocumentSummary,
} from '@repo/types/billing-documents';
import { addDays, cairoDateOf } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';
import { MAILER } from './../src/mail/mailer';
import { LogMailer } from './../src/mail/log-mailer';

/**
 * Email (docs/subscriptions_planing.md §6, B15, B16, Q1, Q2): a quotation
 * sent with the PDF the browser drew, every attempt recorded, a failure
 * answered and never retried; and the warning emails sent by the alerts
 * call once per stage, however often and by whomever the app is opened.
 * No BREVO_API_KEY in tests, so the mailer is the LogMailer.
 */
describe('Billing email (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let mailer: LogMailer;

  const companyName = 'E2E BM Aluminium';
  const adminEmail = 'e2e-bm-admin@test.local';
  const userEmail = 'e2e-bm-user@test.local';
  const superEmail = 'e2e-bm-super@test.local';
  const password = 'TestPassword123!';
  const today = cairoDateOf(new Date());
  // "%PDF-1.4" and a little more.
  const pdfBase64 = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

  let companyId: string;
  let superId: string;
  let superToken: string;
  let adminToken: string;
  let userToken: string;

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
      planKey: 'pro',
      admin: { email: adminEmail, password },
    });
    companyId = company.company.id;
    const hash = await app.get(PasswordService).hash(password);
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [userEmail, hash, UserRole.USER, companyId],
    );
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
    superToken = await loginAs(superEmail);
    adminToken = await loginAs(adminEmail);
    userToken = await loginAs(userEmail);
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
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
        companyId,
      ]);
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
  const mailsTo = (email: string) =>
    mailer.sent.filter((m) => m.to.includes(email));

  async function alerts(token: string): Promise<CompanyAlerts> {
    const res = await request(server())
      .get('/company/alerts')
      .set(as(token))
      .expect(200);
    return res.body as CompanyAlerts;
  }

  const endsIn = (days: number) =>
    controlPlane.query(`UPDATE companies SET ends_at = $2 WHERE id = $1`, [
      companyId,
      new Date(Date.now() + days * 86_400_000),
    ]);

  it('shows nothing and sends nothing far from the end', async () => {
    await endsIn(90);
    expect((await alerts(userToken)).ending).toBeNull();
    expect(mailsTo(adminEmail)).toHaveLength(0);
  });

  it('warns once per stage, whoever opens the app and however often (B15, Q2)', async () => {
    await endsIn(10);
    const [forUser, forAdmin] = await Promise.all([
      alerts(userToken),
      alerts(adminToken),
      alerts(userToken),
    ]);
    expect(forUser.ending).toMatchObject({
      kind: 'ending',
      tone: 'yellow',
      canRenew: false,
    });
    expect(forAdmin.ending?.canRenew).toBe(true);
    await alerts(adminToken);
    const first = mailsTo(adminEmail);
    expect(first).toHaveLength(1);
    expect(first[0].subject).toContain('ends in');
    // Only company admins are emailed.
    expect(mailsTo(userEmail)).toHaveLength(0);

    // The next stage, once.
    await endsIn(3);
    expect((await alerts(userToken)).ending?.tone).toBe('red');
    await alerts(adminToken);
    expect(mailsTo(adminEmail)).toHaveLength(2);
  });

  it('emails a quotation with the drawn PDF, recording the send (B16, Q1)', async () => {
    const quotation = (
      await request(server())
        .post(`/admin/companies/${companyId}/quotations`)
        .set(as(superToken))
        .send({
          planKey: 'pro',
          seats: 5,
          months: 1,
          startsOn: today,
          endsOn: periodEnd(today, 1),
          currency: 'EGP',
          fxRate: null,
          unitPrice: 500,
          discountKind: null,
          discountValue: null,
          vatRate: 14,
          validUntil: addDays(today, 14),
          note: null,
        })
        .expect(201)
    ).body as BillingDocumentSummary;

    const defaults = await request(server())
      .get(`/admin/billing/documents/${quotation.id}/send-defaults`)
      .set(as(superToken))
      .expect(200);
    const subject = (defaults.body as { subject: string }).subject;
    expect(subject).toContain(quotation.number);

    await request(server())
      .post(`/admin/billing/documents/${quotation.id}/send`)
      .set(as(superToken))
      .send({
        to: [adminEmail],
        subject,
        copyMe: true,
        pdfBase64: Buffer.from('not a pdf').toString('base64'),
      })
      .expect(400);

    const before = mailer.sent.length;
    const res = await request(server())
      .post(`/admin/billing/documents/${quotation.id}/send`)
      .set(as(superToken))
      .send({
        to: [adminEmail, 'ACCOUNTS@test.local'],
        subject,
        copyMe: true,
        pdfBase64,
      })
      .expect(200);
    const sent = res.body as BillingDocumentSummary;
    expect(sent.status).toBe('sent');
    expect(sent.lastSent?.to).toEqual([adminEmail, 'accounts@test.local']);
    const mail = mailer.sent[before];
    expect(mail.to).toEqual([adminEmail, 'accounts@test.local']);
    expect(mail.bcc).toEqual([superEmail]);
    expect(mail.attachments?.[0]).toMatchObject({
      name: `${quotation.number}.pdf`,
      contentBase64: pdfBase64,
    });

    // A failure is answered and recorded, never retried.
    jest
      .spyOn(mailer, 'send')
      .mockRejectedValueOnce(new Error('daily limit reached'));
    const failed = await request(server())
      .post(`/admin/billing/documents/${quotation.id}/send`)
      .set(as(superToken))
      .send({ to: [adminEmail], subject, copyMe: false, pdfBase64 })
      .expect(502);
    expect((failed.body as { code?: string }).code).toBe('mail_failed');
    const sends: Array<{ error: string | null }> = await controlPlane.query(
      `SELECT error FROM billing_sends WHERE document_id = $1 ORDER BY sent_at`,
      [quotation.id],
    );
    expect(sends.map((s) => s.error)).toEqual([null, 'daily limit reached']);
  });
});
