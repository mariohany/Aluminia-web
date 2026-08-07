import { MigrationInterface, QueryRunner } from 'typeorm';

// Stage E — the shared data warehouse. Nine typed tables in three
// clusters (glass, colour, systems) plus lookup_meta, a single-row
// version counter bumped by a statement-level trigger on every one of
// them. See docs/admin_dashboard_planing.md Section 4 for the full
// design (why real tables, why a trigger, why the cache is sliced by
// cluster).
export class AddLookupTables1786032288461 implements MigrationInterface {
  name = 'AddLookupTables1786032288461';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- enums -----------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "combination_item_kind" AS ENUM ('sheet', 'gap')`,
    );
    await queryRunner.query(
      `CREATE TYPE "glass_gap_type" AS ENUM ('laminated', 'spacer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "system_type" AS ENUM ('sliding', 'hinged', 'curtain_wall')`,
    );
    await queryRunner.query(`
      CREATE TYPE "profile_type" AS ENUM (
        'frame', 'leaf', 'transom', 'glass_beading',
        'insert', 'sliding_insert', 'control_rod'
      )
    `);

    // --- lookup_meta: single-row version counter --------------------
    // The `id boolean PRIMARY KEY DEFAULT true` + CHECK("id") pair is
    // the standard trick for a table that can only ever hold one row —
    // a second INSERT collides with the primary key.
    await queryRunner.query(`
      CREATE TABLE "lookup_meta" (
        "id" boolean PRIMARY KEY DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "CK_lookup_meta_single_row" CHECK ("id")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "lookup_meta" ("id", "version") VALUES (true, 1)`,
    );

