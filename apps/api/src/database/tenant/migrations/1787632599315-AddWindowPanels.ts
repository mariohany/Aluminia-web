import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns a window from a single unit into an ASSEMBLY of coupled panels
 * (docs/window_assembly_planing.md §3).
 *
 * `windows` keeps the header — name, quantity, location, notes, and the
 * overall `width_mm`/`height_mm`, which stop being user input and become
 * DERIVED from the panels' bounding box (written by WindowsService, so a
 * canvas card or a future quote never has to read panels just to print a
 * size). Everything that describes how a unit is actually built moves to
 * `window_panels`, one row per panel.
 *
 * Every moved column keeps its constraints VERBATIM — the
 * `num_nonnulls(...)` pairs, the FKs on each company half, the
 * `glass_kind` four-column shape CHECK, and the opening-type value list.
 * Reproducing them here rather than storing panels as JSONB is the whole
 * point: a panel referencing a company profile that no longer exists is
 * broken data, exactly as it was when these columns lived on `windows`.
 * See AddWindows' own header for why each pair is strict.
 *
 * Panel geometry is a free rectangle in the assembly's mm space, origin
 * at the bounding box's top-left. `x_mm`/`y_mm` may be 0 but never
 * negative; the service re-normalises the origin on every write, so an
 * assembly has exactly one stored representation. The remaining
 * invariants (no overlap, every panel edge-connected) are service-level
 * rather than CHECK constraints — they are relationships BETWEEN rows,
 * which a row-scoped CHECK cannot see.
 *
 * Deliberately NOT enforced: that the panels tile their bounding box.
 * A stepped, L-shaped assembly is a real fabricated shape; the UI flags
 * it amber, the database accepts it.
 */
export class AddWindowPanels1787632599315 implements MigrationInterface {
  name = 'AddWindowPanels1787632599315';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "window_panels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "window_id" uuid NOT NULL,
        "position" integer NOT NULL,

        "x_mm" integer NOT NULL DEFAULT 0,
        "y_mm" integer NOT NULL DEFAULT 0,
        "width_mm" integer NOT NULL,
        "height_mm" integer NOT NULL,

        "frame_platform_profile_id" uuid,
        "frame_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,

        "sash_platform_profile_id" uuid,
        "sash_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,

        "has_fly_screen" boolean NOT NULL DEFAULT false,
        "is_door" boolean NOT NULL DEFAULT false,

        "glass_kind" varchar(20) NOT NULL,
        "glass_platform_single_id" uuid,
        "glass_company_single_id" uuid REFERENCES "company_glass"("id") ON DELETE RESTRICT,
        "glass_platform_combination_id" uuid,
        "glass_company_combination_id" uuid REFERENCES "company_glass_combination"("id") ON DELETE RESTRICT,

        "opening_type" varchar(30),

        "interior_color_platform_id" uuid,
        "interior_color_company_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,
        "exterior_color_platform_id" uuid,
        "exterior_color_company_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,

        CONSTRAINT "FK_window_panels_window" FOREIGN KEY ("window_id")
          REFERENCES "windows"("id") ON DELETE CASCADE,

        CONSTRAINT "CK_window_panels_one_frame_profile"
          CHECK (num_nonnulls("frame_platform_profile_id", "frame_company_profile_id") = 1),
        CONSTRAINT "CK_window_panels_one_sash_profile"
          CHECK (num_nonnulls("sash_platform_profile_id", "sash_company_profile_id") = 1),

        CONSTRAINT "CK_window_panels_width_positive" CHECK ("width_mm" > 0),
        CONSTRAINT "CK_window_panels_height_positive" CHECK ("height_mm" > 0),
        CONSTRAINT "CK_window_panels_x_non_negative" CHECK ("x_mm" >= 0),
        CONSTRAINT "CK_window_panels_y_non_negative" CHECK ("y_mm" >= 0),
        CONSTRAINT "CK_window_panels_position_non_negative" CHECK ("position" >= 0),

