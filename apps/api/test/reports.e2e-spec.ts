import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole, type LoginResponse } from '@repo/types/auth';
import type { ClientDetail } from '@repo/types/clients';
import type { ProjectDetail } from '@repo/types/projects';
import type { CuttingSettings, ReportStatus } from '@repo/types/reports';
import type { WindowDetail } from '@repo/types/windows';
import { AppModule } from './../src/app.module';
import { PasswordService } from './../src/modules/auth/password.service';
import { BarOptimiserRunner } from './../src/modules/reports/bar-optimiser/runner';
import { ReportJobQueue } from './../src/modules/reports/report-job-queue';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import {
  dropPlatformCatalogue,
  seedPlatformCatalogue,
} from './fixtures/platform-catalogue';

/**
 * docs/reports_planing.md §7 — the bar optimiser report API: cutting
 * settings, status, the background Generate job (in-process under
 * ts-jest, BarOptimiserRunner), staleness, isolation, and the PDF —
 * rendered by real headless Chrome through render-pdf.mjs. One job runs at
 * a time here (docs/report_queue_planing.md), so the queue is exercised.
 */
const SINGLE_LIGHT = 'left|right|sill|top';

describe('Reports (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E Reports Aluminium';
  const otherCompanyName = 'E2E Reports Other Co';
  const CATALOGUE_PREFIX = 'E2E REP';
  const adminEmail = 'e2e-reports-admin@test.local';
  const userEmail = 'e2e-reports-user@test.local';
  const otherAdminEmail = 'e2e-reports-other@test.local';
  const superEmail = 'e2e-reports-super@test.local';
  const password = 'TestPassword123!';

  let token: string;
  let userToken: string;
  let otherToken: string;
  let superToken: string;
  let schemaName: string;
  let clientId: string;
  let projectId: string;
  let fixedWindowId: string;

  let frameId: string;
  let leafId: string;
  let beadId: string;
  let glassId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ReportJobQueue)
      .useValue(new ReportJobQueue(1))
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    const passwords = app.get(PasswordService);

    const company = await provisioning.provision({
      name: companyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminEmail, password },
    });
    await provisioning.provision({
      name: otherCompanyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: otherAdminEmail, password },
    });
    schemaName = company.company.schemaName;
    const hash = await passwords.hash(password);
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [userEmail, hash, UserRole.USER, company.company.id],
    );
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [superEmail, hash, UserRole.SUPER_ADMIN],
    );

    token = await loginAs(adminEmail);
    userToken = await loginAs(userEmail);
    otherToken = await loginAs(otherAdminEmail);
    superToken = await loginAs(superEmail);

    const catalogue = await seedPlatformCatalogue(
      controlPlane,
      CATALOGUE_PREFIX,
    );
    frameId = catalogue.frameId;
    leafId = catalogue.leafId;
    beadId = catalogue.beadId;
    glassId = catalogue.glassId;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ enName: 'Reports Client' })
      .expect(201);
    clientId = (client.body as ClientDetail).id;
    const project = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, enName: 'Reports Project' })
      .expect(201);
    projectId = (project.body as ProjectDetail).id;

    // A fixed light (frame + beads) ×2 and a single sash window ×3.
    const fixed = await createWindow('W-fixed', 2, {
      kind: 'fixed',
      sashProfile: null,
      beadProfile: `platform:${beadId}`,
    });
    fixedWindowId = fixed.id;
    await createWindow('W-sash', 3, {
      kind: 'opening',
      sashProfile: `platform:${leafId}`,
      beadProfile: null,
    });
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .delete(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmName: 'Reports Client' })
      .expect(204);
    await controlPlane.query(`DELETE FROM users WHERE email = $1`, [
      superEmail,
    ]);
    for (const name of [companyName, otherCompanyName]) {
      const rows: Array<{ id: string; schema_name: string }> =
        await controlPlane.query(
          `SELECT id, schema_name FROM companies WHERE name = $1`,
          [name],
        );
      for (const row of rows) {
        await controlPlane.query(
          `DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`,
        );
        await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
          row.id,
        ]);
        await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
          row.id,
        ]);
        await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
          row.id,
        ]);
      }
    }
    await dropPlatformCatalogue(controlPlane, CATALOGUE_PREFIX);
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  async function createWindow(
    name: string,
    quantity: number,
    section: Record<string, unknown>,
  ): Promise<WindowDetail> {
    const res = await request(app.getHttpServer())
      .post('/windows')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId,
        name,
        quantity,
        panels: [
          {
            xMm: 0,
            yMm: 0,
            widthMm: 1200,
            heightMm: 1500,
            frameProfile: `platform:${frameId}`,
            dividerProfile: null,
            dividers: [],
            sections: [
              {
                faceKey: SINGLE_LIGHT,
                openingType: null,
                glassKind: 'single',
                glass: `platform:${glassId}`,
                hasFlyScreen: false,
                sliding: null,
                ...section,
              },
            ],
            isDoor: false,
            headShape: 'flat',
            headRiseMm: null,
          },
        ],
      })
      .expect(201);
    return res.body as WindowDetail;
  }

  const api = (as: string = token) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${as}`),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${as}`),
    put: (path: string, body: object) =>
      request(app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${as}`)
        .send(body),
  });
  const reportPath = (lang = 'en') =>
    `/projects/${projectId}/reports/bar-optimiser?lang=${lang}`;
  const generatePath = (lang = 'en') =>
    `/projects/${projectId}/reports/bar-optimiser/generate?lang=${lang}`;

  async function status(lang = 'en'): Promise<ReportStatus> {
    const res = await api().get(reportPath(lang)).expect(200);
    return res.body as ReportStatus;
  }

  /** Polls until no job is queued or running (the in-process run is quick). */
  async function settled(lang = 'en'): Promise<ReportStatus> {
    for (let i = 0; i < 120; i++) {
      const s = await status(lang);
      if (s.job?.state !== 'running' && s.job?.state !== 'queued') return s;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('report job did not finish');
  }

  it('reads default cutting settings when the company never saved any', async () => {
    const res = await api().get('/reports/cutting-settings').expect(200);
    expect(res.body as CuttingSettings).toEqual({
      kerfMm: 4,
      endTrimMm: 10,
      extraLengthsMm: [],
      stockLengthsMm: [6500, 6000],
      updatedAt: null,
    });
  });

  it.each([
    [
      'kerf off the 0.5 mm step',
      { kerfMm: 4.3, endTrimMm: 10, extraLengthsMm: [] },
    ],
    ['trim over 100', { kerfMm: 4, endTrimMm: 101, extraLengthsMm: [] }],
    [
      'a default length again',
      { kerfMm: 4, endTrimMm: 10, extraLengthsMm: [6000] },
    ],
    ['a length too short', { kerfMm: 4, endTrimMm: 10, extraLengthsMm: [900] }],
    [
      'eleven extra lengths',
      {
        kerfMm: 4,
        endTrimMm: 10,
        extraLengthsMm: Array.from({ length: 11 }, (_, i) => 7000 + i),
      },
    ],
    [
      'an unknown field',
      { kerfMm: 4, endTrimMm: 10, extraLengthsMm: [], x: 1 },
    ],
  ])('refuses cutting settings with %s', async (_label, body) => {
    await api().put('/reports/cutting-settings', body).expect(400);
  });

  it('has no report before the first Generate', async () => {
    const s = await status();
    expect(s).toMatchObject({
      state: 'none',
      generatedAt: null,
      hasPdf: false,
      summary: null,
      job: null,
    });
  });

  it('generates in the background: running with per-member progress, then fresh', async () => {
    const started = await api().post(generatePath()).expect(202);
    const body = started.body as ReportStatus;
    expect(body.job?.state).toBe('running');
    expect(body.job?.groups.map((g) => g.member)).toEqual([
      'frame',
      'sash',
      'bead',
    ]);

    const done = await settled();
    expect(done.job).toBeNull();
    expect(done.state).toBe('fresh');
    expect(done.generatedAt).not.toBeNull();
    expect(done.hasPdf).toBe(true);

    const summary = done.summary!;
    expect(summary.windowCount).toBe(2);
    expect(summary.unitCount).toBe(5);
    expect(summary.stockLengthsMm).toEqual([6500, 6000]);
    expect(summary.members.map((m) => m.member)).toEqual([
      'frame',
      'sash',
      'bead',
    ]);
    // 4 frame pieces per unit × 5 units.
    expect(summary.members[0].pieceCount).toBe(20);
    expect(summary.total.boughtMm).toBe(
      Object.entries(summary.total.mix).reduce(
        (sum, [length, n]) => sum + Number(length) * n,
        0,
      ),
    );
    expect(summary.skipped).toEqual([]);
    expect(summary.approximate).toBe(true);
  });

  it('a USER can read the report too', async () => {
    const res = await api(userToken).get(reportPath()).expect(200);
    expect((res.body as ReportStatus).state).toBe('fresh');
  });

  it('downloads the PDF as an attachment', async () => {
    const res = await api()
      .get(`/projects/${projectId}/reports/bar-optimiser/pdf?lang=en`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="reports-project-bar-optimiser-en.pdf"',
    );
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(10_000);
  });

  it('a language with no report yet has no PDF', async () => {
    await api()
      .get(`/projects/${projectId}/reports/bar-optimiser/pdf?lang=ar`)
      .expect(404);
  });

  it('caches per language, and renders Arabic too', async () => {
    expect((await status('ar')).state).toBe('none');
    await api().post(generatePath('ar')).expect(202);
    const ar = await settled('ar');
    expect(ar).toMatchObject({ state: 'fresh', hasPdf: true, job: null });
    // English is untouched by the Arabic run.
    expect((await status('en')).state).toBe('fresh');
  });

  it('turns stale after a window edit and counts the window', async () => {
    await request(app.getHttpServer())
      .patch(`/windows/${fixedWindowId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 4 })
      .expect(200);
    const s = await status();
    expect(s.state).toBe('stale');
    expect(s.changedWindows).toBe(1);
    // The previous numbers stay readable while stale (D15).
    expect(s.summary?.unitCount).toBe(5);

    await api().post(generatePath()).expect(202);
    const again = await settled();
    expect(again.state).toBe('fresh');
    expect(again.summary?.unitCount).toBe(7);
  });

  it('turns stale after a project rename', async () => {
    await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enName: 'Reports Project 2' })
      .expect(200);
    const s = await status();
    expect(s.state).toBe('stale');
    expect(s.changedWindows).toBe(0);
    await api().post(generatePath()).expect(202);
    expect((await settled()).state).toBe('fresh');
  });

  it('saving settings makes the report stale; the next run uses them', async () => {
    const saved = await api()
      .put('/reports/cutting-settings', {
        kerfMm: 4.5,
        endTrimMm: 12,
        extraLengthsMm: [7000],
      })
      .expect(200);
    expect(saved.body as CuttingSettings).toMatchObject({
      kerfMm: 4.5,
      endTrimMm: 12,
      extraLengthsMm: [7000],
      stockLengthsMm: [7000, 6500, 6000],
    });
    expect((await status()).state).toBe('stale');

    await api().post(generatePath()).expect(202);
    const s = await settled();
    expect(s.state).toBe('fresh');
    expect(s.summary).toMatchObject({
      kerfMm: 4.5,
      endTrimMm: 12,
      stockLengthsMm: [7000, 6500, 6000],
    });
  });

  it('reports a job whose server died as failed, and Generate can start over', async () => {
    await controlPlane.query(
      `UPDATE "${schemaName}".report_cache
          SET job_state = 'running', job_started_at = now() - interval '5 minutes',
              job_progress = '{"groups": []}', updated_at = now() - interval '5 minutes'
        WHERE project_id = $1 AND language = 'en'`,
      [projectId],
    );
    const s = await status();
    expect(s.job).toMatchObject({ state: 'failed', error: 'interrupted' });
    // The finished report from before is still there.
    expect(s.state).toBe('fresh');

    await api().post(generatePath()).expect(202);
    expect((await settled()).job).toBeNull();
  });

  it('queues a job while the one slot is busy, then runs it', async () => {
    // Hold the first job's solve until released, so the second must wait.
    const runner = app.get(BarOptimiserRunner);
    const run = runner.run.bind(runner) as BarOptimiserRunner['run'];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const spy = jest
      .spyOn(runner, 'run')
      .mockImplementationOnce(async (...args) => {
        await held;
        return run(...args);
      });

    try {
      // As the USER: Generate allows 6 a minute per user, and the admin
      // has spent those by now.
      const first = await api(userToken).post(generatePath('en')).expect(202);
      expect((first.body as ReportStatus).job?.state).toBe('running');

      const second = await api(userToken).post(generatePath('ar')).expect(202);
      const queued = (second.body as ReportStatus).job;
      expect(queued).toMatchObject({ state: 'queued', queuePosition: 0 });
      expect(queued?.groups.every((g) => g.state === 'waiting')).toBe(true);

      // Generate again while it waits: the same job, not a second one.
      const again = await api(userToken).post(generatePath('ar')).expect(202);
      expect((again.body as ReportStatus).job).toMatchObject({
        state: 'queued',
        startedAt: queued?.startedAt,
      });
      expect((await status('ar')).job).toMatchObject({
        state: 'queued',
        queuePosition: 0,
      });
    } finally {
      release();
      spy.mockRestore();
    }

    expect(await settled('en')).toMatchObject({ state: 'fresh', job: null });
    expect(await settled('ar')).toMatchObject({ state: 'fresh', job: null });
  });

  it('reports a queued job whose server died as failed too', async () => {
    await controlPlane.query(
      `UPDATE "${schemaName}".report_cache
          SET job_state = 'queued', job_started_at = now() - interval '5 minutes',
              job_progress = '{"groups": []}', updated_at = now() - interval '5 minutes'
        WHERE project_id = $1 AND language = 'en'`,
      [projectId],
    );
    expect((await status()).job).toMatchObject({
      state: 'failed',
      error: 'interrupted',
      queuePosition: null,
    });
  });

  it('rejects an unknown language', async () => {
    await api().get(reportPath('fr')).expect(400);
  });

  it("refuses another company's project with 404", async () => {
    await api(otherToken).get(reportPath()).expect(404);
    await api(otherToken).post(generatePath()).expect(404);
  });

  it('refuses a super admin (no company)', async () => {
    const res = await api(superToken).get(reportPath());
    expect([401, 403]).toContain(res.status);
  });

  it('404s a project that does not exist', async () => {
    await api()
      .get(
        '/projects/00000000-0000-4000-8000-000000000000/reports/bar-optimiser',
      )
      .expect(404);
  });
});
