import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 of Company Lookups (docs/company_lookups_planing.md) — nine
 * tenant-owned counterparts to the platform's lookup tables
 * (control-plane migration 1786032288461), so a manufacturer can record
 * its own glass, colours, paint brands/prices, and system brands/
 * catalogues/profiles alongside the shared platform catalogue.
 *
 * Deliberately unlike the platform tables in three ways (see the
 * planing doc's "Schema" section for the full reasoning):
 *
 * 1. No `lookup_meta` row and no version-bump trigger — that machinery
 *    exists only to invalidate the platform's shared Redis cache, and a
 *    tenant's own rows are read live, uncached, every time.
 * 2. No Postgres enum types. The four platform enums
 *    (combination_item_kind, glass_gap_type, system_type, profile_type)
 *    live in `public`, which the tenant search_path deliberately
 *    excludes (CLAUDE.md) — every enum-shaped column here is `varchar`
 *    instead, `CHECK`-constrained where the shape is truly fixed (kind,
 *    gap_type) and left open where the platform's own version has
 *    already grown once mid-project (system_type, profile_type — Zod
 *    remains the real enforcement point for those two).
 * 3. Wherever a company row can point at either a platform or a
 *    company-owned parent, the parent is a NULLABLE PAIR of columns
 *    (`platform_x_id` / `company_x_id`), exactly one of which is set
 *    (a `CK_..._one_*` CHECK). The `platform_x_id` half carries no
 *    foreign key on purpose — a cross-schema `ON DELETE RESTRICT` would
 *    let any one of up to 250 tenant schemas block a super admin's
 *    delete of a platform row. A dangling `platform_x_id` (its platform
 *    row later deleted) is accepted and surfaced on read as
 *    "unavailable", never prevented.
 *
 * Company-vs-company duplicate identity is enforced here as a plain
 * case-insensitive unique index per entity (Postgres can see both rows
 * in the same schema). Company-vs-platform duplicates can't be — they're
 * in different schemas — so that half is a service-layer pre-check
 * (see `company-lookups`' collision helper).
 *
 * As with every tenant migration: no schema prefix on any name — the
 * DataSource this runs under sets `search_path`, and Postgres resolves
 * these unqualified names into the right tenant schema.
 */
export class AddCompanyLookups1786531275742 implements MigrationInterface {
  name = 'AddCompanyLookups1786531275742';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- colour cluster ----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "company_color" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(50) NOT NULL,
        "hex" varchar(7) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_color_code" ON "company_color" (lower("code"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "company_paint_brand" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_paint_brand_name" ON "company_paint_brand" (lower("name"))`,
    );

    // `type` stays a free string, matching `painting_price` — the actual
    // finish values are still an open question platform-side too.
    await queryRunner.query(`
      CREATE TABLE "company_painting_price" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "platform_brand_id" uuid,
        "company_brand_id" uuid REFERENCES "company_paint_brand"("id") ON DELETE RESTRICT,
        "type" varchar(50) NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_company_painting_price_one_brand"
          CHECK (num_nonnulls("platform_brand_id", "company_brand_id") = 1)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_company_painting_price_platform_brand" ON "company_painting_price" ("platform_brand_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_painting_price_company_brand" ON "company_painting_price" ("company_brand_id")`,
    );
    // COALESCE across the pair works because the CHECK above guarantees
    // exactly one side is set — the result is always the one real brand
    // id (platform or company) this price belongs to, so two rows can't
    // both claim the same (brand, type) regardless of which scope that
    // brand lives in.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_company_painting_price_brand_type"
        ON "company_painting_price" (COALESCE("platform_brand_id", "company_brand_id"), lower("type"))
    `);

    // --- glass cluster -------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "company_glass" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "thickness" integer NOT NULL,
        "weight_per_sqm" real NOT NULL,
        "price_per_sqm" numeric(10,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_glass_name" ON "company_glass" (lower("name"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "company_glass_combination" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_glass_combination_name" ON "company_glass_combination" (lower("name"))`,
    );

    // Mirrors glass_combination_item's shape (composite PK, ordered
    // build-up, the same two CHECKs) but every one of its three
    // references (glass, color, gap_color) is a platform/company pair —
    // a company combination is allowed to mix platform and
    // company-owned glass and colours freely (planing doc's
    // "Cross-scope references" decision). `kind`/`gap_type` are varchar
    // + CHECK rather than the platform's enum types — see this file's
    // header comment, difference 2.
    await queryRunner.query(`
      CREATE TABLE "company_glass_combination_item" (
        "combination_id" uuid NOT NULL REFERENCES "company_glass_combination"("id") ON DELETE CASCADE,
        "position" integer NOT NULL,
        "kind" varchar(10) NOT NULL,
        "platform_glass_id" uuid,
        "company_glass_id" uuid REFERENCES "company_glass"("id") ON DELETE RESTRICT,
        "platform_color_id" uuid,
        "company_color_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,
        "gap_type" varchar(10),
        "gap_thickness" numeric(5,2),
        "platform_gap_color_id" uuid,
        "company_gap_color_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,
        "is_georgian" boolean,
        "columns_count" integer,
        "rows_count" integer,
        PRIMARY KEY ("combination_id", "position"),
        CONSTRAINT "CK_company_glass_combination_item_kind" CHECK ("kind" IN ('sheet', 'gap')),
        CONSTRAINT "CK_company_glass_combination_item_gap_type"
          CHECK ("gap_type" IS NULL OR "gap_type" IN ('laminated', 'spacer')),
        -- Mirrors CK_glass_combination_item_shape exactly, with each
        -- single-column reference replaced by "exactly one of the pair
        -- is set". Note (same as the platform version): neither branch
        -- constrains the colour pair — a sheet's colour is genuinely
        -- optional, and the gap branch never touches it either, matching
        -- what the platform migration already does.
        CONSTRAINT "CK_company_glass_combination_item_shape" CHECK (
          (
            "kind" = 'sheet'
            AND num_nonnulls("platform_glass_id", "company_glass_id") = 1
            AND "gap_type" IS NULL AND "gap_thickness" IS NULL
            AND "platform_gap_color_id" IS NULL AND "company_gap_color_id" IS NULL
            AND "is_georgian" IS NULL AND "columns_count" IS NULL AND "rows_count" IS NULL
          ) OR (
            "kind" = 'gap'
            AND "platform_glass_id" IS NULL AND "company_glass_id" IS NULL
            AND "gap_type" IS NOT NULL
          )
        ),
        CONSTRAINT "CK_company_glass_combination_item_georgian_only_spacer" CHECK (
          "gap_type" = 'spacer' OR (
            "is_georgian" IS NULL AND "columns_count" IS NULL AND "rows_count" IS NULL
          )
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_company_glass_combination_item_platform_glass" ON "company_glass_combination_item" ("platform_glass_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_glass_combination_item_company_glass" ON "company_glass_combination_item" ("company_glass_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_glass_combination_item_platform_color" ON "company_glass_combination_item" ("platform_color_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_glass_combination_item_company_color" ON "company_glass_combination_item" ("company_color_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_glass_combination_item_platform_gap_color" ON "company_glass_combination_item" ("platform_gap_color_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_glass_combination_item_company_gap_color" ON "company_glass_combination_item" ("company_gap_color_id")`,
    );

    // --- systems cluster -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "company_system_brand" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_system_brand_name" ON "company_system_brand" (lower("name"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "company_system_catalog" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "platform_brand_id" uuid,
        "company_brand_id" uuid REFERENCES "company_system_brand"("id") ON DELETE RESTRICT,
        "name" varchar(255) NOT NULL,
        "system_type" varchar(20) NOT NULL,
        "max_glass_thickness" integer NOT NULL,
        "max_sash_weight" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_company_system_catalog_one_brand"
          CHECK (num_nonnulls("platform_brand_id", "company_brand_id") = 1)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_company_system_catalog_platform_brand" ON "company_system_catalog" ("platform_brand_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_system_catalog_company_brand" ON "company_system_catalog" ("company_brand_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_company_system_catalog_brand_name"
        ON "company_system_catalog" (COALESCE("platform_brand_id", "company_brand_id"), lower("name"))
    `);

    await queryRunner.query(`
      CREATE TABLE "company_system_profile" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "platform_catalog_id" uuid,
        "company_catalog_id" uuid REFERENCES "company_system_catalog"("id") ON DELETE RESTRICT,
        "profile_no" varchar(100) NOT NULL,
        "profile_type" varchar(20) NOT NULL,
        "max_glass_thickness" integer NOT NULL,
        "weight" real NOT NULL,
        "perimeter" integer NOT NULL,
        "inertia_ix" real NOT NULL,
        "inertia_iy" real NOT NULL,
        "image" varchar(2048),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_company_system_profile_one_catalog"
          CHECK (num_nonnulls("platform_catalog_id", "company_catalog_id") = 1)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_company_system_profile_platform_catalog" ON "company_system_profile" ("platform_catalog_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_system_profile_company_catalog" ON "company_system_profile" ("company_catalog_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_company_system_profile_catalog_no"
        ON "company_system_profile" (COALESCE("platform_catalog_id", "company_catalog_id"), lower("profile_no"))
    `);

    // Deliberately NO version-bump trigger on any of the nine tables
    // above — see this file's header comment, difference 1.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse of `up`'s creation order, so every FK is dropped before
    // the table it references.
    await queryRunner.query(
      `DROP INDEX "UQ_company_system_profile_catalog_no"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_system_profile_company_catalog"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_system_profile_platform_catalog"`,
    );
    await queryRunner.query(`DROP TABLE "company_system_profile"`);

    await queryRunner.query(
      `DROP INDEX "UQ_company_system_catalog_brand_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_system_catalog_company_brand"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_system_catalog_platform_brand"`,
    );
    await queryRunner.query(`DROP TABLE "company_system_catalog"`);

    await queryRunner.query(`DROP INDEX "UQ_company_system_brand_name"`);
    await queryRunner.query(`DROP TABLE "company_system_brand"`);

    await queryRunner.query(
      `DROP INDEX "IDX_company_glass_combination_item_company_gap_color"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_glass_combination_item_platform_gap_color"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_glass_combination_item_company_color"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_glass_combination_item_platform_color"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_glass_combination_item_company_glass"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_glass_combination_item_platform_glass"`,
    );
    await queryRunner.query(`DROP TABLE "company_glass_combination_item"`);

    await queryRunner.query(`DROP INDEX "UQ_company_glass_combination_name"`);
    await queryRunner.query(`DROP TABLE "company_glass_combination"`);

    await queryRunner.query(`DROP INDEX "UQ_company_glass_name"`);
    await queryRunner.query(`DROP TABLE "company_glass"`);

    await queryRunner.query(
      `DROP INDEX "UQ_company_painting_price_brand_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_painting_price_company_brand"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_company_painting_price_platform_brand"`,
    );
    await queryRunner.query(`DROP TABLE "company_painting_price"`);

    await queryRunner.query(`DROP INDEX "UQ_company_paint_brand_name"`);
    await queryRunner.query(`DROP TABLE "company_paint_brand"`);

    await queryRunner.query(`DROP INDEX "UQ_company_color_code"`);
    await queryRunner.query(`DROP TABLE "company_color"`);
  }
}
