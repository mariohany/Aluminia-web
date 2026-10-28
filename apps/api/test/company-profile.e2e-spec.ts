import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type { CompanyProfile } from '@repo/types/company-profile';
import { FilePurpose, type UploadedFileSummary } from '@repo/types/files';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Config › Company profile (docs/company_profile_planing.md §4, §7):
 * defaults before the first save, who may read and write, validation,
 * and the logo id — attached on save, released when replaced, refused
 * when it isn't this company's.
 */
describe('Company profile (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const alphaName = 'E2E Profile Alpha Aluminium';
  const betaName = 'E2E Profile Beta Glazing';
  const alphaAdmin = 'e2e-profile-alpha@test.local';
  const alphaUser = 'e2e-profile-alpha-user@test.local';
  const betaAdmin = 'e2e-profile-beta@test.local';
  const superAdmin = 'e2e-profile-super@test.local';
  const password = 'TestPassword123!';

  let alphaToken: string;
  let alphaUserToken: string;
  let betaToken: string;
  let superToken: string;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(56, 3),
  ]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    for (const [name, email] of [
      [alphaName, alphaAdmin],
      [betaName, betaAdmin],
    ]) {
      await provisioning.provision({
        name,
        planKey: 'pro',
        maxUsers: 5,
        admin: { email, password },
      });
    }
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [
        superAdmin,
        await app.get(PasswordService).hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );

    alphaToken = await loginAs(alphaAdmin);
    betaToken = await loginAs(betaAdmin);
    superToken = await loginAs(superAdmin);
    await request(app.getHttpServer())
      .post('/company/users')
      .set('Authorization', `Bearer ${alphaToken}`)
      .send({ email: alphaUser, password })
      .expect(201);
    alphaUserToken = await loginAs(alphaUser);
  });

  afterAll(async () => {
    try {
      for (const name of [alphaName, betaName]) {
        const companies: Array<{ id: string; schema_name: string }> =
          await controlPlane.query(
            `SELECT id, schema_name FROM companies WHERE name = $1`,
            [name],
          );
        for (const company of companies) {
          await controlPlane.query(
            `DELETE FROM stored_blobs WHERE starts_with(key, $1)`,
            [`companies/${company.id}/`],
          );
          await controlPlane.query(
            `DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`,
          );
          await controlPlane.query(
            `DELETE FROM admin_audit_log
              WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = $1)`,
            [company.id],
          );
          await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
            company.id,
          ]);
          await controlPlane.query(
            `DELETE FROM billing WHERE company_id = $1`,
            [company.id],
          );
          await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
            company.id,
          ]);
        }
      }
      await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
        superAdmin,
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

  const get = (token: string) =>
    request(app.getHttpServer())
      .get('/company/profile')
      .set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: object) =>
    request(app.getHttpServer())
      .patch('/company/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  async function uploadLogo(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/files')
      .set('Authorization', `Bearer ${token}`)
      .field('purpose', FilePurpose.LOGO)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    return (res.body as UploadedFileSummary).id;
  }

  async function fileRow(
    id: string,
  ): Promise<{ attached_at: Date | null } | undefined> {
    const rows: Array<{ attached_at: Date | null }> = await controlPlane.query(
      `SELECT attached_at FROM files WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  it('starts from the account name, everything else empty, for every company user', async () => {
    for (const token of [alphaToken, alphaUserToken]) {
      const res = await get(token).expect(200);
      expect(res.body).toEqual({
        enName: alphaName,
        arName: null,
        enAddress: null,
        arAddress: null,
        phone: null,
        email: null,
        website: null,
        taxId: null,
        commercialRegister: null,
        logoFileId: null,
        updatedAt: null,
      });
    }
  });

  it('saves only the fields sent, trimmed; null clears one', async () => {
    const first = await patch(alphaToken, {
      enName: '  Alpha Printed  ',
      arName: 'ألفا',
      phone: '+20 2 3820 1144',
      email: 'sales@alpha.test',
      taxId: '512-884-301',
    }).expect(200);
    const saved = first.body as CompanyProfile;
    expect(saved.enName).toBe('Alpha Printed');
    expect(saved.arName).toBe('ألفا');
    expect(saved.updatedAt).not.toBeNull();

    const second = await patch(alphaToken, {
      phone: null,
      website: 'alpha.test',
    }).expect(200);
    expect(second.body).toMatchObject({
      enName: 'Alpha Printed',
      arName: 'ألفا',
      phone: null,
      email: 'sales@alpha.test',
      website: 'alpha.test',
      taxId: '512-884-301',
    });
    expect((await get(alphaUserToken).expect(200)).body).toEqual(second.body);
  });

  it('keeps the account name untouched (P1)', async () => {
    const [row]: Array<{ name: string }> = await controlPlane.query(
      `SELECT name FROM companies WHERE name = $1`,
      [alphaName],
    );
    expect(row?.name).toBe(alphaName);
  });

  it('lets only a company admin change it, and no super admin read it', async () => {
    await patch(alphaUserToken, { arName: 'x' }).expect(403);
    await get(superToken).expect(403);
  });

  it.each([
    ['an empty English name', { enName: '   ' }],
    ['an empty string (the form sends null)', { arName: '' }],
    ['a bad email', { email: 'not-an-email' }],
    ['an unknown field', { logo: 'x' }],
    ['a name too long', { arName: 'a'.repeat(256) }],
    ['a logo id that is not a uuid', { logoFileId: 'abc' }],
  ])('refuses %s', async (_, body) => {
    await patch(alphaToken, body).expect(400);
  });

  it('attaches a new logo, releases the one it replaces, and removes it on null', async () => {
    const first = await uploadLogo(alphaToken);
    const res = await patch(alphaToken, { logoFileId: first }).expect(200);
    expect((res.body as CompanyProfile).logoFileId).toBe(first);
    expect((await fileRow(first))?.attached_at).not.toBeNull();

    // Saving other fields leaves the logo alone.
    await patch(alphaToken, { arAddress: 'القاهرة' }).expect(200);
    expect((await fileRow(first))?.attached_at).not.toBeNull();

    const second = await uploadLogo(alphaToken);
    await patch(alphaToken, { logoFileId: second }).expect(200);
    expect(await fileRow(first)).toBeUndefined();
    await request(app.getHttpServer())
      .get(`/files/${first}`)
      .set('Authorization', `Bearer ${alphaToken}`)
      .expect(404);

    const cleared = await patch(alphaToken, { logoFileId: null }).expect(200);
    expect((cleared.body as CompanyProfile).logoFileId).toBeNull();
    expect(await fileRow(second)).toBeUndefined();
  });

  it('refuses another company’s file or a made-up id, and changes nothing', async () => {
    const betaLogo = await uploadLogo(betaToken);
    const before = (await get(alphaToken).expect(200)).body as CompanyProfile;

    await patch(alphaToken, { logoFileId: betaLogo, arName: 'changed' }).expect(
      400,
    );
    await patch(alphaToken, { logoFileId: randomUUID() }).expect(400);

    expect((await get(alphaToken).expect(200)).body).toEqual(before);
    expect((await fileRow(betaLogo))?.attached_at).toBeNull();
  });

  it('keeps each company’s profile to itself', async () => {
    const res = await get(betaToken).expect(200);
    expect((res.body as CompanyProfile).enName).toBe(betaName);
    expect((res.body as CompanyProfile).arName).toBeNull();
  });
});
