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
} from '@repo/types/billing-documents';
import type { BillingTodo } from '@repo/types/billing-todo';
import { addDays, cairoDateOf } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Billing › To-do (docs/payment_cycle_planing.md §8, task 7.2): a sent
 * quotation waits until paid; a paid plan ending within 30 days shows until
 * a renewal or upgrade quotation is sent; a trial ending within 7 days; a
 * payment whose amount differed. Other suites' companies may show too, so
 * this one only looks for its own.
 */
describe('Billing to-do (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const password = 'TestPassword123!';
  const superEmail = 'e2e-td-super@test.local';
  const today = cairoDateOf(new Date());
  const pdfBase64 = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');
  const ids: Record<'free' | 'ending' | 'trial', string> = {
    free: '',
    ending: '',
    trial: '',
  };
  let superId: string;
  let superToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provision = app.get(TenantProvisioningService);

    for (const key of ['free', 'ending', 'trial'] as const) {
      const created = await provision.provision({
        name: `E2E TD ${key} Glass`,
        planKey: key === 'free' ? undefined : 'pro',
        admin: { email: `e2e-td-${key}@test.local`, password },
      });
      ids[key] = created.company.id;
    }
    await controlPlane.query(
      `UPDATE companies SET ends_at = now() + interval '10 days', is_trial = false WHERE id = $1`,
      [ids.ending],
    );
    await controlPlane.query(
      `UPDATE companies SET ends_at = now() + interval '3 days', is_trial = true WHERE id = $1`,
      [ids.trial],
    );

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
      for (const id of Object.values(ids)) {
        const schemas: Array<{ schema_name: string }> =
          await controlPlane.query(
            `SELECT schema_name FROM companies WHERE id = $1`,
            [id],
          );
        await controlPlane.query(
          `DROP SCHEMA IF EXISTS "${schemas[0]?.schema_name ?? ''}" CASCADE`,
        );
        for (const sql of [
          `DELETE FROM admin_audit_log WHERE target_id = $1`,
          `DELETE FROM billing WHERE company_id = $1`,
          `DELETE FROM billing_documents WHERE company_id = $1 AND kind = 'invoice'`,
          `DELETE FROM billing_documents WHERE company_id = $1`,
          `DELETE FROM users WHERE company_id = $1`,
          `DELETE FROM companies WHERE id = $1`,
        ]) {
          await controlPlane.query(sql, [id]);
        }
      }
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id = $1`,
        [superId],
      );
      await controlPlane.query(`DELETE FROM users WHERE id = $1`, [superId]);
    } finally {
      await app.close();
    }
  });

  const as = () => ({ Authorization: `Bearer ${superToken}` });
  const server = () => app.getHttpServer();
  const todo = async () =>
    (await request(server()).get('/admin/billing/todo').set(as()).expect(200))
      .body as BillingTodo;

  async function sentQuotation(
    companyId: string,
    purpose: QuotationInput['purpose'],
  ): Promise<BillingDocumentSummary> {
    const q = (
      await request(server())
        .post(`/admin/companies/${companyId}/quotations`)
        .set(as())
        .send({
          purpose,
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
        } satisfies QuotationInput)
        .expect(201)
    ).body as BillingDocumentSummary;
    await request(server())
      .post(`/admin/billing/documents/${q.id}/send`)
      .set(as())
      .send({
        to: ['client@test.local'],
        subject: 'Q',
        copyMe: false,
        pdfBase64,
      })
      .expect(200);
    return q;
  }

  it('lists what to act on, each kind once', async () => {
    const quote = await sentQuotation(ids.free, 'new');
    const list = await todo();
    expect(list.waiting.find((w) => w.documentId === quote.id)).toMatchObject({
      companyId: ids.free,
      total: 6840,
      expiresIn: 14,
    });
    expect(
      list.endingNoQuotation.find((e) => e.companyId === ids.ending),
    ).toMatchObject({ plan: { key: 'pro' }, daysLeft: 10 });
    expect(
      list.trialsEnding.find((t) => t.companyId === ids.trial),
    ).toMatchObject({
      daysLeft: 3,
    });
    // Each list holds only its own kind.
    expect(list.endingNoQuotation.some((e) => e.companyId === ids.trial)).toBe(
      false,
    );
    expect(list.trialsEnding.some((t) => t.companyId === ids.ending)).toBe(
      false,
    );
  });

  it('drops an ending plan once its renewal quotation is sent', async () => {
    await sentQuotation(ids.ending, 'renewal');
    const list = await todo();
    expect(list.endingNoQuotation.some((e) => e.companyId === ids.ending)).toBe(
      false,
    );
    expect(list.waiting.some((w) => w.companyId === ids.ending)).toBe(true);
  });

  it('moves a paid quotation with a different amount to the differences', async () => {
    const [waiting] = (await todo()).waiting.filter(
      (w) => w.companyId === ids.free,
    );
    await request(server())
      .post(`/admin/billing/documents/${waiting.documentId}/pay`)
      .set(as())
      .send({
        paidOn: today,
        amountReceived: 6800,
        method: 'bank_transfer',
        reference: `TD-${waiting.documentId.slice(0, 8)}`,
        note: 'Bank fee',
      })
      .expect(200);
    const list = await todo();
    expect(list.waiting.some((w) => w.companyId === ids.free)).toBe(false);
    expect(
      list.differences.find((d) => d.companyId === ids.free),
    ).toMatchObject({
      total: 6840,
      amountReceived: 6800,
      note: 'Bank fee',
      paidOn: today,
    });
  });
});
