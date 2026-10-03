import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type {
  ActivityLogEntry,
  AuditLogEntry,
  PaginatedResult,
} from '@repo/types/logs';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * The Logs page's filters (docs/admin_redesign_planing.md §7): audit by
 * area (action prefix), actor and a name/email search; activity by
 * company name. Rows are seeded directly so the assertions don't depend
 * on whatever else the database already holds — every query is also
 * narrowed by this suite's own unique tokens.
 */
describe('Admin logs filters (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const token = `lf${Date.now()}`;
  const companyName = `E2E LF ${token} Glazing`;
  const superA = `e2e-lf-a-${token}@test.local`;
  const superB = `e2e-lf-b-${token}@test.local`;
  const password = 'TestPassword123!';

  let companyId: string;
  let superAId: string;
  let superBId: string;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const passwordService = app.get(PasswordService);
    const provisioning = app.get(TenantProvisioningService);

    const company = await provisioning.provision({
      name: companyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: `e2e-lf-admin-${token}@test.local`, password },
    });
    companyId = company.company.id;

    const hash = await passwordService.hash(password);
    const ids: string[] = [];
    for (const email of [superA, superB]) {
      const rows: Array<{ id: string }> = await controlPlane.query(
        `INSERT INTO users (email, password_hash, role, company_id, status)
         VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
        [email, hash, UserRole.SUPER_ADMIN],
      );
      ids.push(rows[0].id);
    }
    [superAId, superBId] = ids;

    const seed = async (
      actor: string,
      action: string,
      metadata: Record<string, unknown>,
    ): Promise<void> => {
      await controlPlane.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, metadata)
         VALUES ($1, $2, 'test', $3)`,
        [actor, action, JSON.stringify(metadata)],
      );
    };
    await seed(superAId, 'company.created', { name: `${token} Facades` });
    await seed(superAId, 'user.password_reset', {
      email: `karim.${token}@x.test`,
    });
    await seed(superBId, 'lookup.glass.updated', {
      name: `${token} Clear 6mm`,
    });
    await seed(superBId, 'lead.deleted', { companyName: `${token} Lead Co` });
    // A literal % in the data, to prove search escapes LIKE wildcards.
    await seed(superBId, 'lookup.color.created', { name: `${token} 50% grey` });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: superA, password })
      .expect(200);
    authToken = (res.body as LoginResponse).accessToken;
  });

  afterAll(async () => {
    try {
      const rows: Array<{ schema_name: string }> = await controlPlane.query(
        `SELECT schema_name FROM companies WHERE id = $1`,
        [companyId],
      );
      await controlPlane.query(
        `DROP SCHEMA IF EXISTS "${rows[0]?.schema_name ?? ''}" CASCADE`,
      );
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1)`,
        [[superAId, superBId]],
      );
      await controlPlane.query(
        `DELETE FROM users WHERE company_id = $1 OR id = ANY($2)`,
        [companyId, [superAId, superBId]],
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

  async function audit(
    query: Record<string, string>,
  ): Promise<AuditLogEntry[]> {
    const res = await request(app.getHttpServer())
      .get('/admin/logs/audit')
      .query({ pageSize: '100', ...query })
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(200);
    return (res.body as PaginatedResult<AuditLogEntry>).items;
  }

  // Only this suite's rows: every seeded actor is one of ours.
  const ours = (items: AuditLogEntry[]) =>
    items
      .filter((i) => [superAId, superBId].includes(i.actorUserId))
      .map((i) => i.action)
      .sort();

  it('filters by area (action prefix)', async () => {
    expect(ours(await audit({ area: 'lookup', actorId: superBId }))).toEqual([
      'lookup.color.created',
      'lookup.glass.updated',
    ]);
  });

  it('filters by actor', async () => {
    expect(ours(await audit({ actorId: superAId }))).toEqual([
      'company.created',
      'user.password_reset',
    ]);
  });

  it('searches the name, email and companyName the entry recorded', async () => {
    expect(ours(await audit({ search: `${token} facades` }))).toEqual([
      'company.created',
    ]);
    expect(ours(await audit({ search: `karim.${token}` }))).toEqual([
      'user.password_reset',
    ]);
    expect(ours(await audit({ search: `${token} lead` }))).toEqual([
      'lead.deleted',
    ]);
  });

  it('treats % in a search as text, not a wildcard', async () => {
    expect(ours(await audit({ search: `${token} 50%` }))).toEqual([
      'lookup.color.created',
    ]);
    expect(ours(await audit({ search: `${token}%Facades` }))).toEqual([]);
  });

  it('rejects an unknown area', async () => {
    await request(app.getHttpServer())
      .get('/admin/logs/audit')
      .query({ area: 'billing' })
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(400);
  });

  it('searches the activity log by company name', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/logs/activity')
      .query({ search: `lf ${token} glaz` })
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(200);
    const items = (res.body as PaginatedResult<ActivityLogEntry>).items;
    expect(items.map((i) => i.companyId)).toEqual([companyId]);
  });
});
