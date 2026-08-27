import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { ClientDetail, ClientWithProjects } from '@repo/types/clients';
import type { ProjectDetail } from '@repo/types/projects';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Phase 11's isolation proof: the same guarantee Phase 6 established
 * for a throwaway endpoint, now carrying real domain entities.
 *
 * Real Postgres, real HTTP, real /auth/login, two genuinely provisioned
 * schemas. Nothing mocked — a mocked tenant connection would prove
 * nothing about the thing that can actually leak.
 */
describe('Clients & projects tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyOneName = 'E2E CP Alpha Aluminium';
  const companyTwoName = 'E2E CP Beta Glazing';
  const adminOneEmail = 'e2e-cp-alpha@test.local';
  const adminTwoEmail = 'e2e-cp-beta@test.local';
  const superAdminEmail = 'e2e-cp-super@test.local';
  const password = 'TestPassword123!';

  let tokenOne: string;
  let tokenTwo: string;
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

    await provisioning.provision({
      name: companyOneName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminOneEmail, password },
    });
    await provisioning.provision({
      name: companyTwoName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminTwoEmail, password },
    });

    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [superAdminEmail, await passwordService.hash(password), UserRole.SUPER_ADMIN],
    );

    tokenOne = await loginAs(adminOneEmail);
    tokenTwo = await loginAs(adminTwoEmail);
    superToken = await loginAs(superAdminEmail);
  });

  afterAll(async () => {
    await dropCompanies(controlPlane, [companyOneName, companyTwoName]);
    await controlPlane.query(`DELETE FROM users WHERE email = $1`, [superAdminEmail]);
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  function createClient(token: string, enName: string, arName?: string) {
    return request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ enName, ...(arName ? { arName } : {}) })
      .expect(201);
  }

  function createProject(token: string, clientId: string, enName: string) {
    return request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, enName })
      .expect(201);
  }

  it('shows each company only its own tree', async () => {
    const one = await createClient(tokenOne, 'Alpha Client', 'عميل ألفا');
    const two = await createClient(tokenTwo, 'Beta Client');
    await createProject(tokenOne, (one.body as ClientDetail).id, 'Alpha Job');

    const treeOne = await request(app.getHttpServer())
      .get('/clients')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    const treeTwo = await request(app.getHttpServer())
      .get('/clients')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);

    const namesOne = (treeOne.body as ClientWithProjects[]).map((c) => c.enName);
    const namesTwo = (treeTwo.body as ClientWithProjects[]).map((c) => c.enName);

    expect(namesOne).toContain('Alpha Client');
    expect(namesTwo).toContain('Beta Client');
    // The isolation claim itself, stated rather than merely implied.
    expect(namesOne).not.toContain('Beta Client');
    expect(namesTwo).not.toContain('Alpha Client');

    // Arabic survives the round trip through the tenant connection.
    const alpha = (treeOne.body as ClientWithProjects[]).find(
      (c) => c.enName === 'Alpha Client',
    );
    expect(alpha?.arName).toBe('عميل ألفا');
    expect(alpha?.projects.map((p) => p.enName)).toEqual(['Alpha Job']);

    // Cleanup so later assertions in this file start from a known tree.
    await deleteClient(tokenOne, (one.body as ClientDetail).id, 'Alpha Client');
    await deleteClient(tokenTwo, (two.body as ClientDetail).id, 'Beta Client');
  });

  it("refuses company B every operation on company A's project, with 404", async () => {
    const client = await createClient(tokenOne, 'Guarded Client');
    const clientId = (client.body as ClientDetail).id;
    const project = await createProject(tokenOne, clientId, 'Guarded Job');
    const projectId = (project.body as ProjectDetail).id;

    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${tokenTwo}` };

    // 404 and not 403 on every one of these: a 403 would confirm the
    // row exists, which is an existence oracle across a tenant boundary.
    await request(server).get(`/projects/${projectId}`).set(auth).expect(404);
    await request(server)
      .patch(`/projects/${projectId}`)
      .set(auth)
      .send({ enName: 'Hijacked' })
      .expect(404);
    await request(server)
      .delete(`/projects/${projectId}`)
      .set(auth)
      .send({ confirmName: 'Guarded Job' })
      .expect(404);
    await request(server).get(`/clients/${clientId}`).set(auth).expect(404);
    await request(server)
      .delete(`/clients/${clientId}`)
      .set(auth)
      .send({ confirmName: 'Guarded Client' })
      .expect(404);

    // Still intact and unchanged for its real owner.
    const after = await request(server)
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect((after.body as ProjectDetail).enName).toBe('Guarded Job');

    await deleteClient(tokenOne, clientId, 'Guarded Client');
  });

  it("will not attach a project to another tenant's client", async () => {
    const foreign = await createClient(tokenTwo, 'Foreign Client');
    const foreignId = (foreign.body as ClientDetail).id;

    // Rejected because that id genuinely does not exist inside company
    // one's schema — not because a check remembered to compare tenants.
    // The isolation is structural; this test pins that it stays so.
    await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ clientId: foreignId, enName: 'Cross-tenant Job' })
      .expect(400);

    await deleteClient(tokenTwo, foreignId, 'Foreign Client');
  });

  it("cascades a client's projects away without touching the other tenant", async () => {
    const doomed = await createClient(tokenOne, 'Doomed Client');
    const doomedId = (doomed.body as ClientDetail).id;
    await createProject(tokenOne, doomedId, 'Doomed Job A');
    await createProject(tokenOne, doomedId, 'Doomed Job B');

    const survivor = await createClient(tokenTwo, 'Survivor Client');
    const survivorId = (survivor.body as ClientDetail).id;
    await createProject(tokenTwo, survivorId, 'Survivor Job');

    const detail = await request(app.getHttpServer())
      .get(`/clients/${doomedId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect((detail.body as ClientDetail).projectCount).toBe(2);

    await deleteClient(tokenOne, doomedId, 'Doomed Client');

    // The other tenant's identically-shaped data is untouched. The
    // cascade is per-schema; this is what proves it stayed that way.
    const treeTwo = await request(app.getHttpServer())
      .get('/clients')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);
    const survivorRow = (treeTwo.body as ClientWithProjects[]).find(
      (c) => c.id === survivorId,
    );
    expect(survivorRow?.projects).toHaveLength(1);

    await deleteClient(tokenTwo, survivorId, 'Survivor Client');
  });

  it('refuses to delete a client unless the typed name matches', async () => {
    const client = await createClient(tokenOne, 'Confirm Me');
    const clientId = (client.body as ClientDetail).id;

    await request(app.getHttpServer())
      .delete(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ confirmName: 'Not The Name' })
      .expect(400);

    // Still there — the refusal was real, not cosmetic.
    await request(app.getHttpServer())
      .get(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    await deleteClient(tokenOne, clientId, 'Confirm Me');
  });

  it('cannot move a project to a different client', async () => {
    const from = await createClient(tokenOne, 'Origin Client');
    const to = await createClient(tokenOne, 'Target Client');
    const fromId = (from.body as ClientDetail).id;
    const toId = (to.body as ClientDetail).id;
    const project = await createProject(tokenOne, fromId, 'Stationary Job');
    const projectId = (project.body as ProjectDetail).id;

    // `clientId` is absent from updateProjectSchema, so Zod strips it.
    // The request succeeds and the rename applies — what must NOT
    // happen is the reassignment.
    const res = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ clientId: toId, enName: 'Renamed Job' })
      .expect(200);

    expect((res.body as ProjectDetail).enName).toBe('Renamed Job');
    expect((res.body as ProjectDetail).clientId).toBe(fromId);

    await deleteClient(tokenOne, fromId, 'Origin Client');
    await deleteClient(tokenOne, toId, 'Target Client');
  });

  it('leaves absent fields alone and clears explicit nulls', async () => {
    const client = await createClient(tokenOne, 'Patch Client');
    const clientId = (client.body as ClientDetail).id;
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        clientId,
        enName: 'Patch Job',
        arName: 'وظيفة',
        enAddress: '12 Corniche',
      })
      .expect(201);
    const projectId = (created.body as ProjectDetail).id;

    // A phone edit must not wipe the address or the Arabic name.
    const patched = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ phone: '+20100000000' })
      .expect(200);
    expect((patched.body as ProjectDetail).arName).toBe('وظيفة');
    expect((patched.body as ProjectDetail).enAddress).toBe('12 Corniche');

    // An explicit null is a deliberate clear, and must be honoured.
    const cleared = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ enAddress: null })
      .expect(200);
    expect((cleared.body as ProjectDetail).enAddress).toBeNull();
    expect((cleared.body as ProjectDetail).phone).toBe('+20100000000');

    await deleteClient(tokenOne, clientId, 'Patch Client');
  });

  it('records the authenticated caller as the project author', async () => {
    const client = await createClient(tokenOne, 'Author Client');
    const clientId = (client.body as ClientDetail).id;

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    const project = await createProject(tokenOne, clientId, 'Authored Job');
    // Taken from the verified JWT, never the body — otherwise a caller
    // could attribute their work to a colleague.
    expect((project.body as ProjectDetail).createdByUserId).toBe(
      (me.body as { id: string }).id,
    );

    await deleteClient(tokenOne, clientId, 'Author Client');
  });

  it('keeps a super admin out of the workspace surface entirely', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${superToken}` };

    await request(server).get('/clients').set(auth).expect(403);
    await request(server).post('/clients').set(auth).send({ enName: 'X' }).expect(403);
  });

  // A note on what the test above does and does not prove, established
  // by mutation rather than assumed:
  //
  // Making TenantGuard fail OPEN (`return true` when there is no
  // companyId) leaves it passing — because `@Roles(COMPANY_ADMIN, USER)`
  // rejects a super admin first, so RolesGuard is what produces the 403
  // here, not TenantGuard. The assertion is still worth keeping: these
  // routes must stay closed to the platform owner. It just isn't
  // evidence about fail-closed tenant resolution.
  //
  // TenantGuard's fail-closed behaviour is covered where it can actually
  // be observed — tenant-isolation.e2e-spec.ts, against a fixture route
  // with no @Roles to mask it. Likewise the connection-level guarantee:
  // downgrading `SET LOCAL search_path` to a plain `SET` does NOT fail
  // anything in this file, but fails 3 of 7 in tenant-connection.e2e-spec.ts.
  //
  // What this file does guard is the layer above both: that services
  // reach tenant rows only through TenantContextService, so no id from
  // one company can address a row in another.

  function deleteClient(token: string, id: string, confirmName: string) {
    return request(app.getHttpServer())
      .delete(`/clients/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmName })
      .expect(204);
  }
});

async function dropCompanies(controlPlane: DataSource, names: string[]) {
  for (const name of names) {
    const companies: Array<{ id: string; schema_name: string }> =
      await controlPlane.query(`SELECT id, schema_name FROM companies WHERE name = $1`, [
        name,
      ]);
    for (const company of companies) {
      await controlPlane.query(`DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`);
      await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [company.id]);
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [company.id]);
      await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [company.id]);
    }
  }
}
