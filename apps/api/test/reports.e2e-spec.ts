import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole, type LoginResponse } from '@repo/types/auth';
import type { ClientDetail } from '@repo/types/clients';
import type { ProjectDetail } from '@repo/types/projects';
import {
  SolveError,
  SolveRefusal,
  type BarOptimiserReport,
  type CuttingSettings,
  type ReportStatus,
  type SolveStart,
} from '@repo/types/reports';
import { optimiseProject } from '@repo/bar-optimiser/project';
import {
  solveInput,
  solvedProfileOf,
  type SolveResult,
} from '@repo/bar-optimiser/solve-result';
import { OPTIMISER_VERSION } from '@repo/bar-optimiser/version';
import type { WindowDetail } from '@repo/types/windows';
import { AppModule } from './../src/app.module';
import { PasswordService } from './../src/modules/auth/password.service';
import { PdfRenderer } from './../src/modules/reports/pdf/pdf-renderer.service';
import { ReportJobQueue } from './../src/modules/reports/report-job-queue';
import { clearUserRateLimits } from './fixtures/clear-rate-limits';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import {
  dropPlatformCatalogue,
  seedPlatformCatalogue,
} from './fixtures/platform-catalogue';

/**
 * docs/reports_planing.md §7, docs/browser_solve_planing.md §7 — the bar
 * optimiser report API: cutting settings, status, the browser solve (this
 * suite plays the browser: it runs the real optimiser on the lines the API
 * hands out and posts the plans back), the checks on a result, the
 * background print, staleness, isolation, and the PDF — rendered by real
 * headless Chrome through render-pdf.mjs. One print runs at a time here
 * (docs/report_queue_planing.md), so the queue is exercised.
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
  let adminId: string;
  let userId: string;
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
    adminId = company.admin.id;
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

    userId = (
      await controlPlane.query<{ id: string }[]>(
        `SELECT id FROM users WHERE email = $1`,
        [userEmail],
      )
    )[0].id;
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
          `DELETE FROM stored_blobs WHERE starts_with(key, $1)`,
          [`companies/${row.id}/`],
        );
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
    post: (path: string, body: object = {}) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${as}`)
        .send(body),
    put: (path: string, body: object) =>
      request(app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${as}`)
        .send(body),
  });
  const reportPath = (lang = 'en') =>
    `/projects/${projectId}/reports/bar-optimiser?lang=${lang}`;
  const solvePath = (step = '', lang = 'en') =>
    `/projects/${projectId}/reports/bar-optimiser/solve${step}?lang=${lang}`;
  const printPath = (lang = 'en') =>
    `/projects/${projectId}/reports/bar-optimiser/print?lang=${lang}`;

  async function status(lang = 'en', as = token): Promise<ReportStatus> {
    const res = await api(as).get(reportPath(lang)).expect(200);
    return res.body as ReportStatus;
  }

  /** Polls until no print is queued or running (Chrome takes a moment). */
  async function settled(lang = 'en'): Promise<ReportStatus> {
    for (let i = 0; i < 120; i++) {
      const s = await status(lang);
      if (s.job?.state !== 'running' && s.job?.state !== 'queued') return s;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('report print did not finish');
  }

  /** Starts a solve as `as`. The start is limited to 6 a minute per user,
   * and this suite starts more than that, so the count is cleared first
   * (bug-112). */
  async function startSolve(as = token, lang = 'en'): Promise<SolveStart> {
    await clearUserRateLimits(
      app,
      'ReportsController.startSolve',
      as === userToken ? userId : adminId,
    );
    const res = await api(as)
      .post(solvePath('', lang), { optimiserVersion: OPTIMISER_VERSION })
      .expect(200);
    return res.body as SolveStart;
  }

  /** What an honest browser does with a start: the real optimiser on the
   * line numbers. */
  async function browserSolve(start: SolveStart): Promise<SolveResult> {
    const project = await optimiseProject(
      solveInput(start.lines),
      start.settings,
    );
    return {
      profiles: project.profiles.map((p) => solvedProfileOf(p.profile, p)),
    };
  }

  function sendResult(start: SolveStart, result: SolveResult, lang = 'en') {
    return api().post(solvePath('/result', lang), {
      token: start.token,
      optimiserVersion: OPTIMISER_VERSION,
      ...result,
    });
  }

  /** Generate as the web will: start, solve, send, wait for the print. */
  async function generate(lang = 'en'): Promise<ReportStatus> {
    const start = await startSolve(token, lang);
    await sendResult(start, await browserSolve(start), lang).expect(202);
    return settled(lang);
  }

  async function solvedAt(): Promise<string> {
    const rows = await controlPlane.query<{ solved_at: Date }[]>(
      `SELECT solved_at FROM "${schemaName}".report_solve WHERE project_id = $1`,
      [projectId],
    );
    return rows[0].solved_at.toISOString();
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
      hasSolve: false,
      summary: null,
      job: null,
      solve: null,
    });
  });

  it('hands the browser the piece lines and a token, shows its progress, then prints its plans', async () => {
    const start = await startSolve();
    expect(start.settings).toEqual({
      lengths: [6500, 6000],
      kerfMm: 4,
      endTrimMm: 10,
    });
    expect(new Set(start.lines.map((l) => l.member))).toEqual(
      new Set(['frame', 'sash', 'bead']),
    );
    // 4 frame pieces per unit × 5 units.
    expect(
      start.lines
        .filter((l) => l.member === 'frame')
        .reduce((n, l) => n + l.count, 0),
    ).toBe(20);
    expect(Object.values(start.profileNos)).toContain('FRAME-01');
    expect(start.status.solve).toMatchObject({
      state: 'solving',
      startedByMe: true,
      startedByEmail: adminEmail,
    });
    expect(start.status.solve?.groups.map((g) => g.member)).toEqual([
      'frame',
      'sash',
      'bead',
    ]);

    // Progress, which is also the heartbeat; another user sees it (B5).
    const groups = start.status.solve!.groups.map((g, i) =>
      i === 0 ? { ...g, state: 'done' as const, profilesDone: 1 } : g,
    );
    await api()
      .put(solvePath('/progress'), { token: start.token, groups })
      .expect(204);
    expect((await status('en', userToken)).solve).toMatchObject({
      state: 'solving',
      startedByMe: false,
      startedByEmail: adminEmail,
      groups,
    });

    const sent = await sendResult(start, await browserSolve(start)).expect(202);
    const body = sent.body as ReportStatus;
    expect(body.solve).toBeNull();
    expect(body.hasSolve).toBe(true);
    expect(body.job?.state).toBe('running');

    const done = await settled();
    expect(done).toMatchObject({ state: 'fresh', hasPdf: true, job: null });
    const summary = done.summary!;
    expect(summary.windowCount).toBe(2);
    expect(summary.unitCount).toBe(5);
    expect(summary.stockLengthsMm).toEqual([6500, 6000]);
    expect(summary.members.map((m) => m.member)).toEqual([
      'frame',
      'sash',
      'bead',
    ]);
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

  it('stores the solve once per project, as piece-line plans, with the snapshot the browser draws (docs/browser_pdf_planing.md §6)', async () => {
    const rows = await controlPlane.query<
      {
        solve_fingerprint: string;
        snapshot_fingerprint: string;
        result: { profiles: { profile: string; best: unknown[] | null }[] };
        report: BarOptimiserReport;
      }[]
    >(
      `SELECT solve_fingerprint, snapshot_fingerprint, result, report FROM "${schemaName}".report_solve WHERE project_id = $1`,
      [projectId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].solve_fingerprint).toHaveLength(64);
    expect(rows[0].snapshot_fingerprint).toHaveLength(64);
    const { report } = rows[0];
    expect(report.summary.windowCount).toBe(2);
    // Frozen at Generate (P6): the names and every piece's label.
    expect(report.project.enName).toBe('Reports Project');
    expect(report.client?.enName).toBe('Reports Client');
    const piece = report.plans.find((p) => p.best)?.best?.bars[0].pieces[0];
    expect(piece?.windowName).toMatch(/^W-(fixed|sash)$/);
    expect(piece?.at).toHaveProperty('position');
    const bars = rows[0].result.profiles.flatMap((p) => p.best ?? []);
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toEqual({
      stockMm: expect.any(Number) as number,
      pieces: expect.arrayContaining([expect.any(Number)]) as number[],
    });
  });

  it('a USER can read the report too', async () => {
    expect((await status('en', userToken)).state).toBe('fresh');
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

  it('prints another language from the stored solve, without solving (B4, B8)', async () => {
    const before = await solvedAt();
    const ar = await status('ar');
    expect(ar).toMatchObject({ state: 'none', hasSolve: true });

    await api().post(printPath('ar')).expect(202);
    expect(await settled('ar')).toMatchObject({
      state: 'fresh',
      hasPdf: true,
      job: null,
    });
    expect((await status('ar')).summary?.unitCount).toBe(5);
    expect(await solvedAt()).toBe(before);
    expect((await status('en')).state).toBe('fresh');
  });

  it('refuses a second solve while one is alive, and takes over a silent one (B5)', async () => {
    const first = await startSolve();
    const busy = await api(userToken)
      .post(solvePath(), { optimiserVersion: OPTIMISER_VERSION })
      .expect(409);
    expect((busy.body as { code: string }).code).toBe(
      SolveRefusal.SOLVING_ELSEWHERE,
    );

    // The admin's tab closed: no heartbeat for over a minute.
    await controlPlane.query(
      `UPDATE "${schemaName}".report_solve SET updated_at = now() - interval '5 minutes' WHERE project_id = $1`,
      [projectId],
    );
    expect((await status()).solve).toMatchObject({
      state: 'failed',
      error: SolveError.STOPPED,
    });
    // The last good solve is still there.
    expect((await status()).hasSolve).toBe(true);

    const second = await startSolve(userToken);
    const lost = await api()
      .put(solvePath('/progress'), { token: first.token, groups: [] })
      .expect(409);
    expect((lost.body as { code: string }).code).toBe(SolveRefusal.SOLVE_LOST);

    await api(userToken)
      .post(solvePath('/stop'), { token: second.token })
      .expect(200);
    expect((await status()).solve).toBeNull();
  });

  it('refuses a browser with another optimiser version (B12)', async () => {
    const old = await api()
      .post(solvePath(), { optimiserVersion: OPTIMISER_VERSION - 1 })
      .expect(409);
    expect(old.body).toMatchObject({
      code: SolveRefusal.OUTDATED_CLIENT,
      message: 'Aluminia was updated. Reload the page to make this report.',
    });

    // A deploy landing mid-solve is caught at the result too.
    const start = await startSolve();
    const late = await api()
      .post(solvePath('/result'), {
        token: start.token,
        optimiserVersion: OPTIMISER_VERSION + 1,
        ...(await browserSolve(start)),
      })
      .expect(409);
    expect((late.body as { code: string }).code).toBe(
      SolveRefusal.OUTDATED_CLIENT,
    );
    await api().post(solvePath('/stop'), { token: start.token }).expect(200);
  });

  it('refuses tampered plans with 422 and ends the solve (§5)', async () => {
    const start = await startSolve();
    const result = await browserSolve(start);
    const bars = result.profiles[0].best!;
    bars[0].pieces.pop(); // a piece goes missing
    if (!bars[0].pieces.length) bars.shift();

    const res = await sendResult(start, result).expect(422);
    expect((res.body as { message: string }).message).toMatch(
      /is cut \d+×, needs \d+×/,
    );
    expect((await status()).solve).toMatchObject({
      state: 'failed',
      error: SolveError.FAILED,
    });
    // The token is spent: sending again is refused.
    await sendResult(start, await browserSolve(start)).expect(409);
    // Badly shaped bodies never reach the check.
    await api()
      .post(solvePath('/result'), {
        token: start.token,
        optimiserVersion: OPTIMISER_VERSION,
        profiles: [{ profile: 'x', best: [{ stockMm: 6000, pieces: [-1] }] }],
      })
      .expect(400);
  });

  it('refuses a result after a window changed, then Generate again works (Q1)', async () => {
    const start = await startSolve();
    await request(app.getHttpServer())
      .patch(`/windows/${fixedWindowId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 4 })
      .expect(200);

    const res = await sendResult(start, await browserSolve(start)).expect(409);
    expect((res.body as { code: string }).code).toBe(
      SolveRefusal.WINDOWS_CHANGED,
    );
    const s = await status();
    expect(s.solve).toMatchObject({
      state: 'failed',
      error: SolveError.WINDOWS_CHANGED,
    });
    expect(s.state).toBe('stale');
    expect(s.changedWindows).toBe(1);
    expect(s.hasSolve).toBe(false);
    // The previous numbers stay readable while stale (D15).
    expect(s.summary?.unitCount).toBe(5);
    await api().post(printPath()).expect(409);

    const again = await generate();
    expect(again.state).toBe('fresh');
    expect(again.summary?.unitCount).toBe(7);
    expect(again.solve).toBeNull();
  });

  it('a project rename only reprints: no solve needed', async () => {
    const before = await solvedAt();
    await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enName: 'Reports Project 2' })
      .expect(200);
    const s = await status();
    expect(s).toMatchObject({
      state: 'stale',
      changedWindows: 0,
      hasSolve: true,
    });
    await api().post(printPath()).expect(202);
    expect((await settled()).state).toBe('fresh');
    expect(await solvedAt()).toBe(before);
  });

  it('saving settings needs a new solve; the next one uses them', async () => {
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
    expect(await status()).toMatchObject({ state: 'stale', hasSolve: false });
    const noSolve = await api().post(printPath()).expect(409);
    expect((noSolve.body as { code: string }).code).toBe(SolveRefusal.NO_SOLVE);

    const s = await generate();
    expect(s.state).toBe('fresh');
    expect(s.summary).toMatchObject({
      kerfMm: 4.5,
      endTrimMm: 12,
      stockLengthsMm: [7000, 6500, 6000],
    });
  });

  it('Stop ends the solve; a browser giving up says why (B6, B11)', async () => {
    const stopped = await startSolve();
    const body = await api()
      .post(solvePath('/stop'), { token: stopped.token })
      .expect(200);
    expect((body.body as ReportStatus).solve).toBeNull();

    const tooBig = await startSolve();
    await api()
      .post(solvePath('/stop'), {
        token: tooBig.token,
        error: SolveError.TOO_BIG,
      })
      .expect(200);
    expect((await status()).solve).toMatchObject({
      state: 'failed',
      error: SolveError.TOO_BIG,
    });
    // Stopping a spent token changes nothing.
    await api().post(solvePath('/stop'), { token: stopped.token }).expect(200);
    expect((await status()).solve?.error).toBe(SolveError.TOO_BIG);
  });

  it('reports a print whose server died as failed, and Print can start over', async () => {
    await controlPlane.query(
      `UPDATE "${schemaName}".report_cache
          SET job_state = 'running', job_started_at = now() - interval '5 minutes',
              updated_at = now() - interval '5 minutes'
        WHERE project_id = $1 AND language = 'en'`,
      [projectId],
    );
    const s = await status();
    expect(s.job).toMatchObject({ state: 'failed', error: 'interrupted' });
    // The finished report from before is still there.
    expect(s.state).toBe('fresh');

    await api().post(printPath()).expect(202);
    expect((await settled()).job).toBeNull();
  });

  it('queues a print while the one slot is busy, then prints it', async () => {
    // Hold the first print until released, so the second must wait.
    const renderer = app.get(PdfRenderer);
    const render = renderer.render.bind(renderer) as PdfRenderer['render'];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const spy = jest
      .spyOn(renderer, 'render')
      .mockImplementationOnce(async (...args) => {
        await held;
        return render(...args);
      });

    try {
      const first = await api(userToken).post(printPath('en')).expect(202);
      expect((first.body as ReportStatus).job?.state).toBe('running');

      const second = await api(userToken).post(printPath('ar')).expect(202);
      const queued = (second.body as ReportStatus).job;
      expect(queued).toMatchObject({ state: 'queued', queuePosition: 0 });

      // Print again while it waits: the same job, not a second one.
      const again = await api(userToken).post(printPath('ar')).expect(202);
      expect((again.body as ReportStatus).job).toMatchObject({
        state: 'queued',
        startedAt: queued?.startedAt,
      });
    } finally {
      release();
      spy.mockRestore();
    }

    expect(await settled('en')).toMatchObject({ state: 'fresh', job: null });
    expect(await settled('ar')).toMatchObject({ state: 'fresh', job: null });
  });

  it('reports a queued print whose server died as failed too', async () => {
    await controlPlane.query(
      `UPDATE "${schemaName}".report_cache
          SET job_state = 'queued', job_started_at = now() - interval '5 minutes',
              updated_at = now() - interval '5 minutes'
        WHERE project_id = $1 AND language = 'en'`,
      [projectId],
    );
    expect((await status()).job).toMatchObject({
      state: 'failed',
      error: 'interrupted',
      queuePosition: null,
    });
  });

  it('saving the company profile only reprints; it prints with the logo', async () => {
    // A real 1 × 1 PNG, so Chrome draws it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = await request(app.getHttpServer())
      .post('/files')
      .set('Authorization', `Bearer ${token}`)
      .field('purpose', 'logo')
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/company/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        arName: 'شركة التقارير',
        logoFileId: (upload.body as { id: string }).id,
      })
      .expect(200);
    expect(await status()).toMatchObject({ state: 'stale', hasSolve: true });
    expect(await status('ar')).toMatchObject({
      state: 'stale',
      hasSolve: true,
    });

    // Arabic (name + logo), printed from the stored solve. Last of the
    // print tests, so no later test depends on the report's state. Print
    // is limited per user and this suite spends a lot, so the admin's
    // count is cleared first (bug-112).
    await clearUserRateLimits(app, 'ReportsController.print', adminId);
    await api().post(printPath('ar')).expect(202);
    expect((await settled('ar')).state).toBe('fresh');
    const pdf = await api()
      .get(`/projects/${projectId}/reports/bar-optimiser/pdf?lang=ar`)
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('rejects an unknown language', async () => {
    await api().get(reportPath('fr')).expect(400);
  });

  it("refuses another company's project with 404", async () => {
    await api(otherToken).get(reportPath()).expect(404);
    await api(otherToken)
      .post(solvePath(), { optimiserVersion: OPTIMISER_VERSION })
      .expect(404);
    await api(otherToken).post(printPath()).expect(404);
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