        CONSTRAINT "CK_window_panels_glass_kind" CHECK ("glass_kind" IN ('single', 'combination')),
        CONSTRAINT "CK_window_panels_glass_shape" CHECK (
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

        CONSTRAINT "CK_window_panels_opening_type" CHECK (
          "opening_type" IS NULL OR "opening_type" IN (
            'top_hung',
            'fixed_closed',
            'side_hung_left',
            'side_hung_right',
            'tilt_turn_left',
            'tilt_turn_right',
            'pivot_bottom',
            'pivot_side',
            'double_door_french_a',
            'double_door_french_b',
            'single_door_hinge_left',
            'single_door_hinge_right',
            'double_door_handles_a',
            'double_door_handles_b',
            'fixed_vertical_mullion',
            'fixed_horizontal_mullion'
          )
        ),

        CONSTRAINT "CK_window_panels_interior_color_at_most_one"
          CHECK (num_nonnulls("interior_color_platform_id", "interior_color_company_id") <= 1),
        CONSTRAINT "CK_window_panels_exterior_color_at_most_one"
          CHECK (num_nonnulls("exterior_color_platform_id", "exterior_color_company_id") <= 1)
      )
    `);

    // Same one-index-per-pair-half convention AddWindows used, for the
    // same reason: Postgres does not index a foreign key automatically,
    // and every one of these is read whenever a panel's references are
    // resolved to display names.
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_window" ON "window_panels" ("window_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_frame_platform_profile" ON "window_panels" ("frame_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_frame_company_profile" ON "window_panels" ("frame_company_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_sash_platform_profile" ON "window_panels" ("sash_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_sash_company_profile" ON "window_panels" ("sash_company_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_glass_platform_single" ON "window_panels" ("glass_platform_single_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_glass_company_single" ON "window_panels" ("glass_company_single_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_glass_platform_combination" ON "window_panels" ("glass_platform_combination_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_glass_company_combination" ON "window_panels" ("glass_company_combination_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_interior_color_platform" ON "window_panels" ("interior_color_platform_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_interior_color_company" ON "window_panels" ("interior_color_company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_exterior_color_platform" ON "window_panels" ("exterior_color_platform_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_exterior_color_company" ON "window_panels" ("exterior_color_company_id")`,
    );

    // Panel order is stable and gap-free within one window — index 0 is
    // the panel WindowSummary reports as "the" frame/glass.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_window_panels_window_position"
        ON "window_panels" ("window_id", "position")
    `);

    // Backfill BEFORE dropping: every existing window becomes a
    // one-panel assembly at the origin, carrying its own build across
    // unchanged. Its width/height stay on `windows` too — for a single
    // panel at (0,0) the bounding box is exactly that panel, so the
    // derived value the service will write from now on already matches.
    await queryRunner.query(`
      INSERT INTO "window_panels" (
        "window_id", "position", "x_mm", "y_mm", "width_mm", "height_mm",
        "frame_platform_profile_id", "frame_company_profile_id",
        "sash_platform_profile_id", "sash_company_profile_id",
        "has_fly_screen", "is_door",
        "glass_kind",
        "glass_platform_single_id", "glass_company_single_id",
        "glass_platform_combination_id", "glass_company_combination_id",
        "opening_type",
        "interior_color_platform_id", "interior_color_company_id",
        "exterior_color_platform_id", "exterior_color_company_id"
      )
      SELECT
        "id", 0, 0, 0, "width_mm", "height_mm",
        "frame_platform_profile_id", "frame_company_profile_id",
        "sash_platform_profile_id", "sash_company_profile_id",
        "has_fly_screen", "is_door",
        "glass_kind",
        "glass_platform_single_id", "glass_company_single_id",
        "glass_platform_combination_id", "glass_company_combination_id",
        "opening_type",
        "interior_color_platform_id", "interior_color_company_id",
        "exterior_color_platform_id", "exterior_color_company_id"
      FROM "windows"
    `);

    // Postgres drops the indexes and CHECK constraints that depend on
    // these columns along with them, so there is no separate teardown
    // for CK_windows_glass_shape, CK_windows_opening_type, etc.
    await queryRunner.query(`
      ALTER TABLE "windows"
        DROP COLUMN "frame_platform_profile_id",
        DROP COLUMN "frame_company_profile_id",
        DROP COLUMN "sash_platform_profile_id",
        DROP COLUMN "sash_company_profile_id",
        DROP COLUMN "has_fly_screen",
        DROP COLUMN "is_door",
        DROP COLUMN "glass_kind",
        DROP COLUMN "glass_platform_single_id",
        DROP COLUMN "glass_company_single_id",
        DROP COLUMN "glass_platform_combination_id",
        DROP COLUMN "glass_company_combination_id",
        DROP COLUMN "opening_type",
        DROP COLUMN "interior_color_platform_id",
        DROP COLUMN "interior_color_company_id",
        DROP COLUMN "exterior_color_platform_id",
        DROP COLUMN "exterior_color_company_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restores AddWindows' + AddWindowOpeningType's columns, then folds
    // each assembly back to its FIRST panel. An assembly with more than
    // one panel cannot survive this — there is nowhere on a single-unit
    // `windows` row to put panels 2..n. That data loss is inherent to
    // reverting the feature, not an oversight, so it is stated here
    // rather than silently done.
    await queryRunner.query(`
      ALTER TABLE "windows"
        ADD COLUMN "frame_platform_profile_id" uuid,
        ADD COLUMN "frame_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,
        ADD COLUMN "sash_platform_profile_id" uuid,
        ADD COLUMN "sash_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,
        ADD COLUMN "has_fly_screen" boolean NOT NULL DEFAULT false,
        ADD COLUMN "is_door" boolean NOT NULL DEFAULT false,
        ADD COLUMN "glass_kind" varchar(20),
        ADD COLUMN "glass_platform_single_id" uuid,
        ADD COLUMN "glass_company_single_id" uuid REFERENCES "company_glass"("id") ON DELETE RESTRICT,
        ADD COLUMN "glass_platform_combination_id" uuid,
        ADD COLUMN "glass_company_combination_id" uuid REFERENCES "company_glass_combination"("id") ON DELETE RESTRICT,
        ADD COLUMN "opening_type" varchar(30),
        ADD COLUMN "interior_color_platform_id" uuid,
        ADD COLUMN "interior_color_company_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT,
        ADD COLUMN "exterior_color_platform_id" uuid,
        ADD COLUMN "exterior_color_company_id" uuid REFERENCES "company_color"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      UPDATE "windows" w SET
        "frame_platform_profile_id" = p."frame_platform_profile_id",
        "frame_company_profile_id" = p."frame_company_profile_id",
        "sash_platform_profile_id" = p."sash_platform_profile_id",
        "sash_company_profile_id" = p."sash_company_profile_id",
        "has_fly_screen" = p."has_fly_screen",
        "is_door" = p."is_door",
        "glass_kind" = p."glass_kind",
        "glass_platform_single_id" = p."glass_platform_single_id",
        "glass_company_single_id" = p."glass_company_single_id",
        "glass_platform_combination_id" = p."glass_platform_combination_id",
        "glass_company_combination_id" = p."glass_company_combination_id",
        "opening_type" = p."opening_type",
        "interior_color_platform_id" = p."interior_color_platform_id",
        "interior_color_company_id" = p."interior_color_company_id",
        "exterior_color_platform_id" = p."exterior_color_platform_id",
        "exterior_color_company_id" = p."exterior_color_company_id"
      FROM "window_panels" p
      WHERE p."window_id" = w."id" AND p."position" = 0
    `);

    // Only now can glass_kind take its NOT NULL back, and only now can
    // the pair CHECKs hold — they would have failed against the empty
    // columns the ADD COLUMN above created.
    await queryRunner.query(
      `ALTER TABLE "windows" ALTER COLUMN "glass_kind" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "windows"
        ADD CONSTRAINT "CK_windows_one_frame_profile"
          CHECK (num_nonnulls("frame_platform_profile_id", "frame_company_profile_id") = 1),
        ADD CONSTRAINT "CK_windows_one_sash_profile"
          CHECK (num_nonnulls("sash_platform_profile_id", "sash_company_profile_id") = 1),
        ADD CONSTRAINT "CK_windows_glass_kind"
          CHECK ("glass_kind" IN ('single', 'combination')),
        ADD CONSTRAINT "CK_windows_glass_shape" CHECK (
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
        ADD CONSTRAINT "CK_windows_opening_type" CHECK (
          "opening_type" IS NULL OR "opening_type" IN (
            'top_hung',
            'fixed_closed',
            'side_hung_left',
            'side_hung_right',
            'tilt_turn_left',
            'tilt_turn_right',
            'pivot_bottom',
            'pivot_side',
            'double_door_french_a',
            'double_door_french_b',
            'single_door_hinge_left',
            'single_door_hinge_right',
            'double_door_handles_a',
            'double_door_handles_b',
            'fixed_vertical_mullion',
            'fixed_horizontal_mullion'
          )
        ),
        ADD CONSTRAINT "CK_windows_interior_color_at_most_one"
          CHECK (num_nonnulls("interior_color_platform_id", "interior_color_company_id") <= 1),
        ADD CONSTRAINT "CK_windows_exterior_color_at_most_one"
          CHECK (num_nonnulls("exterior_color_platform_id", "exterior_color_company_id") <= 1)
    `);

    await queryRunner.query(`DROP TABLE "window_panels"`);
  }
}
