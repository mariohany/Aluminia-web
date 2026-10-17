import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import { FilePurpose, type UploadedFileSummary } from '@repo/types/files';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';
import { FilesService } from './../src/modules/files/files.service';

/**
 * The one upload API (docs/company_profile_planing.md §3b, §7): what it
 * accepts, who may upload and read, the attach checks that make a
 * client-sent id safe, the 24 h sweep of unused uploads, and the bytes
 * going with a permanently deleted company.
 */
describe('Files (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let files: FilesService;

  const alphaName = 'E2E Files Alpha Aluminium';
  const betaName = 'E2E Files Beta Glazing';
  const gammaName = 'E2E Files Gamma Doomed';
  const alphaAdmin = 'e2e-files-alpha@test.local';
  const alphaUser = 'e2e-files-alpha-user@test.local';
  const betaAdmin = 'e2e-files-beta@test.local';
  const gammaAdmin = 'e2e-files-gamma@test.local';
  const superAdmin = 'e2e-files-super@test.local';
  const password = 'TestPassword123!';

  let alphaId: string;
  let betaId: string;
  let gammaId: string;
  let alphaToken: string;
  let alphaUserToken: string;
  let betaToken: string;
  let gammaToken: string;
  let superToken: string;

  const png = (size = 64) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(Math.max(0, size - 8), 7),
    ]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(40, 1),
  ]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x24, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
    Buffer.alloc(20, 2),
  ]);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    files = app.get(FilesService);
    const provisioning = app.get(TenantProvisioningService);

    const make = (name: string, email: string) =>
      provisioning.provision({
        name,
        plan: 'starter',
        maxUsers: 5,
        admin: { email, password },
      });
    alphaId = (await make(alphaName, alphaAdmin)).company.id;
    betaId = (await make(betaName, betaAdmin)).company.id;
    gammaId = (await make(gammaName, gammaAdmin)).company.id;

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
    gammaToken = await loginAs(gammaAdmin);
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
      for (const name of [alphaName, betaName, gammaName]) {
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
      await controlPlane.query(
        `DELETE FROM admin_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE email = $1)`,
        [superAdmin],
      );
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

  function upload(
    token: string,
    body: Buffer,
    purpose: string = FilePurpose.LOGO,
    filename = 'logo.png',
  ) {
    return request(app.getHttpServer())
      .post('/files')
      .set('Authorization', `Bearer ${token}`)
      .field('purpose', purpose)
      .attach('file', body, { filename, contentType: 'image/png' });
  }

  async function uploadLogo(
    token: string,
    body = png(),
  ): Promise<UploadedFileSummary> {
    const res = await upload(token, body).expect(201);
    return res.body as UploadedFileSummary;
  }

  it('stores a logo and serves the same bytes back, privately', async () => {
    const body = png(300);
    const file = await uploadLogo(alphaToken, body);
    expect(file).toEqual({
      id: expect.any(String) as string,
      purpose: FilePurpose.LOGO,
      contentType: 'image/png',
      sizeBytes: 300,
    });

    const res = await request(app.getHttpServer())
      .get(`/files/${file.id}`)
      .set('Authorization', `Bearer ${alphaToken}`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, body)).toBe(0);
  });

  it('takes JPEG and WebP, typed from their bytes, not the browser', async () => {
    expect((await uploadLogo(alphaToken, jpeg)).contentType).toBe('image/jpeg');
    expect((await uploadLogo(alphaToken, webp)).contentType).toBe('image/webp');
  });

  it('refuses SVG, even sent as image/png (Q1)', async () => {
    await upload(alphaToken, svg, FilePurpose.LOGO, 'logo.png').expect(400);
  });

  it('refuses a logo over 1 MB with 413', async () => {
    await upload(alphaToken, png(1024 * 1024 + 1)).expect(413);
  });

  it('refuses a missing file or an unknown purpose', async () => {
    await request(app.getHttpServer())
      .post('/files')
      .set('Authorization', `Bearer ${alphaToken}`)
      .field('purpose', FilePurpose.LOGO)
      .expect(400);
    await upload(alphaToken, png(), 'avatar').expect(400);
  });

  it('lets only a company admin upload a logo, but every company user read it', async () => {
    await upload(alphaUserToken, png()).expect(403);
    const file = await uploadLogo(alphaToken);
    await request(app.getHttpServer())
      .get(`/files/${file.id}`)
      .set('Authorization', `Bearer ${alphaUserToken}`)
      .expect(200);
  });

  it('answers 404, never 403, for another company’s file or a made-up id', async () => {
    const file = await uploadLogo(alphaToken);
    for (const id of [file.id, randomUUID()]) {
      await request(app.getHttpServer())
        .get(`/files/${id}`)
        .set('Authorization', `Bearer ${betaToken}`)
        .expect(404);
    }
  });

  it('refuses the super admin, who has no company', async () => {
    await upload(superToken, png()).expect(403);
  });

  it('attaches a file once, only for its own company and purpose', async () => {
    const file = await uploadLogo(alphaToken);
    await expect(
      files.attach(betaId, file.id, FilePurpose.LOGO),
    ).rejects.toThrow('cannot be used');
    await files.attach(alphaId, file.id, FilePurpose.LOGO);
    await expect(
      files.attach(alphaId, file.id, FilePurpose.LOGO),
    ).rejects.toThrow('cannot be used');
    await files.detach(alphaId, file.id);
    await files.attach(alphaId, file.id, FilePurpose.LOGO);
    await expect(
      files.attach(alphaId, randomUUID(), FilePurpose.LOGO),
    ).rejects.toThrow('cannot be used');
  });

  it('release deletes the row and the bytes', async () => {
    const file = await uploadLogo(alphaToken);
    const [{ storage_key: key }]: Array<{ storage_key: string }> =
      await controlPlane.query(`SELECT storage_key FROM files WHERE id = $1`, [
        file.id,
      ]);
    await files.release(alphaId, file.id);
    await request(app.getHttpServer())
      .get(`/files/${file.id}`)
      .set('Authorization', `Bearer ${alphaToken}`)
      .expect(404);
    const blobs: unknown[] = await controlPlane.query(
      `SELECT 1 FROM stored_blobs WHERE key = $1`,
      [key],
    );
    expect(blobs).toHaveLength(0);
  });

  it('sweeps pending uploads older than 24 h on the next upload, keeping attached ones', async () => {
    const stale = await uploadLogo(betaToken);
    const kept = await uploadLogo(betaToken);
    await files.attach(betaId, kept.id, FilePurpose.LOGO);
    await controlPlane.query(
      `UPDATE files SET created_at = now() - interval '25 hours' WHERE id = ANY($1)`,
      [[stale.id, kept.id]],
    );

    await uploadLogo(betaToken);

    const rows: Array<{ id: string }> = await controlPlane.query(
      `SELECT id FROM files WHERE id = ANY($1)`,
      [[stale.id, kept.id]],
    );
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
    expect(await blobCountFor(betaId)).toBe(2);
  });

  it('deletes a company’s files with the company', async () => {
    await uploadLogo(gammaToken);
    await uploadLogo(gammaToken);
    expect(await blobCountFor(gammaId)).toBe(2);

    await request(app.getHttpServer())
      .post(`/admin/companies/${gammaId}/archive`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/admin/companies/${gammaId}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ confirmName: gammaName })
      .expect(204);

    expect(await blobCountFor(gammaId)).toBe(0);
    const rows: unknown[] = await controlPlane.query(
      `SELECT 1 FROM files WHERE company_id = $1`,
      [gammaId],
    );
    expect(rows).toHaveLength(0);
  });

  async function blobCountFor(companyId: string): Promise<number> {
    const [row]: Array<{ n: number }> = await controlPlane.query(
      `SELECT count(*)::int AS n FROM stored_blobs WHERE starts_with(key, $1)`,
      [`companies/${companyId}/`],
    );
    return row.n;
  }
});
