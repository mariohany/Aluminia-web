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
  type BarOptimiserReportResponse,
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
import { clearUserRateLimits } from './fixtures/clear-rate-limits';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import {
  dropPlatformCatalogue,
  seedPlatformCatalogue,
} from './fixtures/platform-catalogue';

/**
 * docs/reports_planing.md §7, docs/browser_solve_planing.md §7,
 * docs/browser_pdf_planing.md §7 — the bar optimiser report API: cutting
 * settings, status, the browser solve (this suite plays the browser: it
 * runs the real optimiser on the lines the API hands out and posts the
 * plans back), the checks on a result, the report snapshot the browser
 * draws the PDF from, refreshing names, staleness and isolation. The
 * server neither solves nor prints any more.
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
    }).compile();
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
  const basePath = () => `/projects/${projectId}/reports/bar-optimiser`;
  const solvePath = (step = '') => `${basePath()}/solve${step}`;

  async function status(as = token): Promise<ReportStatus> {
    const res = await api(as).get(basePath()).expect(200);
    return res.body as ReportStatus;
  }

  async function snapshot(as = token): Promise<BarOptimiserReportResponse> {
    const res = await api(as).get(`${basePath()}/report`).expect(200);
    return res.body as BarOptimiserReportResponse;
  }

  /** Starts a solve as `as`. The start is limited to 6 a minute per user,
   * and this suite starts more than that, so the count is cleared first
   * (bug-112). */
  async function startSolve(as = token): Promise<SolveStart> {
    await clearUserRateLimits(
      app,
      'ReportsController.startSolve',
      as === userToken ? userId : adminId,
    );
    const res = await api(as)
      .post(solvePath(), { optimiserVersion: OPTIMISER_VERSION })
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

  function sendResult(start: SolveStart, result: SolveResult) {
    return api().post(solvePath('/result'), {
      token: start.token,
      optimiserVersion: OPTIMISER_VERSION,
      ...result,
    });
  }

  /** Generate as the web does: start, solve, send. */
  async function generate(): Promise<ReportStatus> {
    const start = await startSolve();
    const res = await sendResult(start, await browserSolve(start)).expect(200);
    return res.body as ReportStatus;
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
    expect(await status()).toEqual({
      state: 'none',
      staleBecause: null,
      generatedAt: null,
      changedWindows: 0,
      summary: null,
      solve: null,
    });
    await api().get(`${basePath()}/report`).expect(404);
  });

  it('hands the browser the piece lines and a token, shows its progress, then saves its plans', async () => {
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

    // Progress, which is also the heartbeat; another user sees it (B5).
    const groups = start.status.solve!.groups.map((g, i) =>
      i === 0 ? { ...g, state: 'done' as const, profilesDone: 1 } : g,
    );
    await api()
      .put(solvePath('/progress'), { token: start.token, groups })
      .expect(204);
    expect((await status(userToken)).solve).toMatchObject({
      state: 'solving',
      startedByMe: false,
      startedByEmail: adminEmail,
      groups,
    });

    const sent = await sendResult(start, await browserSolve(start)).expect(200);
    const done = sent.body as ReportStatus;
    expect(done).toMatchObject({
      state: 'fresh',
      staleBecause: null,
      solve: null,
    });
    expect(done.generatedAt).not.toBeNull();
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
      }[]
    >(
      `SELECT solve_fingerprint, snapshot_fingerprint, result FROM "${schemaName}".report_solve WHERE project_id = $1`,
      [projectId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].solve_fingerprint).toHaveLength(64);
    expect(rows[0].snapshot_fingerprint).toHaveLength(64);
    const bars = rows[0].result.profiles.flatMap((p) => p.best ?? []);
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toEqual({
      stockMm: expect.any(Number) as number,
      pieces: expect.arrayContaining([expect.any(Number)]) as number[],
    });
  });

  it('hands out the snapshot to draw from, with the company as it is today (P6, P7)', async () => {
    const { report, company } = await snapshot();
    expect(report.summary.windowCount).toBe(2);
    expect(report.project.enName).toBe('Reports Project');
    expect(report.client?.enName).toBe('Reports Client');
    const plan = report.plans.find((p) => p.best?.bars.length);
    const piece = plan?.best?.bars[0].pieces[0];
    expect(piece?.windowName).toMatch(/^W-(fixed|sash)$/);
    expect(piece?.at).toHaveProperty('position');
    // docs/bar_waste_area_planing.md §3: areas, widths and mitre ends.
    for (const p of report.plans) {
      expect(p.faceWidthMm).toBeGreaterThan(0);
      for (const bar of p.best?.bars ?? []) {
        expect(bar.wasteMm2).toBe(Math.round(bar.wasteMm * p.faceWidthMm!));
        for (const x of bar.pieces) expect(x.endsMm).toHaveLength(2);
      }
    }
    const frame = report.plans.find((p) => p.member === 'frame');
    expect(
      frame?.best?.bars.flatMap((b) => b.pieces).some((x) => x.endsMm![0] > 0),
    ).toBe(true);
    expect(report.summary.total.wasteMm2).toBeGreaterThan(0);
    // The bars add up to their profile, the profiles to the total. Each
    // stored bar is a pattern of `count` bars (docs/report_speed_planing.md
    // §5), and they count every bar of the plan.
    let bars = 0;
    for (const p of report.plans) {
      const patterns = p.best?.bars ?? [];
      const own = patterns.reduce((n, b) => n + b.wasteMm2! * b.count!, 0);
      const summary = report.summary.profiles.find(
        (x) => x.profile === p.profile,
      )?.best;
      const barCount = patterns.reduce((n, b) => n + b.count!, 0);
      expect(barCount).toBe(summary?.barCount ?? 0);
      const pieces = patterns.reduce(
        (n, b) => n + b.goesTo!.reduce((m, g) => m + g.count, 0),
        0,
      );
      expect(pieces).toBe(
        patterns.reduce((n, b) => n + b.pieces.length * b.count!, 0),
      );
      expect(Math.abs(own - (summary?.wasteMm2 ?? 0))).toBeLessThanOrEqual(
        barCount,
      );
      bars += own;
    }
    expect(Math.abs(bars - report.summary.total.wasteMm2!)).toBeLessThanOrEqual(
      report.plans.length * 50,
    );
    // No company profile saved: the account name, no logo.
    expect(company).toEqual({
      enName: companyName,
      arName: null,
      logoFileId: null,
    });
  });

  it('a USER can read the report too', async () => {
    expect((await status(userToken)).state).toBe('fresh');
    await api(userToken).get(`${basePath()}/report`).expect(200);
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
    // The last good report is still there.
    expect((await status()).state).toBe('fresh');

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

  it('refuses tampered plans with 422 and ends the solve', async () => {
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

  it('a company profile change never makes the report stale; it shows at once (P7)', async () => {
    // A real 1 × 1 PNG.
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
    const logoFileId = (upload.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch('/company/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        enName: 'Reports Aluminium Co',
        arName: 'شركة التقارير',
        logoFileId,
      })
      .expect(200);

    expect((await status()).state).toBe('fresh');
    expect((await snapshot()).company).toEqual({
      enName: 'Reports Aluminium Co',
      arName: 'شركة التقارير',
      logoFileId,
    });
  });

  it('a project rename only needs the names refreshed, no solve (P8)', async () => {
    const before = await solvedAt();
    await request(app.getHttpServer())
      .patch(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enName: 'Reports Project 2' })
      .expect(200);
    expect(await status()).toMatchObject({
      state: 'stale',
      staleBecause: 'names',
      changedWindows: 0,
    });
    // Still drawn with the frozen name until refreshed (P6).
    expect((await snapshot()).report.project.enName).toBe('Reports Project');

    const res = await api().post(`${basePath()}/refresh`).expect(200);
    expect(res.body as ReportStatus).toMatchObject({
      state: 'fresh',
      staleBecause: null,
    });
    expect((await snapshot()).report.project.enName).toBe('Reports Project 2');
    expect(await solvedAt()).toBe(before);
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
    expect(s).toMatchObject({
      state: 'stale',
      staleBecause: 'solve',
      changedWindows: 1,
    });
    // The previous numbers stay readable while stale (D15).
    expect(s.summary?.unitCount).toBe(5);
    // A refresh can't fix a changed plan.
    const refused = await api().post(`${basePath()}/refresh`).expect(409);
    expect((refused.body as { code: string }).code).toBe(SolveRefusal.NO_SOLVE);

    const again = await generate();
    expect(again).toMatchObject({ state: 'fresh', solve: null });
    expect(again.summary?.unitCount).toBe(7);
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
      stockLengthsMm: [7000, 6500, 6000],
    });
    expect(await status()).toMatchObject({
      state: 'stale',
      staleBecause: 'solve',
    });

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

  it('no longer prints on the server (docs/browser_pdf_planing.md P5)', async () => {
    await api().post(`${basePath()}/print?lang=en`).expect(404);
    await api().get(`${basePath()}/pdf?lang=en`).expect(404);
  });

  it("refuses another company's project with 404", async () => {
    await api(otherToken).get(basePath()).expect(404);
    await api(otherToken).get(`${basePath()}/report`).expect(404);
    await api(otherToken).post(`${basePath()}/refresh`).expect(404);
    await api(otherToken)
      .post(solvePath(), { optimiserVersion: OPTIMISER_VERSION })
      .expect(404);
  });

  it('refuses a super admin (no company)', async () => {
    const res = await api(superToken).get(basePath());
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
