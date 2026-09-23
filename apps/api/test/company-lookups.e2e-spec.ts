import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import type { LoginResponse } from '@repo/types/auth';
import type {
  CompanyColorSummary,
  CompanyGlassSummary,
  CompanySystemBrandSummary,
  CompanySystemCatalogSummary,
  CompanySystemProfileSummary,
} from '@repo/types/company-lookups';
import type {
  BulkDeleteResult,
  SystemProfileSummary,
} from '@repo/types/lookups';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Phase 2 of Company Lookups (docs/company_lookups_planing.md) — the
 * same real-Postgres, real-HTTP, two-genuinely-provisioned-schemas
 * approach as clients-projects-isolation.e2e-spec.ts, extended to cover
 * this feature's two new rules that test proves nothing about:
 * platform-vs-company collision (a control-plane read, not a tenant
 * one) and cross-scope parent references (a company row pointing at
 * either scope).
 */
describe('Company lookups (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const companyOneName = 'E2E CL Alpha Aluminium';
  const companyTwoName = 'E2E CL Beta Glazing';
  const adminEmail = 'e2e-cl-admin@test.local';
  const userEmail = 'e2e-cl-user@test.local';
  const adminTwoEmail = 'e2e-cl-beta-admin@test.local';
  const superAdminEmail = 'e2e-cl-super@test.local';
  const password = 'TestPassword123!';

  let tokenAdmin: string;
  let tokenUser: string;
  let tokenBeta: string;
  let tokenSuper: string;

  let platformGlassId: string;
  let platformGlassName: string;
  let platformColorId: string;
  let platformColorCode: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    const passwordService = app.get(PasswordService);

    const { company } = await provisioning.provision({
      name: companyOneName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminEmail, password },
    });
    await provisioning.provision({
      name: companyTwoName,
      plan: 'starter',
      maxUsers: 5,
      admin: { email: adminTwoEmail, password },
    });

    // A plain USER seat on company one — bulk-writing here is exactly
    // what proves "any company user", not just the admin.
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [
        userEmail,
        await passwordService.hash(password),
        UserRole.USER,
        company.id,
      ],
    );
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [
        superAdminEmail,
        await passwordService.hash(password),
        UserRole.SUPER_ADMIN,
      ],
    );

    tokenAdmin = await loginAs(adminEmail);
    tokenUser = await loginAs(userEmail);
    tokenBeta = await loginAs(adminTwoEmail);
    tokenSuper = await loginAs(superAdminEmail);

    // Real platform rows this whole file collides against / references —
    // seeded by AddLookupTables' own data, not fixtures this file owns.
    const [glass]: { id: string; name: string }[] = await controlPlane.query(
      `SELECT id, name FROM glass ORDER BY name ASC LIMIT 1`,
    );
    platformGlassId = glass.id;
    platformGlassName = glass.name;
    const [color]: { id: string; code: string }[] = await controlPlane.query(
      `SELECT id, code FROM color ORDER BY code ASC LIMIT 1`,
    );
    platformColorId = color.id;
    platformColorCode = color.code;
  });

  afterAll(async () => {
    await dropCompanies(controlPlane, [companyOneName, companyTwoName]);
    // The super admin writes audit rows (the profile-rails case below
    // creates/updates platform profiles as them) — those reference the
    // user, so they go first or the user delete trips the FK.
    await controlPlane.query(
      `DELETE FROM admin_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[userEmail, superAdminEmail]],
    );
    await controlPlane.query(
      `DELETE FROM users WHERE email = ANY($1::text[])`,
      [[userEmail, superAdminEmail]],
    );
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  it('lets a plain USER seat write, not just the company admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/company/lookups/glass')
      .set('Authorization', `Bearer ${tokenUser}`)
      .send({
        name: 'USER-seat glass',
        thickness: 4,
        weightPerSqm: 10,
        pricePerSqm: 50,
      })
      .expect(201);
    const created = res.body as CompanyGlassSummary;
    expect(created.scope).toBe('company');

    await request(app.getHttpServer())
      .delete(`/company/lookups/glass/${created.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  it('refuses a super admin — no companyId to resolve a tenant from', async () => {
    await request(app.getHttpServer())
      .get('/company/lookups/colors')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/company/lookups/colors')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({ code: 'Nope', hex: '#000000' })
      .expect(403);
  });

  it("keeps tenant B blind to tenant A's company rows, and unable to mutate them by real id", async () => {
    const created = await request(app.getHttpServer())
      .post('/company/lookups/system-brands')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ name: 'Alpha In-House' })
      .expect(201);
    const brandId = (created.body as CompanySystemBrandSummary).id;

    const betaSlice = await request(app.getHttpServer())
      .get('/company/lookups/systems')
      .set('Authorization', `Bearer ${tokenBeta}`)
      .expect(200);
    const betaBrandNames = (
      betaSlice.body as { data: { brands: CompanySystemBrandSummary[] } }
    ).data.brands.map((b) => b.name);
    expect(betaBrandNames).not.toContain('Alpha In-House');

    // 404, not 403 — the row is structurally invisible from tenant B's
    // schema, the same isolation guarantee clients/projects already
    // proved, now exercised against a lookup table.
    await request(app.getHttpServer())
      .patch(`/company/lookups/system-brands/${brandId}`)
      .set('Authorization', `Bearer ${tokenBeta}`)
      .send({ name: 'Hijacked' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/company/lookups/system-brands/${brandId}`)
      .set('Authorization', `Bearer ${tokenBeta}`)
      .expect(404);

    // Untouched for its real owner.
    const stillThere = await request(app.getHttpServer())
      .get('/company/lookups/systems')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(
      (
        stillThere.body as { data: { brands: CompanySystemBrandSummary[] } }
      ).data.brands.map((b) => b.name),
    ).toContain('Alpha In-House');

    await request(app.getHttpServer())
      .delete(`/company/lookups/system-brands/${brandId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  it('rejects a company row that collides with a platform row, case- and whitespace-insensitively', async () => {
    const res = await request(app.getHttpServer())
      .post('/company/lookups/glass')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        name: `  ${platformGlassName.toUpperCase()}  `,
        thickness: 4,
        weightPerSqm: 10,
        pricePerSqm: 50,
      })
      .expect(409);
    expect((res.body as { message: string }).message).toMatch(
      /already exists/i,
    );
  });

  it("rejects a company row that collides with the company's own existing row", async () => {
    const first = await request(app.getHttpServer())
      .post('/company/lookups/colors')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ code: 'Dup Test Colour', hex: '#123456' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/company/lookups/colors')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ code: 'dup test colour', hex: '#654321' })
      .expect(409);
    expect((res.body as { message: string }).message).toMatch(/already have/i);

    await request(app.getHttpServer())
      .delete(
        `/company/lookups/colors/${(first.body as CompanyColorSummary).id}`,
      )
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  it('resolves a cross-scope parent reference on both write and read', async () => {
    const created = await request(app.getHttpServer())
      .post('/company/lookups/system-catalogs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        brand: 'platform:' + (await firstPlatformSystemBrandId(controlPlane)),
        name: 'Cross-scope Catalogue',
        systemType: 'sliding',
        maxGlassThickness: 24,
        maxSashWeight: 100,
      })
      .expect(201);
    const catalog = created.body as CompanySystemCatalogSummary;
    expect(catalog.brandScope).toBe('platform');
    expect(catalog.brandName).toBeTruthy();

    const slice = await request(app.getHttpServer())
      .get('/company/lookups/systems')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const inSlice = (
      slice.body as { data: { catalogs: CompanySystemCatalogSummary[] } }
    ).data.catalogs.find((c) => c.id === catalog.id);
    expect(inSlice?.brandName).toBe(catalog.brandName);
    expect(inSlice?.brandScope).toBe('platform');

    await request(app.getHttpServer())
      .delete(`/company/lookups/system-catalogs/${catalog.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  it('reports a blocked bulk-delete id back instead of failing the batch, then deletes what it can', async () => {
    const brand = await request(app.getHttpServer())
      .post('/company/lookups/system-brands')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ name: 'Blocked Brand' })
      .expect(201);
    const brandId = (brand.body as CompanySystemBrandSummary).id;

    const catalog = await request(app.getHttpServer())
      .post('/company/lookups/system-catalogs')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        brand: `company:${brandId}`,
        name: 'Blocking Catalogue',
        systemType: 'hinged',
        maxGlassThickness: 20,
        maxSashWeight: 80,
      })
      .expect(201);
    const catalogId = (catalog.body as CompanySystemCatalogSummary).id;

    const freeBrand = await request(app.getHttpServer())
      .post('/company/lookups/system-brands')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ name: 'Free Brand' })
      .expect(201);
    const freeBrandId = (freeBrand.body as CompanySystemBrandSummary).id;

    const bulk = await request(app.getHttpServer())
      .post('/company/lookups/system-brands/bulk-delete')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ ids: [brandId, freeBrandId] })
      .expect(201);
    const result = bulk.body as BulkDeleteResult;
    expect(result.blockedIds).toEqual([brandId]);
    expect(result.deletedIds).toEqual([freeBrandId]);

    await request(app.getHttpServer())
      .delete(`/company/lookups/system-catalogs/${catalogId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/company/lookups/system-brands/${brandId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  it('mixes platform and company glass/colour inside one combination, on both write and read', async () => {
    const companyGlass = await request(app.getHttpServer())
      .post('/company/lookups/glass')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        name: 'Combo-only glass',
        thickness: 8,
        weightPerSqm: 20,
        pricePerSqm: 200,
      })
      .expect(201);
    const companyGlassId = (companyGlass.body as CompanyGlassSummary).id;

    const combo = await request(app.getHttpServer())
      .post('/company/lookups/glass-combinations')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        name: 'Mixed-scope combo',
        items: [
          {
            kind: 'sheet',
            glass: `platform:${platformGlassId}`,
            color: `platform:${platformColorId}`,
          },
          { kind: 'gap', gapType: 'spacer', gapThickness: 12 },
          { kind: 'sheet', glass: `company:${companyGlassId}`, color: null },
        ],
      })
      .expect(201);
    const items = (
      combo.body as {
        items: { glassName: string | null; colorCode: string | null }[];
      }
    ).items;
    expect(items[0].glassName).toBe(platformGlassName);
    expect(items[0].colorCode).toBe(platformColorCode);
    expect(items[2].glassName).toBe('Combo-only glass');

    await request(app.getHttpServer())
      .delete(
        `/company/lookups/glass-combinations/${(combo.body as { id: string }).id}`,
      )
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/company/lookups/glass/${companyGlassId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(204);
  });

  // ---- Sliding rails on a frame profile (docs/sliding_windows_planing.md §11) ----
  //
  // The rail count is a profile fact the API owns: a FRAME in a SLIDING
  // catalogue stores what was sent or 2; anything else stores null no
  // matter what the client said. Checked on both the platform (super
  // admin) and the company endpoints, since each service normalises on
  // its own.

  describe('sliding rails on a profile', () => {
    let slidingCatalogId: string;
    let hingedCatalogId: string;
    const baseProfile = {
      maxGlassThickness: 24,
      weight: 1,
      perimeter: 100,
      inertiaIx: 1,
      inertiaIy: 1,
      acceptsFlyScreen: false,
    };

    beforeAll(async () => {
      const [sliding]: { id: string }[] = await controlPlane.query(
        `SELECT id FROM system_catalog WHERE system_type = 'sliding' ORDER BY name ASC LIMIT 1`,
      );
      const [hinged]: { id: string }[] = await controlPlane.query(
        `SELECT id FROM system_catalog WHERE system_type = 'hinged' ORDER BY name ASC LIMIT 1`,
      );
      slidingCatalogId = sliding.id;
      hingedCatalogId = hinged.id;
    });

    it('platform: a sliding frame defaults to 2, keeps an explicit 3, and nulls when retyped or moved', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/lookups/system-profiles')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          ...baseProfile,
          catalogId: slidingCatalogId,
          profileNo: 'E2E-RAILS-P1',
          profileType: 'frame',
        })
        .expect(201);
      const profile = created.body as SystemProfileSummary;
      expect(profile.slidingRails).toBe(2);

      const three = await request(app.getHttpServer())
        .patch(`/admin/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ slidingRails: 3 })
        .expect(200);
      expect((three.body as SystemProfileSummary).slidingRails).toBe(3);

      await request(app.getHttpServer())
        .patch(`/admin/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ slidingRails: 5 })
        .expect(400);

      // Retyped as a leaf — rails vanish even though the client only
      // changed the type.
      const leaf = await request(app.getHttpServer())
        .patch(`/admin/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ profileType: 'leaf' })
        .expect(200);
      expect((leaf.body as SystemProfileSummary).slidingRails).toBeNull();

      // Back to a frame, but in a hinged catalogue — still null, even
      // with an explicit value sent.
      const hinged = await request(app.getHttpServer())
        .patch(`/admin/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          profileType: 'frame',
          catalogId: hingedCatalogId,
          slidingRails: 3,
        })
        .expect(200);
      expect((hinged.body as SystemProfileSummary).slidingRails).toBeNull();

      // And back into the sliding catalogue: the default reappears.
      const again = await request(app.getHttpServer())
        .patch(`/admin/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ catalogId: slidingCatalogId })
        .expect(200);
      expect((again.body as SystemProfileSummary).slidingRails).toBe(2);

      await request(app.getHttpServer())
        .delete(`/admin/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(204);
    });

    it('company: the same rule on an own profile, including the read slice and bulk duplicate', async () => {
      const created = await request(app.getHttpServer())
        .post('/company/lookups/system-profiles')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ...baseProfile,
          catalog: `platform:${slidingCatalogId}`,
          profileNo: 'E2E-RAILS-C1',
          profileType: 'frame',
          slidingRails: 4,
        })
        .expect(201);
      const profile = created.body as CompanySystemProfileSummary;
      expect(profile.slidingRails).toBe(4);

      const leafSent = await request(app.getHttpServer())
        .post('/company/lookups/system-profiles')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ...baseProfile,
          catalog: `platform:${slidingCatalogId}`,
          profileNo: 'E2E-RAILS-C2',
          profileType: 'leaf',
          slidingRails: 3,
        })
        .expect(201);
      expect(
        (leafSent.body as CompanySystemProfileSummary).slidingRails,
      ).toBeNull();

      const slice = await request(app.getHttpServer())
        .get('/company/lookups/systems')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      const inSlice = (
        slice.body as { data: { profiles: CompanySystemProfileSummary[] } }
      ).data.profiles.find((p) => p.id === profile.id);
      expect(inSlice?.slidingRails).toBe(4);

      const dup = await request(app.getHttpServer())
        .post('/company/lookups/system-profiles/bulk-duplicate')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          items: [
            {
              ...baseProfile,
              catalog: `platform:${slidingCatalogId}`,
              profileNo: 'E2E-RAILS-C1-copy',
              profileType: 'frame',
            },
            {
              ...baseProfile,
              catalog: `platform:${hingedCatalogId}`,
              profileNo: 'E2E-RAILS-C3',
              profileType: 'frame',
              slidingRails: 3,
            },
          ],
        })
        .expect(201);
      const copies = dup.body as CompanySystemProfileSummary[];
      expect(
        copies.find((p) => p.profileNo === 'E2E-RAILS-C1-copy')?.slidingRails,
      ).toBe(2);
      expect(
        copies.find((p) => p.profileNo === 'E2E-RAILS-C3')?.slidingRails,
      ).toBeNull();

      const moved = await request(app.getHttpServer())
        .patch(`/company/lookups/system-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ catalog: `platform:${hingedCatalogId}` })
        .expect(200);
      expect(
        (moved.body as CompanySystemProfileSummary).slidingRails,
      ).toBeNull();

      await request(app.getHttpServer())
        .post('/company/lookups/system-profiles/bulk-delete')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ids: [
            profile.id,
            (leafSent.body as CompanySystemProfileSummary).id,
            ...copies.map((p) => p.id),
          ],
        })
        .expect(201);
    });
  });
});

async function firstPlatformSystemBrandId(
  controlPlane: DataSource,
): Promise<string> {
  const [row]: { id: string }[] = await controlPlane.query(
    `SELECT id FROM system_brand ORDER BY name ASC LIMIT 1`,
  );
  return row.id;
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
