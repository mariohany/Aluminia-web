import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import { cairoDateOf } from '@repo/types/subscriptions';
import { AppModule } from './../src/app.module';
import { MAILER } from './../src/mail/mailer';
import { LogMailer } from './../src/mail/log-mailer';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';
import { DailyBillingService } from './../src/modules/billing/daily-billing.service';

/**
 * The daily billing job (docs/payment_cycle_planing.md P17, P28): drops
 * plans past their end to Free and sends the due reminder to the client
 * admins with the super admins in copy, once per Cairo day; a second run
 * the same day does nothing, a failed one runs again without resending.
 * It walks every company, so it runs in band (CI does).
 */
describe('Daily billing job (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let mailer: LogMailer;
  let job: DailyBillingService;

  const password = 'TestPassword123!';
  const endingAdmin = 'e2e-dj-ending@test.local';
  const endedAdmin = 'e2e-dj-ended@test.local';
  const superEmail = 'e2e-dj-super@test.local';
  const today = cairoDateOf(new Date());
  const companyIds: string[] = [];
  let superId: string;

  async function company(name: string, admin: string, endsIn: string) {
    const created = await app.get(TenantProvisioningService).provision({
      name,
      planKey: 'pro',
      admin: { email: admin, password },
    });
    companyIds.push(created.company.id);
    await controlPlane.query(
      `UPDATE companies SET ends_at = now() + $2::interval, is_trial = false WHERE id = $1`,
      [created.company.id, endsIn],
    );
    return created.company.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());
    mailer = app.get<LogMailer>(MAILER);
    job = app.get(DailyBillingService);

    const hash = await app.get(PasswordService).hash(password);
    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [superEmail, hash, UserRole.SUPER_ADMIN],
    );
    superId = rows[0].id;
    await controlPlane.query(
      `DELETE FROM billing_job_runs WHERE run_date = $1`,
      [today],
    );
  });

  afterAll(async () => {
    try {
      await controlPlane.query(
        `DELETE FROM billing_job_runs WHERE run_date = $1`,
        [today],
      );
      for (const id of companyIds) {
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
          `DELETE FROM billing_notices WHERE company_id = $1`,
          `DELETE FROM billing WHERE company_id = $1`,
          `DELETE FROM users WHERE company_id = $1`,
          `DELETE FROM companies WHERE id = $1`,
        ]) {
          await controlPlane.query(sql, [id]);
        }
      }
      await controlPlane.query(`DELETE FROM users WHERE id = $1`, [superId]);
    } finally {
      await app.close();
    }
  });

  const mailsTo = (email: string) =>
    mailer.sent.filter((m) => m.to.includes(email));

  it('drops ended plans and sends the due reminder, super admins in copy', async () => {
    // 4 days left (the 5-day stage) and a plan that ended an hour ago.
    await company('E2E DJ Ending Glass', endingAdmin, '4 days');
    const ended = await company('E2E DJ Ended Glass', endedAdmin, '-1 hour');

    const result = await job.run(new Date());
    expect(result).toMatchObject({ ran: true, date: today, failed: [] });
    if (!result.ran) return;
    expect(result.dropped).toBeGreaterThanOrEqual(1);
    expect(result.reminded).toBeGreaterThanOrEqual(1);

    const plan: Array<{ key: string }> = await controlPlane.query(
      `SELECT p.key FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = $1`,
      [ended],
    );
    expect(plan[0].key).toBe('free');

    const mails = mailsTo(endingAdmin);
    expect(mails).toHaveLength(1);
    expect(mails[0].bcc).toContain(superEmail);
    expect(mailsTo(endedAdmin)).toHaveLength(0);
  });

  it('does nothing on a second run the same day', async () => {
    expect(await job.run(new Date())).toEqual({ ran: false, date: today });
    expect(mailsTo(endingAdmin)).toHaveLength(1);
  });

  it('runs a failed day again without sending a reminder twice', async () => {
    await controlPlane.query(
      `UPDATE billing_job_runs SET error = 'boom' WHERE run_date = $1`,
      [today],
    );
    const again = await job.run(new Date());
    expect(again.ran).toBe(true);
    expect(mailsTo(endingAdmin)).toHaveLength(1);
    const runs: Array<{ error: string | null; finished_at: Date | null }> =
      await controlPlane.query(
        `SELECT error, finished_at FROM billing_job_runs WHERE run_date = $1`,
        [today],
      );
    expect(runs[0]).toMatchObject({ error: null });
    expect(runs[0].finished_at).not.toBeNull();
  });
});
