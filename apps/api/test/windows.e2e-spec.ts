import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import type { LoginResponse } from '@repo/types/auth';
import type { ClientDetail } from '@repo/types/clients';
import type { ProjectDetail } from '@repo/types/projects';
import type {
  WindowDetail,
  WindowPanelWindowDetail,
  WindowSummary,
} from '@repo/types/windows';
import type { CompanySystemProfileSummary } from '@repo/types/company-lookups';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';

// Every test in this file builds a WINDOW-only assembly (transom test
// cases land in docs/transom_tasks.md Step 2) — this is what every
// `res.body as ...` cast below actually asserts, so `.panels[0].
// sashProfile`/`.headShape`/etc. narrow without a `panelType` check at
// each of the many call sites that read one.
type WindowDetailAllWindows = Omit<WindowDetail, 'panels'> & {
  panels: WindowPanelWindowDetail[];
};

/**
 * docs/window_creation_planing.md + docs/window_assembly_planing.md —
 * a window is an ASSEMBLY of coupled panels. Real Postgres, real HTTP,
 * real /auth/login, genuinely provisioned schemas — same shape as
 * project-preferences.e2e-spec.ts, which this file's ScopedRef plumbing
 * borrows directly.
 *
 * Platform lookup rows are read straight out of the control plane
 * rather than fabricated; the company-scope counterpart is created
 * through the real `/company/lookups/*` endpoints. See
 * .wolf/cerebrum.md's e2e pattern note, 2026-08-15.
 */
