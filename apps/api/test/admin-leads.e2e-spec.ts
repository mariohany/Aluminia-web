import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { DeleteLeadsResponse, LeadSummary } from '@repo/types/leads';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * The super admin's side of leads: listing (newest first), marking a
 * lead as called, and deleting one or several by id (the dashboard's
 * row-checkbox selection — there is no "delete everything" route).
 * Every route here requires SUPER_ADMIN — a company admin/user has no
 * reason to see anonymous quote requests — so that boundary gets
 * checked alongside the CRUD behaviour itself.
 */
describe('Admin leads (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E AL Aluminium';
  const companyAdminEmail = 'e2e-al-admin@test.local';
  const superAdminEmail = 'e2e-al-super@test.local';
  const password = 'TestPassword123!';

  let companyId: string;
  let companyAdminToken: string;
  let superToken: string;

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

    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [
        superAdminEmail,
        await passwordService.hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );

    companyAdminToken = await loginAs(companyAdminEmail);
    superToken = await loginAs(superAdminEmail);
  });

  afterEach(async () => {
    await controlPlane.query(`DELETE FROM leads`);
  });

  afterAll(async () => {
    try {
      await controlPlane.query(
        `DROP SCHEMA IF EXISTS "${await companySchema()}" CASCADE`,
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

  async function companySchema(): Promise<string> {
    const rows: Array<{ schema_name: string }> = await controlPlane.query(
      `SELECT schema_name FROM companies WHERE id = $1`,
      [companyId],
    );
    return rows[0]?.schema_name ?? '';
  }

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  // Inserted directly rather than through POST /leads/quote-requests:
  // that route is rate-limited to 5 per 10 minutes per caller
  // (leads.module.ts), and this suite seeds more than that across its
  // tests. The throttle itself is covered by leads.e2e-spec.ts; this
  // file is about the admin surface reading and acting on rows that
  // already exist.
  async function seedLead(companyNameValue: string): Promise<string> {
    const rows: Array<{ id: string }> = await controlPlane.query(
      `INSERT INTO leads (company_name, requester_name, phone) VALUES ($1, $2, $3) RETURNING id`,
      [companyNameValue, 'Requester', '+20 100 000 0000'],
    );
    return rows[0].id;
  }

  it('refuses a company admin every route on this surface', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${companyAdminToken}` };

    await request(server).get('/admin/leads').set(auth).expect(403);
    // RolesGuard runs before body validation, so this 403s on role
    // before the empty-ids array would 400 — the boundary that
    // matters here is "not a super admin," not "not a valid request."
    await request(server)
      .delete('/admin/leads')
      .set(auth)
      .send({ ids: [] })
      .expect(403);
  });

  it('lists newest first and reflects the called state', async () => {
    const firstId = await seedLead('E2E AL Older Lead');
    // Postgres timestamptz has microsecond resolution; a real gap
    // guarantees distinct createdAt values instead of relying on
    // insertion order, which is what "newest first" actually tests.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondId = await seedLead('E2E AL Newer Lead');

    const list = await request(app.getHttpServer())
      .get('/admin/leads')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);

    const body = list.body as LeadSummary[];
    const ids = body.map((lead) => lead.id);
    expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));
    expect(body.every((lead) => lead.contactedAt === null)).toBe(true);

    const contacted = await request(app.getHttpServer())
      .post(`/admin/leads/${firstId}/contacted`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    expect((contacted.body as LeadSummary).contactedAt).not.toBeNull();

    const listAfter = await request(app.getHttpServer())
      .get('/admin/leads')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    const updated = (listAfter.body as LeadSummary[]).find(
      (lead) => lead.id === firstId,
    );
    expect(updated?.contactedAt).not.toBeNull();
  });

  it('404s marking or deleting a lead that does not exist', async () => {
    const missingId = '00000000-0000-0000-0000-000000000000';
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${superToken}` };

    await request(server)
      .post(`/admin/leads/${missingId}/contacted`)
      .set(auth)
      .expect(404);
    await request(server)
      .delete(`/admin/leads/${missingId}`)
      .set(auth)
      .expect(404);
  });

  it('deletes a single lead and writes an audit log entry', async () => {
    const id = await seedLead('E2E AL Delete Me');

    await request(app.getHttpServer())
      .delete(`/admin/leads/${id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(204);

    const rows: Array<{ id: string }> = await controlPlane.query(
      `SELECT id FROM leads WHERE id = $1`,
      [id],
    );
    expect(rows).toHaveLength(0);

    const auditRows: Array<{ action: string; target_id: string }> =
      await controlPlane.query(
        `SELECT action, target_id FROM admin_audit_log WHERE action = 'lead.deleted' AND target_id = $1`,
        [id],
      );
    expect(auditRows).toHaveLength(1);
  });

  it('deletes only the selected leads, leaves the rest, and writes one audit entry with the ids', async () => {
    const keepId = await seedLead('E2E AL Bulk Keep');
    const deleteOneId = await seedLead('E2E AL Bulk Delete One');
    const deleteTwoId = await seedLead('E2E AL Bulk Delete Two');

    const res = await request(app.getHttpServer())
      .delete('/admin/leads')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ ids: [deleteOneId, deleteTwoId] })
      .expect(200);

    expect((res.body as DeleteLeadsResponse).deletedCount).toBe(2);

    const remaining: Array<{ id: string }> =
      await controlPlane.query(`SELECT id FROM leads`);
    expect(remaining.map((row) => row.id)).toEqual([keepId]);

    const auditRows: Array<{ metadata: { count: number; ids: string[] } }> =
      await controlPlane.query(
        `SELECT metadata FROM admin_audit_log WHERE action = 'lead.deleted_bulk' ORDER BY created_at DESC LIMIT 1`,
      );
    expect(auditRows[0]?.metadata.count).toBe(2);
    expect(auditRows[0]?.metadata.ids.sort()).toEqual(
      [deleteOneId, deleteTwoId].sort(),
    );
  });

  it('rejects an empty selection', async () => {
    await request(app.getHttpServer())
      .delete('/admin/leads')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ ids: [] })
      .expect(400);
  });
});
