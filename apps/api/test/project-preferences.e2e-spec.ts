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
import type { CompanySystemBrandSummary } from '@repo/types/company-lookups';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';

/**
 * docs/project_preferences_planing.md §2/§4 — project creation's new,
 * entirely optional Preferences step. Same real-Postgres, real-HTTP
 * shape as clients-projects-isolation.e2e-spec.ts; the one thing that
 * needs its own file is the ScopedRef brand/catalogue plumbing, which
 * touches company-lookups too.
 */
describe('Project preferences (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E PP Aluminium';
  const adminEmail = 'e2e-pp-admin@test.local';
  const password = 'TestPassword123!';

  let token: string;
  let clientId: string;
  let platformBrandId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);

    await provisioning.provision({
      name: companyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminEmail, password },
    });

    token = await loginAs(adminEmail);

    const [brand]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_brand ORDER BY name ASC LIMIT 1`,
    );
    platformBrandId = brand.id;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ enName: 'Preferences Client' })
      .expect(201);
    clientId = (client.body as ClientDetail).id;
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .delete(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmName: 'Preferences Client' })
      .expect(204);
    await dropCompanies(controlPlane, [companyName]);
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  function createProject(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, enName: 'Prefs Job', ...body });
  }

  async function createCompanySystemBrand(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/company/lookups/system-brands')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return (res.body as CompanySystemBrandSummary).id;
  }

  it('creates a project with no preferences at all — every field null', async () => {
    const res = await createProject({}).expect(201);
    const body = res.body as ProjectDetail;
    expect(body.defaultSystemBrand).toBeNull();
    expect(body.defaultSystemCatalog).toBeNull();
    expect(body.currency).toBeNull();
    expect(body.vatRate).toBeNull();
    expect(body.discountRate).toBeNull();
  });

  it('round-trips a full preference set, with rates as numbers not strings', async () => {
    const created = await createProject({
      defaultSystemBrand: `platform:${platformBrandId}`,
      currency: 'EGP',
      vatRate: 14,
      discountRate: 5,
    }).expect(201);
    const projectId = (created.body as ProjectDetail).id;

    const fetched = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = fetched.body as ProjectDetail;

    expect(body.defaultSystemBrand).toBe(`platform:${platformBrandId}`);
    expect(body.currency).toBe('EGP');
    expect(body.vatRate).toBe(14);
    expect(body.discountRate).toBe(5);
    expect(typeof body.vatRate).toBe('number');
  });

  it('accepts both a platform-scope and a company-scope ref, in separate requests', async () => {
    const companyBrandId = await createCompanySystemBrand('E2E Company Brand');

    const platformProject = await createProject({
      defaultSystemBrand: `platform:${platformBrandId}`,
    }).expect(201);
    expect((platformProject.body as ProjectDetail).defaultSystemBrand).toBe(
      `platform:${platformBrandId}`,
    );

    const companyProject = await createProject({
      defaultSystemBrand: `company:${companyBrandId}`,
    }).expect(201);
    expect((companyProject.body as ProjectDetail).defaultSystemBrand).toBe(
      `company:${companyBrandId}`,
    );
  });

  it('PATCHes preferences alone, leaving name/address/contact untouched', async () => {
    const created = await createProject({
      enAddress: '12 Corniche',
      phone: '+20100000000',
    }).expect(201);
    const projectId = (created.body as ProjectDetail).id;

    const patched = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'USD', vatRate: 10 })
      .expect(200);
    const body = patched.body as ProjectDetail;

    expect(body.currency).toBe('USD');
    expect(body.vatRate).toBe(10);
    expect(body.enAddress).toBe('12 Corniche');
    expect(body.phone).toBe('+20100000000');
    expect(body.enName).toBe('Prefs Job');
  });

  it('nulls the catalogue when the brand changes without a catalogue in the same request', async () => {
    const companyBrandId = await createCompanySystemBrand('E2E Rebrand Source');

    const created = await createProject({
      defaultSystemBrand: `company:${companyBrandId}`,
      defaultSystemCatalog: `platform:${platformBrandId}`, // any well-formed ref; API does no existence check
    }).expect(201);
    const projectId = (created.body as ProjectDetail).id;
    expect((created.body as ProjectDetail).defaultSystemCatalog).toBe(
      `platform:${platformBrandId}`,
    );

    // Brand-only PATCH — no catalogue in the same request.
    const newBrandId = await createCompanySystemBrand('E2E Rebrand Target');
    const patched = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultSystemBrand: `company:${newBrandId}` })
      .expect(200);
    const body = patched.body as ProjectDetail;

    expect(body.defaultSystemBrand).toBe(`company:${newBrandId}`);
    expect(body.defaultSystemCatalog).toBeNull();
  });

  it('keeps the catalogue when both brand and catalogue are set together', async () => {
    const created = await createProject({
      defaultSystemBrand: `platform:${platformBrandId}`,
      defaultSystemCatalog: `platform:${platformBrandId}`,
    }).expect(201);
    const projectId = (created.body as ProjectDetail).id;

    const otherBrandId = await createCompanySystemBrand('E2E Paired Change');
    const patched = await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        defaultSystemBrand: `company:${otherBrandId}`,
        defaultSystemCatalog: `company:${otherBrandId}`,
      })
      .expect(200);
    const body = patched.body as ProjectDetail;

    expect(body.defaultSystemBrand).toBe(`company:${otherBrandId}`);
    expect(body.defaultSystemCatalog).toBe(`company:${otherBrandId}`);
  });

  it('rejects a malformed ScopedRef', async () => {
    await createProject({ defaultSystemBrand: `foo:${platformBrandId}` }).expect(400);
  });

  it('rejects a bare uuid with no scope prefix', async () => {
    await createProject({ defaultSystemBrand: platformBrandId }).expect(400);
  });

  it('rejects a VAT rate outside 0–100', async () => {
    await createProject({ vatRate: 120 }).expect(400);
  });

  it('rejects an unknown currency', async () => {
    await createProject({ currency: 'GBP' }).expect(400);
  });
});

async function dropCompanies(controlPlane: DataSource, names: string[]) {
  for (const name of names) {
    const companies: Array<{ id: string; schema_name: string }> = await controlPlane.query(
      `SELECT id, schema_name FROM companies WHERE name = $1`,
      [name],
    );
    for (const company of companies) {
      await controlPlane.query(`DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`);
      await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [company.id]);
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [company.id]);
      await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [company.id]);
    }
  }
}