describe('Windows (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyName = 'E2E Windows Aluminium';
  const adminEmail = 'e2e-windows-admin@test.local';
  const otherCompanyName = 'E2E Windows Other Co';
  const otherAdminEmail = 'e2e-windows-other@test.local';
  const password = 'TestPassword123!';

  let token: string;
  let otherToken: string;
  let clientId: string;
  let projectId: string;

  let platformFrameId: string;
  let platformSashId: string;
  let platformGlassId: string;
  let platformCatalogId: string;
  let platformTransomId: string;
  let companySashId: string;
  let colorId: string;

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
    await provisioning.provision({
      name: otherCompanyName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: otherAdminEmail, password },
    });

    token = await loginAs(adminEmail);
    otherToken = await loginAs(otherAdminEmail);

    const [frame]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_profile WHERE profile_type = 'frame' LIMIT 1`,
    );
    platformFrameId = frame.id;

    const [sash]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_profile WHERE profile_type = 'leaf' LIMIT 1`,
    );
    platformSashId = sash.id;

    const [glass]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM glass ORDER BY thickness ASC LIMIT 1`,
    );
    platformGlassId = glass.id;

    const [catalog]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_catalog LIMIT 1`,
    );
    platformCatalogId = catalog.id;

    const [transom]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_profile WHERE profile_type = 'transom' LIMIT 1`,
    );
    platformTransomId = transom.id;

    const [color]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM color LIMIT 1`,
    );
    colorId = color.id;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ enName: 'Windows Client' })
      .expect(201);
    clientId = (client.body as ClientDetail).id;

    const project = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, enName: 'Windows Project' })
      .expect(201);
    projectId = (project.body as ProjectDetail).id;

    const companySash = await request(app.getHttpServer())
      .post('/company/lookups/system-profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        catalog: `platform:${platformCatalogId}`,
        profileNo: 'E2E-SASH-01',
        profileType: 'leaf',
        maxGlassThickness: 24,
        weight: 1,
        perimeter: 100,
        inertiaIx: 1,
        inertiaIy: 1,
        acceptsFlyScreen: false,
      })
      .expect(201);
    companySashId = (companySash.body as CompanySystemProfileSummary).id;
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .delete(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmName: 'Windows Client' })
      .expect(204);
    await dropCompanies(controlPlane, [companyName, otherCompanyName]);
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  /** One WINDOW panel's worth of a valid request body — the schema is
   * now a discriminated union on `panelType` (docs/transom_planing.md),
   * so this has to be present for Zod to even pick a branch, not just
   * an extra field. */
  function panel(overrides: Record<string, unknown> = {}) {
    return {
      panelType: 'window',
      xMm: 0,
      yMm: 0,
      widthMm: 1200,
      heightMm: 1500,
      frameProfile: `platform:${platformFrameId}`,
      sashProfile: `platform:${platformSashId}`,
      hasFlyScreen: false,
      isDoor: false,
      glassKind: 'single',
      glass: `platform:${platformGlassId}`,
      // Flat/empty — the default every panel had before arch heads
      // existed. headShape/headRiseMm/bars are required (no `.default`
      // on the schema — see docs/arch_windows_planing.md's Step 4
      // finding), so every panel literal needs them explicitly now.
      headShape: 'flat',
      headRiseMm: null,
      bars: [],
      ...overrides,
    };
  }

  /** One TRANSOM panel's worth of a valid request body — attached to
   * `panel()`'s own right edge (docs/transom_tasks.md Step 2), matching
   * the neighbour's height and carrying its own width, per decision 7's
   * "right/left keeps the neighbour's height" rule. */
  function transomPanel(overrides: Record<string, unknown> = {}) {
    return {
      panelType: 'transom',
      xMm: 1200,
      yMm: 0,
      widthMm: 150,
      heightMm: 1500,
      transomProfile: `platform:${platformTransomId}`,
      glassKind: 'single',
      glass: `platform:${platformGlassId}`,
      ...overrides,
    };
  }

  function createWindow(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/windows')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId,
        name: 'W-01',
        quantity: 1,
        panels: [panel()],
        ...body,
      });
  }

  function patchWindow(id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/windows/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('creates a window with a platform frame and a company sash — cross-scope refs round-trip', async () => {
    const res = await createWindow({
      name: 'W-cross-scope',
      panels: [panel({ sashProfile: `company:${companySashId}` })],
    }).expect(201);
    const body = res.body as WindowDetailAllWindows;

    expect(body.projectId).toBe(projectId);
    expect(body.panels).toHaveLength(1);
    // The summary fields are the FIRST panel's — see WindowSummary.
    expect(body.frameProfile).toBe(`platform:${platformFrameId}`);
    expect(body.glassKind).toBe('single');
    expect(body.panels[0].sashProfile).toBe(`company:${companySashId}`);
    expect(body.panels[0].glass).toBe(`platform:${platformGlassId}`);
    expect(body.panels[0].interiorColor).toBeNull();
    expect(body.panels[0].exteriorColor).toBeNull();

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((fetched.body as WindowDetailAllWindows).panels[0].sashProfile).toBe(
      `company:${companySashId}`,
    );
  });

  it('round-trips nullable interior/exterior colours and location/notes', async () => {
    const res = await createWindow({
      name: 'W-colours',
      panels: [
        panel({
          interiorColor: `platform:${colorId}`,
          exteriorColor: `platform:${colorId}`,
        }),
      ],
      location: 'North elevation',
      notes: 'Handle on the left',
    }).expect(201);
    const body = res.body as WindowDetailAllWindows;

    expect(body.panels[0].interiorColor).toBe(`platform:${colorId}`);
    expect(body.panels[0].exteriorColor).toBe(`platform:${colorId}`);
    expect(body.location).toBe('North elevation');
    expect(body.notes).toBe('Handle on the left');
  });

  it('round-trips openingType per panel, defaults to null, and PATCHes', async () => {
    const created = await createWindow({ name: 'W-opening-type' }).expect(201);
    const body = created.body as WindowDetailAllWindows;
    expect(body.panels[0].openingType).toBeNull();

    const patched = await patchWindow(body.id, {
      panels: [panel({ openingType: 'side_hung_left' })],
    }).expect(200);
    expect((patched.body as WindowDetailAllWindows).panels[0].openingType).toBe(
      'side_hung_left',
    );

    const cleared = await patchWindow(body.id, {
      panels: [panel({ openingType: null })],
    }).expect(200);
    expect(
      (cleared.body as WindowDetailAllWindows).panels[0].openingType,
    ).toBeNull();
  });

  it('rejects an unknown openingType', async () => {
    await createWindow({
      name: 'W-bad-opening-type',
      panels: [panel({ openingType: 'diagonal_slide' })],
    }).expect(400);
  });

  // Arch heads and glazing bars — docs/arch_windows_planing.md §4.
  // headShape/headRiseMm/bars round-trip like every other panel field;
  // the interesting cases are the four structural rules on `bars`
  // (flat ⇔ null rise, bars only on a non-flat head, unique ids, every
  // anchor referencing something earlier in the array) and where they
  // actually get enforced — see the forward-reference test below.

  it('round-trips a segmental head with anchored and bowed bars', async () => {
    const res = await createWindow({
      name: 'W-arch-round-trip',
      panels: [
        panel({
          headShape: 'segmental',
          headRiseMm: 400,
          bars: [
            {
              id: 'b1',
              from: { on: 'sill', at: 0.5 },
              to: { on: 'arch', at: 0.5 },
              sagMm: 0,
            },
            {
              id: 'b2',
              from: { on: 'sill', at: 0.2 },
              to: { on: 'arch', at: 0.15 },
              sagMm: 0,
            },
            {
              id: 'b3',
              from: { on: 'b1', at: 0.5 },
              to: { on: 'b2', at: 0.5 },
              sagMm: 45,
            },
          ],
        }),
      ],
    }).expect(201);
    const body = res.body as WindowDetailAllWindows;

    expect(body.panels[0].headShape).toBe('segmental');
    expect(body.panels[0].headRiseMm).toBe(400);
    expect(body.panels[0].bars).toHaveLength(3);
    expect(body.panels[0].bars[2]).toEqual({
      id: 'b3',
      from: { on: 'b1', at: 0.5 },
      to: { on: 'b2', at: 0.5 },
      sagMm: 45,
    });

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((fetched.body as WindowDetailAllWindows).panels[0].bars).toEqual(
      body.panels[0].bars,
    );
  });

  it("normalises a round head's rise to widthMm / 2, ignoring whatever the client sent", async () => {
    const res = await createWindow({
      name: 'W-arch-round-normalize',
      panels: [panel({ widthMm: 1400, headShape: 'round', headRiseMm: 1 })],
    }).expect(201);
    expect((res.body as WindowDetailAllWindows).panels[0].headRiseMm).toBe(700);
  });

  it('rejects a bar that references a LATER bar — proves the schema catches it, not the service', async () => {
    // A single panel structurally cannot fail assertNoOverlap or
    // assertConnected (nothing to overlap or disconnect from), so any
    // 400 here can only have come from windowPanelSchema's superRefine
    // via the global ZodValidationPipe — proof the request never
    // reaches WindowsService.create's body unvalidated.
    await createWindow({
      name: 'W-arch-forward-ref',
      panels: [
        panel({
          headShape: 'segmental',
          headRiseMm: 400,
          bars: [
            {
              id: 'b1',
              from: { on: 'b2', at: 0.5 },
              to: { on: 'arch', at: 0.5 },
              sagMm: 0,
            },
            {
              id: 'b2',
              from: { on: 'sill', at: 0.5 },
              to: { on: 'arch', at: 0.2 },
              sagMm: 0,
            },
          ],
        }),
      ],
    }).expect(400);
  });

  it('rejects a bar anchored to a nonexistent id', async () => {
    await createWindow({
      name: 'W-arch-bad-ref',
      panels: [
        panel({
          headShape: 'round',
          headRiseMm: 700,
          bars: [
            {
              id: 'b1',
              from: { on: 'nope', at: 0.5 },
              to: { on: 'arch', at: 0.5 },
              sagMm: 0,
            },
          ],
        }),
      ],
    }).expect(400);
  });

  it('rejects bars on a flat head', async () => {
    await createWindow({
      name: 'W-arch-bars-on-flat',
      panels: [
        panel({
          bars: [
            {
              id: 'b1',
              from: { on: 'arch', at: 0.2 },
              to: { on: 'sill', at: 0.5 },
              sagMm: 0,
            },
          ],
        }),
      ],
    }).expect(400);
  });

  it('rejects duplicate bar ids within a panel', async () => {
    await createWindow({
      name: 'W-arch-dup-ids',
      panels: [
        panel({
          headShape: 'round',
          headRiseMm: 700,
          bars: [
            {
              id: 'b1',
              from: { on: 'arch', at: 0.2 },
              to: { on: 'sill', at: 0.5 },
              sagMm: 0,
            },
            {
              id: 'b1',
              from: { on: 'arch', at: 0.8 },
              to: { on: 'sill', at: 0.5 },
              sagMm: 0,
            },
          ],
        }),
      ],
    }).expect(400);
  });

  it("lists a project's windows as summaries, sorted by name", async () => {
    await createWindow({ name: 'W-list-b' }).expect(201);
    await createWindow({ name: 'W-list-a' }).expect(201);

    const res = await request(app.getHttpServer())
      .get('/windows')
      .query({ projectId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const names = (res.body as WindowSummary[])
      .map((w) => w.name)
      .filter((n) => n.startsWith('W-list'));
    expect(names).toEqual(['W-list-a', 'W-list-b']);
  });

  it('rejects a duplicate name within the same project with 409', async () => {
    await createWindow({ name: 'W-dup' }).expect(201);
    await createWindow({ name: 'W-dup' }).expect(409);
  });

  it('allows the same name in a different project — the index is scoped, not global', async () => {
    await createWindow({ name: 'W-shared-name' }).expect(201);

    const otherProject = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, enName: 'Second Windows Project' })
      .expect(201);
    const otherProjectId = (otherProject.body as ProjectDetail).id;

    await createWindow({
      projectId: otherProjectId,
      name: 'W-shared-name',
    }).expect(201);
  });

  it('rejects quantity 0', async () => {
    await createWindow({ name: 'W-bad-qty', quantity: 0 }).expect(400);
  });

  it('rejects a panel of width 0', async () => {
    await createWindow({
      name: 'W-bad-width',
      panels: [panel({ widthMm: 0 })],
    }).expect(400);
  });

  it('rejects a malformed ScopedRef', async () => {
    await createWindow({
      name: 'W-bad-ref',
      panels: [panel({ frameProfile: `foo:${platformFrameId}` })],
    }).expect(400);
  });

  it('rejects an unknown glassKind', async () => {
    await createWindow({
      name: 'W-bad-kind',
      panels: [panel({ glassKind: 'triple' })],
    }).expect(400);
  });

  it('rejects a panel missing glass, or missing glassKind', async () => {
    // glassKind and glass are one discriminated union at the storage
    // layer (CK_window_panels_glass_shape) — the panel schema requires
    // both, so neither can arrive alone any more.
    const { glass: _glass, ...noGlass } = panel();
    await createWindow({ name: 'W-no-glass', panels: [noGlass] }).expect(400);

    const { glassKind: _kind, ...noKind } = panel();
    await createWindow({ name: 'W-no-kind', panels: [noKind] }).expect(400);
  });

  it('PATCHes name alone, leaving every other field untouched', async () => {
    const created = await createWindow({
      name: 'W-patch-name',
      notes: 'original notes',
    }).expect(201);
    const id = (created.body as WindowDetailAllWindows).id;

    const patched = await patchWindow(id, {
      name: 'W-patch-name-renamed',
    }).expect(200);
    const body = patched.body as WindowDetailAllWindows;

    expect(body.name).toBe('W-patch-name-renamed');
    expect(body.notes).toBe('original notes');
    expect(body.panels).toHaveLength(1);
    expect(body.panels[0].glass).toBe(`platform:${platformGlassId}`);
  });

  it('deleting the project cascades its windows away', async () => {
    const scratchProject = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId, enName: 'Scratch Cascade Project' })
      .expect(201);
    const scratchProjectId = (scratchProject.body as ProjectDetail).id;

    const scratchWindow = await createWindow({
      projectId: scratchProjectId,
      name: 'W-cascade',
    }).expect(201);
    const scratchWindowId = (scratchWindow.body as WindowDetailAllWindows).id;

    await request(app.getHttpServer())
      .delete(`/projects/${scratchProjectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmName: 'Scratch Cascade Project' })
      .expect(204);

    await request(app.getHttpServer())
      .get(`/windows/${scratchWindowId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it("refuses company B every operation on company A's window, with 404 not 403", async () => {
    const created = await createWindow({ name: 'W-isolation' }).expect(201);
    const id = (created.body as WindowDetailAllWindows).id;

    await request(app.getHttpServer())
      .get(`/windows/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/windows/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/windows/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  // ---- Assembly invariants (docs/window_assembly_planing.md §1) ----

  it('round-trips a multi-panel assembly and derives the overall size', async () => {
    const res = await createWindow({
      name: 'W-assembly',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1200, heightMm: 1500 }),
        panel({ xMm: 1200, yMm: 0, widthMm: 800, heightMm: 1500 }),
      ],
    }).expect(201);
    const body = res.body as WindowDetailAllWindows;

    expect(body.panels).toHaveLength(2);
    expect(body.panels).toHaveLength(2);
    // Derived from the bounding box, never taken from the request.
    expect(body.widthMm).toBe(2000);
    expect(body.heightMm).toBe(1500);
    expect(body.panels[1].xMm).toBe(1200);

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const refetched = fetched.body as WindowDetailAllWindows;
    expect(refetched.panels.map((p) => p.xMm)).toEqual([0, 1200]);
    expect(refetched.widthMm).toBe(2000);
  });

  it('accepts a stepped, non-rectangular outline — the UI flags it, the API does not', async () => {
    const res = await createWindow({
      name: 'W-l-shape',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1000, heightMm: 1000 }),
        panel({ xMm: 1000, yMm: 0, widthMm: 1000, heightMm: 600 }),
      ],
    }).expect(201);
    const body = res.body as WindowDetailAllWindows;
    expect(body.widthMm).toBe(2000);
    expect(body.heightMm).toBe(1000);
  });

  it('normalises the origin rather than rejecting an offset assembly', async () => {
    const res = await createWindow({
      name: 'W-offset',
      panels: [
        panel({ xMm: 500, yMm: 300, widthMm: 1000, heightMm: 1000 }),
        panel({ xMm: 1500, yMm: 300, widthMm: 1000, heightMm: 1000 }),
      ],
    }).expect(201);
    const body = res.body as WindowDetailAllWindows;

    expect(body.panels.map((p) => p.xMm)).toEqual([0, 1000]);
    expect(body.panels.map((p) => p.yMm)).toEqual([0, 0]);
    expect(body.widthMm).toBe(2000);
    expect(body.heightMm).toBe(1000);
  });

  it('rejects overlapping panels', async () => {
    await createWindow({
      name: 'W-overlap',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1200, heightMm: 1500 }),
        panel({ xMm: 600, yMm: 0, widthMm: 1200, heightMm: 1500 }),
      ],
    }).expect(400);
  });

  it('rejects a panel detached from the rest', async () => {
    await createWindow({
      name: 'W-detached',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1000, heightMm: 1000 }),
        panel({ xMm: 2000, yMm: 0, widthMm: 1000, heightMm: 1000 }),
      ],
    }).expect(400);
  });

  it('rejects panels touching only at a corner — a point is not a joint', async () => {
    await createWindow({
      name: 'W-corner',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1000, heightMm: 1000 }),
        panel({ xMm: 1000, yMm: 1000, widthMm: 1000, heightMm: 1000 }),
      ],
    }).expect(400);
  });

  it('rejects an empty panel list', async () => {
    await createWindow({ name: 'W-no-panels', panels: [] }).expect(400);
  });

  it('PATCHing panels replaces the whole set and re-derives the size', async () => {
    const created = await createWindow({
      name: 'W-replace',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1000, heightMm: 1000 }),
        panel({ xMm: 1000, yMm: 0, widthMm: 1000, heightMm: 1000 }),
      ],
    }).expect(201);
    const id = (created.body as WindowDetailAllWindows).id;
    expect((created.body as WindowDetailAllWindows).widthMm).toBe(2000);

    const patched = await patchWindow(id, {
      panels: [panel({ xMm: 0, yMm: 0, widthMm: 900, heightMm: 800 })],
    }).expect(200);
    const body = patched.body as WindowDetailAllWindows;

    expect(body.panels).toHaveLength(1);
    expect(body.panels).toHaveLength(1);
    expect(body.widthMm).toBe(900);
    expect(body.heightMm).toBe(800);
  });

  it('deleting a window cascades its panel rows away', async () => {
    const created = await createWindow({
      name: 'W-panel-cascade',
      panels: [
        panel({ xMm: 0, yMm: 0, widthMm: 1000, heightMm: 1000 }),
        panel({ xMm: 1000, yMm: 0, widthMm: 1000, heightMm: 1000 }),
      ],
    }).expect(201);
    const id = (created.body as WindowDetailAllWindows).id;

    const schema = await schemaNameFor(controlPlane, companyName);
    const before: Array<{ count: string }> = await controlPlane.query(
      `SELECT count(*) FROM "${schema}"."window_panels" WHERE window_id = $1`,
      [id],
    );
    expect(Number(before[0].count)).toBe(2);

    await request(app.getHttpServer())
      .delete(`/windows/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const after: Array<{ count: string }> = await controlPlane.query(
      `SELECT count(*) FROM "${schema}"."window_panels" WHERE window_id = $1`,
      [id],
    );
    expect(Number(after[0].count)).toBe(0);
  });

  it('records the authenticated caller as the author', async () => {
    const created = await createWindow({ name: 'W-author' }).expect(201);
    const body = created.body as WindowDetailAllWindows;
    expect(body.createdByUserId).toEqual(expect.any(String));
    expect(body.createdByUserId.length).toBeGreaterThan(0);
  });

  it('accepts a minimal valid transom panel attached to a window panel', async () => {
    const created = await createWindow({
      name: 'W-transom-minimal',
      panels: [panel(), transomPanel()],
    }).expect(201);
    const body = created.body as WindowDetail;
    expect(body.panels).toHaveLength(2);
    // The assembly's overall size is the bounding box of both panels —
    // the transom's own 150mm sits to the right of the window's 1200mm.
    expect(body.widthMm).toBe(1350);
    expect(body.heightMm).toBe(1500);

    const transom = body.panels[1];
    expect(transom.panelType).toBe('transom');
    if (transom.panelType !== 'transom') throw new Error('unreachable');
    expect(transom.transomProfile).toBe(`platform:${platformTransomId}`);
    // Nothing window-only leaks onto a transom row — `sashProfile`
    // isn't even a field on `WindowPanelTransomDetail`, so this checks
    // the ACTUAL response body, not just the type.
    expect(
      (transom as unknown as Record<string, unknown>).sashProfile,
    ).toBeUndefined();

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((fetched.body as WindowDetail).panels[1].panelType).toBe('transom');
  });

  it('rejects a transom panel carrying a sashProfile', async () => {
    await createWindow({
      name: 'W-transom-bad-sash',
      panels: [
        panel(),
        transomPanel({ sashProfile: `platform:${platformSashId}` }),
      ],
    }).expect(400);
  });

  it('rejects a transom panel missing transomProfile', async () => {
    const incomplete: Record<string, unknown> = transomPanel();
    delete incomplete.transomProfile;
    await createWindow({
      name: 'W-transom-missing-profile',
      panels: [panel(), incomplete],
    }).expect(400);
  });
});

async function schemaNameFor(
  controlPlane: DataSource,
  name: string,
): Promise<string> {
  const rows: Array<{ schema_name: string }> = await controlPlane.query(
    `SELECT schema_name FROM companies WHERE name = $1`,
    [name],
  );
  return rows[0].schema_name;
}

async function dropCompanies(controlPlane: DataSource, names: string[]) {
  for (const name of names) {
    const companies: Array<{ id: string; schema_name: string }> =
      await controlPlane.query(
        `SELECT id, schema_name FROM companies WHERE name = $1`,
        [name],
      );
    for (const company of companies) {
      await controlPlane.query(
        `DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`,
      );
      await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
        company.id,
      ]);
      await controlPlane.query(`DELETE FROM billing WHERE company_id = $1`, [
        company.id,
      ]);
      await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
        company.id,
      ]);
    }
  }
}
