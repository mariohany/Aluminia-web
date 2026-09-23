import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import type { LoginResponse } from '@repo/types/auth';
import type { ClientDetail } from '@repo/types/clients';
import type { ProjectDetail } from '@repo/types/projects';
import type { WindowDetail, WindowSummary } from '@repo/types/windows';
import type { CompanySystemProfileSummary } from '@repo/types/company-lookups';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';

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
  let platformBeadId: string;
  let platformGlassId: string;
  let platformCatalogId: string;
  let platformDividerId: string;
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

    const [bead]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_profile WHERE profile_type = 'glass_beading' LIMIT 1`,
    );
    platformBeadId = bead.id;

    const [glass]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM glass ORDER BY thickness ASC LIMIT 1`,
    );
    platformGlassId = glass.id;

    const [catalog]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_catalog LIMIT 1`,
    );
    platformCatalogId = catalog.id;

    // A divider (mullion/transom) is one `ProfileType.TRANSOM` profile
    // (docs/sections_planing.md decision 4) — the exact same catalogue
    // category the old coupled transom panel drew its bar from.
    const [divider]: { id: string }[] = await controlPlane.query(
      `SELECT id FROM system_profile WHERE profile_type = 'transom' LIMIT 1`,
    );
    platformDividerId = divider.id;

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
    // A leaf never carries a rail count, whatever the catalogue
    // (docs/sliding_windows_planing.md §11) — the profile tests in
    // company-lookups.e2e-spec.ts cover the frame side.
    expect(
      (companySash.body as CompanySystemProfileSummary).slidingRails,
    ).toBeNull();
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

  /** One section's worth of a valid request body — opening, by default,
   * with a real sash so every existing (pre-sections) test that never
   * mentions sections at all still gets a fully-drawn window. */
  function section(overrides: Record<string, unknown> = {}) {
    return {
      row: 0,
      col: 0,
      kind: 'opening',
      sashProfile: `platform:${platformSashId}`,
      beadProfile: null,
      openingType: null,
      glassKind: 'single',
      glass: `platform:${platformGlassId}`,
      hasFlyScreen: false,
      // Required-but-nullable: null for every hinged/curtain-wall
      // section and for a fixed sliding light (docs/sliding_windows_planing.md
      // decision 6). The sliding tests below override it with a real
      // layout — on the SECTION since §12, so a sliding panel can be
      // gridded.
      sliding: null,
      ...overrides,
    };
  }

  /** One panel's worth of a valid request body — a 1×1 grid (a single
   * section covering the whole frame) unless `overrides` supplies its
   * own `columnWidths`/`rowHeights`/`sections`/`dividerProfile`. Reads
   * `widthMm`/`heightMm` from `overrides` (if given) before building the
   * default 1×1 grid, so `panel({ widthMm: 0 })`-style single-field
   * overrides still produce an internally-consistent grid. */
  function panel(overrides: Record<string, unknown> = {}) {
    const widthMm =
      'widthMm' in overrides ? (overrides.widthMm as number) : 1200;
    const heightMm =
      'heightMm' in overrides ? (overrides.heightMm as number) : 1500;
    return {
      xMm: 0,
      yMm: 0,
      widthMm,
      heightMm,
      frameProfile: `platform:${platformFrameId}`,
      dividerProfile: null,
      columnWidths: [widthMm],
      rowHeights: [heightMm],
      sections: [section()],
      isDoor: false,
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

  /** A sliding layout in request shape — rail per sash, left → right,
   * every sash `auto` with the opening type the neighbour rule gives
   * it (decision 7), so the schema's "auto agrees with the rails"
   * check passes by construction. Negative tests override single
   * sashes from here. No rail COUNT: that's the frame profile's
   * (planing §11, decision 13), not the layout's. */
  function slidingLayout(sashRails: number[]) {
    const typeFor = (i: number) => {
      const left = i > 0 && sashRails[i - 1] !== sashRails[i];
      const right =
        i < sashRails.length - 1 && sashRails[i + 1] !== sashRails[i];
      if (left && right) return 'free_sliding';
      if (left) return 'sliding_left';
      return 'sliding_right';
    };
    return {
      sashes: sashRails.map((rail, i) => ({
        rail,
        openingType: typeFor(i),
        directionSource: 'auto',
      })),
    };
  }

  /** A 1×1 panel whose single opening section carries `layout`. */
  function slidingPanel(layout: unknown) {
    return panel({ sections: [section({ sliding: layout })] });
  }

  /** A panel split into two columns by one divider — the "+ → Mullion"
   * shape from docs/sections_planing.md: a real opening section (0,0)
   * and a real fixed section (0,1), sums matching the panel's own size.
   * Every negative grid test starts from this valid shape and breaks
   * exactly one rule, so a 400 can only mean the rule under test. */
  function gridPanel(overrides: Record<string, unknown> = {}) {
    return panel({
      dividerProfile: `platform:${platformDividerId}`,
      columnWidths: [600, 600],
      rowHeights: [1500],
      sections: [
        section({ row: 0, col: 0 }),
        section({
          row: 0,
          col: 1,
          kind: 'fixed',
          sashProfile: null,
          beadProfile: `platform:${platformBeadId}`,
          openingType: null,
          hasFlyScreen: false,
        }),
      ],
      ...overrides,
    });
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
      panels: [
        panel({
          sections: [section({ sashProfile: `company:${companySashId}` })],
        }),
      ],
    }).expect(201);
    const body = res.body as WindowDetail;

    expect(body.projectId).toBe(projectId);
    expect(body.panels).toHaveLength(1);
    // The summary fields are the FIRST panel's frame and its FIRST
    // (row 0, col 0) section's glass — see WindowSummary.
    expect(body.frameProfile).toBe(`platform:${platformFrameId}`);
    expect(body.glassKind).toBe('single');
    expect(body.panels[0].sections[0].sashProfile).toBe(
      `company:${companySashId}`,
    );
    expect(body.panels[0].sections[0].glass).toBe(
      `platform:${platformGlassId}`,
    );
    expect(body.panels[0].interiorColor).toBeNull();
    expect(body.panels[0].exteriorColor).toBeNull();

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (fetched.body as WindowDetail).panels[0].sections[0].sashProfile,
    ).toBe(`company:${companySashId}`);
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
    const body = res.body as WindowDetail;

    expect(body.panels[0].interiorColor).toBe(`platform:${colorId}`);
    expect(body.panels[0].exteriorColor).toBe(`platform:${colorId}`);
    expect(body.location).toBe('North elevation');
    expect(body.notes).toBe('Handle on the left');
  });

  it('round-trips openingType per section, defaults to null, and PATCHes', async () => {
    const created = await createWindow({ name: 'W-opening-type' }).expect(201);
    const body = created.body as WindowDetail;
    expect(body.panels[0].sections[0].openingType).toBeNull();

    const patched = await patchWindow(body.id, {
      panels: [
        panel({ sections: [section({ openingType: 'side_hung_left' })] }),
      ],
    }).expect(200);
    expect(
      (patched.body as WindowDetail).panels[0].sections[0].openingType,
    ).toBe('side_hung_left');

    const cleared = await patchWindow(body.id, {
      panels: [panel({ sections: [section({ openingType: null })] })],
    }).expect(200);
    expect(
      (cleared.body as WindowDetail).panels[0].sections[0].openingType,
    ).toBeNull();
  });

  it('rejects an unknown openingType', async () => {
    await createWindow({
      name: 'W-bad-opening-type',
      panels: [
        panel({ sections: [section({ openingType: 'diagonal_slide' })] }),
      ],
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
    const body = res.body as WindowDetail;

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
    expect((fetched.body as WindowDetail).panels[0].bars).toEqual(
      body.panels[0].bars,
    );
  });

  it("normalises a round head's rise to widthMm / 2, ignoring whatever the client sent", async () => {
    const res = await createWindow({
      name: 'W-arch-round-normalize',
      panels: [panel({ widthMm: 1400, headShape: 'round', headRiseMm: 1 })],
    }).expect(201);
    expect((res.body as WindowDetail).panels[0].headRiseMm).toBe(700);
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
      panels: [panel({ sections: [section({ glassKind: 'triple' })] })],
    }).expect(400);
  });

  it('rejects a section missing glass, or missing glassKind', async () => {
    // glassKind and glass are one discriminated union at the storage
    // layer (CK_window_sections_glass_shape) — the section schema
    // requires both, so neither can arrive alone any more.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { glass: _glass, ...noGlass } = section();
    await createWindow({
      name: 'W-no-glass',
      panels: [panel({ sections: [noGlass] })],
    }).expect(400);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { glassKind: _kind, ...noKind } = section();
    await createWindow({
      name: 'W-no-kind',
      panels: [panel({ sections: [noKind] })],
    }).expect(400);
  });

  it('PATCHes name alone, leaving every other field untouched', async () => {
    const created = await createWindow({
      name: 'W-patch-name',
      notes: 'original notes',
    }).expect(201);
    const id = (created.body as WindowDetail).id;

    const patched = await patchWindow(id, {
      name: 'W-patch-name-renamed',
    }).expect(200);
    const body = patched.body as WindowDetail;

    expect(body.name).toBe('W-patch-name-renamed');
    expect(body.notes).toBe('original notes');
    expect(body.panels).toHaveLength(1);
    expect(body.panels[0].sections[0].glass).toBe(
      `platform:${platformGlassId}`,
    );
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
    const scratchWindowId = (scratchWindow.body as WindowDetail).id;

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
    const id = (created.body as WindowDetail).id;

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
    const body = res.body as WindowDetail;

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
    const refetched = fetched.body as WindowDetail;
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
    const body = res.body as WindowDetail;
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
    const body = res.body as WindowDetail;

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
    const id = (created.body as WindowDetail).id;
    expect((created.body as WindowDetail).widthMm).toBe(2000);

    const patched = await patchWindow(id, {
      panels: [panel({ xMm: 0, yMm: 0, widthMm: 900, heightMm: 800 })],
    }).expect(200);
    const body = patched.body as WindowDetail;

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
    const id = (created.body as WindowDetail).id;

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
    const body = created.body as WindowDetail;
    expect(body.createdByUserId).toEqual(expect.any(String));
    expect(body.createdByUserId.length).toBeGreaterThan(0);
  });

  // ---- Sections (docs/sections_planing.md) — replaces the old coupled
  // transom panel: a divider now grows the SAME panel and splits its
  // opening into a fixed + opening pair, rather than coupling a second
  // frame beside it.

  it('saves and reads back a 1×2 panel with a fixed and an opening section', async () => {
    const created = await createWindow({
      name: 'W-sections-grid',
      panels: [gridPanel()],
    }).expect(201);
    const body = created.body as WindowDetail;

    // A divider inside one panel, not a second coupled frame — the
    // assembly's overall size is exactly the one panel's own.
    expect(body.panels).toHaveLength(1);
    expect(body.widthMm).toBe(1200);
    expect(body.heightMm).toBe(1500);

    const panel0 = body.panels[0];
    expect(panel0.dividerProfile).toBe(`platform:${platformDividerId}`);
    expect(panel0.columnWidths).toEqual([600, 600]);
    expect(panel0.rowHeights).toEqual([1500]);
    expect(panel0.sections).toHaveLength(2);
    expect(panel0.sections[0].kind).toBe('opening');
    expect(panel0.sections[0].sashProfile).toBe(`platform:${platformSashId}`);
    expect(panel0.sections[1].kind).toBe('fixed');
    expect(panel0.sections[1].sashProfile).toBeNull();
    expect(panel0.sections[1].beadProfile).toBe(`platform:${platformBeadId}`);
    expect(panel0.sections[1].openingType).toBeNull();

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((fetched.body as WindowDetail).panels[0].sections).toHaveLength(2);
  });

  it('rejects columnWidths/rowHeights that do not sum to the panel size', async () => {
    await createWindow({
      name: 'W-grid-sum-mismatch',
      panels: [gridPanel({ columnWidths: [600, 700] })],
    }).expect(400);
  });

  it('rejects a gridded panel missing a divider profile', async () => {
    await createWindow({
      name: 'W-grid-no-divider',
      panels: [gridPanel({ dividerProfile: null })],
    }).expect(400);
  });

  it('rejects an opening section without a sash profile', async () => {
    await createWindow({
      name: 'W-section-opening-no-sash',
      panels: [panel({ sections: [section({ sashProfile: null })] })],
    }).expect(400);
  });

  it('rejects a fixed section carrying a sash profile', async () => {
    // `kind: 'fixed'` alone, sashProfile left at section()'s default —
    // exactly the shape decision 11 forbids.
    await createWindow({
      name: 'W-section-fixed-with-sash',
      panels: [panel({ sections: [section({ kind: 'fixed' })] })],
    }).expect(400);
  });

  it('rejects a fixed section without a glass beading profile', async () => {
    await createWindow({
      name: 'W-section-fixed-no-bead',
      panels: [
        panel({
          sections: [
            section({ kind: 'fixed', sashProfile: null, beadProfile: null }),
          ],
        }),
      ],
    }).expect(400);
  });

  it('rejects an opening section carrying a glass beading profile', async () => {
    await createWindow({
      name: 'W-section-opening-with-bead',
      panels: [
        panel({
          sections: [section({ beadProfile: `platform:${platformBeadId}` })],
        }),
      ],
    }).expect(400);
  });

  it('rejects an arched head on a panel with more than one column', async () => {
    await createWindow({
      name: 'W-grid-arch-two-cols',
      panels: [gridPanel({ headShape: 'segmental', headRiseMm: 400 })],
    }).expect(400);
  });

  // ---- Sliding layouts (docs/sliding_windows_planing.md §3) -------------

  it('round-trips a 3-sash / 2-rail sliding layout and PATCHes it', async () => {
    const created = await createWindow({
      name: 'W-sliding-3-sash',
      panels: [slidingPanel(slidingLayout([0, 1, 0]))],
    }).expect(201);
    const body = created.body as WindowDetail;
    expect(body.panels[0].sections[0].sliding).toEqual({
      sashes: [
        { rail: 0, openingType: 'sliding_right', directionSource: 'auto' },
        { rail: 1, openingType: 'free_sliding', directionSource: 'auto' },
        { rail: 0, openingType: 'sliding_left', directionSource: 'auto' },
      ],
    });

    const fetched = await request(app.getHttpServer())
      .get(`/windows/${body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (fetched.body as WindowDetail).panels[0].sections[0].sliding?.sashes,
    ).toHaveLength(3);

    // A manual override survives the round trip verbatim — the API
    // stores what the user picked, it does not re-derive (decision 7).
    const manual = slidingLayout([0, 1]);
    manual.sashes[0] = {
      rail: 0,
      openingType: 'sliding_right',
      directionSource: 'manual',
    };
    const patched = await patchWindow(body.id, {
      panels: [slidingPanel(manual)],
    }).expect(200);
    expect(
      (patched.body as WindowDetail).panels[0].sections[0].sliding,
    ).toEqual(manual);
  });

  it('accepts sliding: null (a legacy or fixed sliding frame) and reads it back as null', async () => {
    const created = await createWindow({
      name: 'W-sliding-null',
      panels: [slidingPanel(null)],
    }).expect(201);
    expect(
      (created.body as WindowDetail).panels[0].sections[0].sliding,
    ).toBeNull();
  });

  it("bounds a sash rail by the global maximum only — the frame profile check is the editor's", async () => {
    // The API doesn't resolve the frame profile's rail count
    // (planing §11, decision 13), so rail 3 (a 4-rail frame's front)
    // is accepted here whatever profile the panel points at, and only
    // rail 4+ is refused.
    await createWindow({
      name: 'W-sliding-rail-max',
      panels: [slidingPanel(slidingLayout([0, 3]))],
    }).expect(201);
    await createWindow({
      name: 'W-sliding-rail-out-of-range',
      panels: [slidingPanel(slidingLayout([0, 4]))],
    }).expect(400);
  });

  it('rejects a layout that still carries a rail count', async () => {
    await createWindow({
      name: 'W-sliding-rails-key',
      panels: [slidingPanel({ rails: 2, ...slidingLayout([0, 1]) })],
    }).expect(400);
  });

  it('rejects an auto sash whose stored opening type disagrees with the rails', async () => {
    const layout = slidingLayout([0, 1]);
    // Sash 1 has its only different-rail neighbour on the RIGHT, so
    // auto must be sliding_right — a client sending sliding_left with
    // directionSource 'auto' is lying about the derivation.
    layout.sashes[0].openingType = 'sliding_left';
    await createWindow({
      name: 'W-sliding-auto-disagrees',
      panels: [slidingPanel(layout)],
    }).expect(400);
  });

  it('rejects a blocked layout — two sashes on the same rail cannot slide', async () => {
    await createWindow({
      name: 'W-sliding-blocked',
      panels: [slidingPanel(slidingLayout([0, 0]))],
    }).expect(400);
  });

  it('rejects a manual sash that slides into the frame or into a same-rail neighbour', async () => {
    const intoFrame = slidingLayout([0, 1]);
    intoFrame.sashes[0] = {
      rail: 0,
      openingType: 'sliding_left',
      directionSource: 'manual',
    };
    await createWindow({
      name: 'W-sliding-into-frame',
      panels: [slidingPanel(intoFrame)],
    }).expect(400);

    const intoNeighbour = slidingLayout([0, 1, 1, 0]);
    intoNeighbour.sashes[1] = {
      rail: 1,
      openingType: 'sliding_right',
      directionSource: 'manual',
    };
    await createWindow({
      name: 'W-sliding-into-neighbour',
      panels: [slidingPanel(intoNeighbour)],
    }).expect(400);
  });

  it("accepts a layout that leaves a rail unused — the empty-rail warning is the editor's", async () => {
    // [0, 2] uses rails 1 and 3 of a 3+-rail frame and skips the middle
    // one; buildable (both slide toward each other), so it saves.
    const created = await createWindow({
      name: 'W-sliding-empty-rail',
      panels: [slidingPanel(slidingLayout([0, 2]))],
    }).expect(201);
    expect(
      (created.body as WindowDetail).panels[0].sections[0].sliding?.sashes.map(
        (s) => s.rail,
      ),
    ).toEqual([0, 2]);
  });

  it('accepts a divided sliding panel — a sliding section next to a fixed one (§12) — and reads each section back', async () => {
    // gridPanel's own shape: opening (0,0) + fixed (0,1); the opening
    // one carries the layout, the fixed one none.
    const created = await createWindow({
      name: 'W-sliding-on-grid',
      panels: [
        gridPanel({
          sections: [
            section({ row: 0, col: 0, sliding: slidingLayout([0, 1]) }),
            section({
              row: 0,
              col: 1,
              kind: 'fixed',
              sashProfile: null,
              beadProfile: `platform:${platformBeadId}`,
              openingType: null,
              hasFlyScreen: false,
            }),
          ],
        }),
      ],
    }).expect(201);
    const sections = (created.body as WindowDetail).panels[0].sections;
    expect(sections[0].sliding?.sashes.map((s) => s.rail)).toEqual([0, 1]);
    expect(sections[1].sliding).toBeNull();
  });

  it('accepts two sliding sections in one panel (§12: any mix)', async () => {
    const created = await createWindow({
      name: 'W-sliding-two-sections',
      panels: [
        gridPanel({
          sections: [
            section({ row: 0, col: 0, sliding: slidingLayout([0, 1]) }),
            section({ row: 0, col: 1, sliding: slidingLayout([1, 0, 1]) }),
          ],
        }),
      ],
    }).expect(201);
    const sections = (created.body as WindowDetail).panels[0].sections;
    expect(sections.map((s) => s.sliding?.sashes.length)).toEqual([2, 3]);
  });

  it('rejects a sliding layout on a fixed section', async () => {
    await createWindow({
      name: 'W-sliding-on-fixed',
      panels: [
        panel({
          sections: [
            section({
              kind: 'fixed',
              sashProfile: null,
              beadProfile: `platform:${platformBeadId}`,
              sliding: slidingLayout([0, 1]),
            }),
          ],
        }),
      ],
    }).expect(400);
  });

  it('rejects sash counts outside 2..8', async () => {
    await createWindow({
      name: 'W-sliding-one-sash',
      panels: [slidingPanel(slidingLayout([0]))],
    }).expect(400);
    await createWindow({
      name: 'W-sliding-nine-sashes',
      panels: [slidingPanel(slidingLayout([0, 1, 0, 1, 0, 1, 0, 1, 0]))],
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