    // --- colour cluster ----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "color" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(50) NOT NULL,
        "hex" varchar(7) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_color_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "color_brand" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_color_brand_name" UNIQUE ("name")
      )
    `);

    // `type` stays a free string, not an enum: the actual finish values
    // (powder coat, anodised, wood-grain, ...) are still an open
    // question (Section 4, open question 3) — encoding a guessed enum
    // here would bake in an unconfirmed assumption.
    await queryRunner.query(`
      CREATE TABLE "color_price" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "brand_id" uuid NOT NULL REFERENCES "color_brand"("id") ON DELETE RESTRICT,
        "type" varchar(50) NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_color_price_brand_type" UNIQUE ("brand_id", "type")
      )
    `);

    // --- glass cluster -------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "glass" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "thickness" integer NOT NULL,
        "weight_per_sqm" real NOT NULL,
        "price_per_sqm" numeric(10,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // totalThickness is deliberately not a column here — it's the sum
    // of this combination's items, computed on read so it can never
    // drift from what the items actually are.
    await queryRunner.query(`
      CREATE TABLE "glass_combination" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // The ordered, polymorphic list as a real child table rather than a
    // jsonb blob — that's what makes the glass_id/color_id references
    // real foreign keys (ON DELETE RESTRICT below), so "don't let a
    // referenced value silently disappear" is enforced by Postgres, not
    // just checked in the UI. `position` is 0-based and is itself the
    // combination's build-up order — swapping two rows is a different
    // physical unit.
    await queryRunner.query(`
      CREATE TABLE "glass_combination_item" (
        "combination_id" uuid NOT NULL REFERENCES "glass_combination"("id") ON DELETE CASCADE,
        "position" integer NOT NULL,
        "kind" combination_item_kind NOT NULL,
        "glass_id" uuid REFERENCES "glass"("id") ON DELETE RESTRICT,
        "color_id" uuid REFERENCES "color"("id") ON DELETE RESTRICT,
        "gap_type" glass_gap_type,
        "gap_thickness" numeric(5,2),
        "gap_color_id" uuid REFERENCES "color"("id") ON DELETE RESTRICT,
        "is_georgian" boolean,
        "columns_count" integer,
        "rows_count" integer,
        PRIMARY KEY ("combination_id", "position"),
        CONSTRAINT "CK_glass_combination_item_shape" CHECK (
          (
            "kind" = 'sheet' AND "glass_id" IS NOT NULL
            AND "gap_type" IS NULL AND "gap_thickness" IS NULL AND "gap_color_id" IS NULL
            AND "is_georgian" IS NULL AND "columns_count" IS NULL AND "rows_count" IS NULL
          ) OR (
            "kind" = 'gap' AND "glass_id" IS NULL AND "gap_type" IS NOT NULL
          )
        ),
        -- Georgian bars sit inside an air gap, not bonded into a
        -- laminated interlayer — these three fields only make sense
        -- when gap_type = 'spacer'.
        CONSTRAINT "CK_glass_combination_item_georgian_only_spacer" CHECK (
          "gap_type" = 'spacer' OR (
            "is_georgian" IS NULL AND "columns_count" IS NULL AND "rows_count" IS NULL
          )
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_glass_combination_item_glass" ON "glass_combination_item" ("glass_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_glass_combination_item_color" ON "glass_combination_item" ("color_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_glass_combination_item_gap_color" ON "glass_combination_item" ("gap_color_id")`,
    );

    // --- systems cluster -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "system_brand" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_system_brand_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "system_catalog" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "brand_id" uuid NOT NULL REFERENCES "system_brand"("id") ON DELETE RESTRICT,
        "name" varchar(255) NOT NULL,
        "system_type" system_type NOT NULL,
        "max_glass_thickness" integer NOT NULL,
        "max_sash_weight" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_system_catalog_brand" ON "system_catalog" ("brand_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "system_profile" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "catalog_id" uuid NOT NULL REFERENCES "system_catalog"("id") ON DELETE RESTRICT,
        "profile_no" varchar(100) NOT NULL,
        "profile_type" profile_type NOT NULL,
        "max_glass_thickness" integer NOT NULL,
        "weight" real NOT NULL,
        "perimeter" integer NOT NULL,
        "inertia_ix" real NOT NULL,
        "inertia_iy" real NOT NULL,
        "image" varchar(2048),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_system_profile_catalog_no" UNIQUE ("catalog_id", "profile_no")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_system_profile_catalog" ON "system_profile" ("catalog_id")`,
    );

    // --- version bump trigger, attached to every lookup table -----
    // Statement-level, not row-level: importing an 800-profile catalogue
    // should bump the version once, not 800 times contending on the same
    // lookup_meta row. Any new lookup table added later must attach this
    // same trigger in the migration that creates it.
    await queryRunner.query(`
      CREATE FUNCTION "bump_lookup_version"() RETURNS trigger AS $$
      BEGIN
        UPDATE "lookup_meta" SET "version" = "version" + 1;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    const lookupTables = [
      'color',
      'color_brand',
      'color_price',
      'glass',
      'glass_combination',
      'glass_combination_item',
      'system_brand',
      'system_catalog',
      'system_profile',
    ];
    for (const table of lookupTables) {
      await queryRunner.query(`
        CREATE TRIGGER "${table}_bump_lookup_version"
          AFTER INSERT OR UPDATE OR DELETE ON "${table}"
          FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"()
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const lookupTables = [
      'color',
      'color_brand',
      'color_price',
      'glass',
      'glass_combination',
      'glass_combination_item',
      'system_brand',
      'system_catalog',
      'system_profile',
    ];
    for (const table of lookupTables) {
      await queryRunner.query(
        `DROP TRIGGER "${table}_bump_lookup_version" ON "${table}"`,
      );
    }
    await queryRunner.query(`DROP FUNCTION "bump_lookup_version"()`);

    await queryRunner.query(`DROP INDEX "IDX_system_profile_catalog"`);
    await queryRunner.query(`DROP TABLE "system_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_system_catalog_brand"`);
    await queryRunner.query(`DROP TABLE "system_catalog"`);
    await queryRunner.query(`DROP TABLE "system_brand"`);

    await queryRunner.query(
      `DROP INDEX "IDX_glass_combination_item_gap_color"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_glass_combination_item_color"`);
    await queryRunner.query(`DROP INDEX "IDX_glass_combination_item_glass"`);
    await queryRunner.query(`DROP TABLE "glass_combination_item"`);
    await queryRunner.query(`DROP TABLE "glass_combination"`);
    await queryRunner.query(`DROP TABLE "glass"`);

    await queryRunner.query(`DROP TABLE "color_price"`);
    await queryRunner.query(`DROP TABLE "color_brand"`);
    await queryRunner.query(`DROP TABLE "color"`);

    await queryRunner.query(`DROP TABLE "lookup_meta"`);

    await queryRunner.query(`DROP TYPE "profile_type"`);
    await queryRunner.query(`DROP TYPE "system_type"`);
    await queryRunner.query(`DROP TYPE "glass_gap_type"`);
    await queryRunner.query(`DROP TYPE "combination_item_kind"`);
  }
}
