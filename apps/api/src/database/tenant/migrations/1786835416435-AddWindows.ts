import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first table that is actually a WINDOW (docs/window_creation_planing.md).
 * One row per window design within a project — frame/sash profile, size,
 * quantity, glass, options, colours.
 *
 * Same tenant-migration ground rules as every other file here: no schema
 * prefix on any name, and `num_nonnulls(...)` pairs for every reference
 * that may resolve to either a platform row (control-plane schema, no
 * FK possible) or this tenant's own row (real FK, `ON DELETE RESTRICT`).
 *
 * Two things make these pairs STRICT where `AddProjectPreferences`'
 * identically-shaped pairs are deliberately soft (no CHECK, no FK):
 *
 * 1. A window's frame, sash, glass and colours are structural, not a
 *    droppable default — a window with a profile that no longer exists
 *    is broken data, not a stale preference. So every pair here gets
 *    `CHECK (num_nonnulls(...) = 1)` (`<= 1` for the two optional
 *    colours) and a real FK on the company half.
 * 2. Glass needs FOUR nullable columns, not two, because "glass" is
 *    itself a discriminated union — a single sheet (`glass`/
 *    `company_glass`) or a build-up (`glass_combination`/
 *    `company_glass_combination`), two different table pairs. A single
 *    `company_glass_id` column can't carry a foreign key that points at
 *    `company_glass` for one row and `company_glass_combination` for
 *    another — Postgres FKs target exactly one table. So `glass_kind`
 *    discriminates, and `CK_windows_glass_shape` enforces "exactly one
 *    of the two live columns for that kind is set, and the other kind's
 *    columns are all null" — the same shape-CHECK pattern
 *    `glass_combination_item` already uses for its own sheet/gap union.
 *
 * `project_id` is the one CASCADE FK — deleting a project takes its
 * windows with it, same posture as `projects.client_id` → `clients`.
 */
export class AddWindows1786835416435 implements MigrationInterface {
  name = 'AddWindows1786835416435';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "windows" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,

        "frame_platform_profile_id" uuid,
        "frame_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,

        "sash_platform_profile_id" uuid,
        "sash_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,

        "width_mm" integer NOT NULL,
        "height_mm" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,

        "has_fly_screen" boolean NOT NULL DEFAULT false,
        "is_door" boolean NOT NULL DEFAULT false,

        "glass_kind" varchar(20) NOT NULL,
        "glass_platform_single_id" uuid,
        "glass_company_single_id" uuid REFERENCES "company_glass"("id") ON DELETE RESTRICT,
        "glass_platform_combination_id" uuid,
        "glass_company_combination_id" uuid REFERENCES "company_glass_combination"("id") ON DELETE RESTRICT,

        "interior_color_platform_id" uuid,
        "interior_color_company_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,
        "exterior_color_platform_id" uuid,
        "exterior_color_company_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,

        "location" text,
        "notes" text,

        "created_by_user_id" uuid NOT NULL,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "FK_windows_project" FOREIGN KEY ("project_id")
          REFERENCES "projects"("id") ON DELETE CASCADE,

        CONSTRAINT "CK_windows_one_frame_profile"
          CHECK (num_nonnulls("frame_platform_profile_id", "frame_company_profile_id") = 1),
        CONSTRAINT "CK_windows_one_sash_profile"
          CHECK (num_nonnulls("sash_platform_profile_id", "sash_company_profile_id") = 1),

        CONSTRAINT "CK_windows_width_positive" CHECK ("width_mm" > 0),
        CONSTRAINT "CK_windows_height_positive" CHECK ("height_mm" > 0),
        CONSTRAINT "CK_windows_quantity_min" CHECK ("quantity" >= 1),

        CONSTRAINT "CK_windows_glass_kind" CHECK ("glass_kind" IN ('single', 'combination')),
        CONSTRAINT "CK_windows_glass_shape" CHECK (
          (
            "glass_kind" = 'single'
            AND num_nonnulls("glass_platform_single_id", "glass_company_single_id") = 1
            AND "glass_platform_combination_id" IS NULL AND "glass_company_combination_id" IS NULL
          ) OR (
            "glass_kind" = 'combination'
            AND num_nonnulls("glass_platform_combination_id", "glass_company_combination_id") = 1
            AND "glass_platform_single_id" IS NULL AND "glass_company_single_id" IS NULL
          )
        ),

        CONSTRAINT "CK_windows_interior_color_at_most_one"
          CHECK (num_nonnulls("interior_color_platform_id", "interior_color_company_id") <= 1),
        CONSTRAINT "CK_windows_exterior_color_at_most_one"
          CHECK (num_nonnulls("exterior_color_platform_id", "exterior_color_company_id") <= 1)
      )
    `);

    // Postgres does not index a foreign key automatically, and every one
    // of these is read whenever a window's references are resolved to
    // display names — matches AddCompanyLookups' one-index-per-pair-half
    // convention.
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_project" ON "windows" ("project_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_frame_platform_profile" ON "windows" ("frame_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_frame_company_profile" ON "windows" ("frame_company_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_sash_platform_profile" ON "windows" ("sash_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_sash_company_profile" ON "windows" ("sash_company_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_glass_platform_single" ON "windows" ("glass_platform_single_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_glass_company_single" ON "windows" ("glass_company_single_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_glass_platform_combination" ON "windows" ("glass_platform_combination_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_glass_company_combination" ON "windows" ("glass_company_combination_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_interior_color_platform" ON "windows" ("interior_color_platform_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_interior_color_company" ON "windows" ("interior_color_company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_exterior_color_platform" ON "windows" ("exterior_color_platform_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_windows_exterior_color_company" ON "windows" ("exterior_color_company_id")`,
    );

    // A window's name only has to be unique within its own project, not
    // across the whole tenant — two different projects can each have a
    // "W-01". Plain column, not COALESCE: unlike a ScopedRef pair,
    // `project_id` is a single required parent.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_windows_project_name" ON "windows" ("project_id", lower("name"))
    `);

    // A project's favourite FRAME profile — same nullable, no-CHECK,
    // no-FK pair shape as AddProjectPreferences' own columns (a
    // favourite is a soft preference too, allowed to go stale).
    await queryRunner.query(`
      ALTER TABLE "projects"
        ADD COLUMN "favorite_platform_profile_id" uuid,
        ADD COLUMN "favorite_company_profile_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "projects"
        DROP COLUMN "favorite_platform_profile_id",
        DROP COLUMN "favorite_company_profile_id"
    `);

    await queryRunner.query(`DROP INDEX "UQ_windows_project_name"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_exterior_color_company"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_exterior_color_platform"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_interior_color_company"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_interior_color_platform"`);
    await queryRunner.query(
      `DROP INDEX "IDX_windows_glass_company_combination"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_windows_glass_platform_combination"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_windows_glass_company_single"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_glass_platform_single"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_sash_company_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_sash_platform_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_frame_company_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_frame_platform_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_windows_project"`);
    await queryRunner.query(`DROP TABLE "windows"`);
  }
}
