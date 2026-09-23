import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces "one panel = one light" with a real grid inside a panel —
 * docs/sections_planing.md, Tier 3 of the elevation-detail work,
 * pulled forward after a coupled transom panel drew as a second frame
 * instead of sharing the real one.
 *
 * `window_panels` keeps everything shared by the whole frame (profile,
 * head, colours, is-door) plus three new columns describing its grid:
 * `column_widths`/`row_heights` (boundary-to-boundary pitches, jsonb —
 * same posture as `bars`, see AddPanelArchHeads' own comment on why a
 * shape this irregular isn't a child table) and a `divider_profile`
 * pair (decision 4: one profile for every mullion/transom in the
 * panel, required iff the grid is bigger than 1×1 — the "iff" half of
 * that is a service rule, since it needs the jsonb array lengths a
 * CHECK can't easily reach into; the "not both halves set" half IS a
 * CHECK, `CK_window_panels_divider_profile`, same shape as the colour
 * pairs on this table).
 *
 * Every field that used to vary per-panel (sash, opening type, glass,
 * fly screen) moves to a new `window_sections` table, one row per grid
 * cell (`row`/`col`, 0-based, UNIQUE per panel). Its CHECKs mirror the
 * ones `window_panels` had for the equivalent columns: sash pair
 * `num_nonnulls` = 1 when opening / 0 when fixed, the same 4-column
 * glass shape CHECK. `opening_type` is forced NULL for a fixed
 * section, but is only ever OPTIONAL for an opening one — it's a
 * `HingedOpeningType`, meaningful only once a panel's frame resolves
 * to a hinged system, which this row has no way to know. A sliding or
 * curtain-wall section is genuinely opening (it has a sash) with no
 * opening type at all, confirmed against real data: this migration's
 * first draft required `opening_type` for every opening section and
 * failed applying to Cairo Aluminium Works' schema for exactly this
 * shape (fixed 2026-09-13, `.wolf/buglog.json`). There is no
 * fixed-section-can't-have-a-fly-screen CHECK here — that rule (and
 * every cross-row grid rule: sums, cell coverage, arch+grid
 * interaction) is Zod's `windowPanelSchema.superRefine`
 * (packages/types/src/windows.ts), re-checked server-side by
 * `validateGrid` in Step 3 — the same "CHECK can't see relationships
 * between rows" reasoning `window_panels`' own overlap/connectivity
 * rules have always used.
 *
 * `panel_type` (`PanelType.TRANSOM`) is gone — decision 3, Mario:
 * "remove any old rows". Every surviving panel is the one shape this
 * table now describes; the type-aware CHECKs `AddTransomPanels` added
 * (`*_by_type`) go with it, replaced by an unconditional
 * `CK_window_panels_one_frame_profile` (every panel needs exactly one
 * frame profile now, no exceptions). The transom's own profile pair,
 * and the old panel-level sash/opening/glass/fly-screen columns, are
 * dropped in the same statement that drops `panel_type` — Postgres
 * drops any CHECK/index/FK that mentions a dropped column along with
 * it, so there is no separate teardown, same as `AddWindowPanels`'
 * own comment on this.
 *
 * Data, in order: (1) every `panel_type = 'window'` row becomes a
 * one-cell grid — `column_widths = [width_mm]`, `row_heights =
 * [height_mm]`, and its sash/opening/glass/fly-screen columns move
 * into a new section `(0, 0)`. A `fixed_closed` row's sash reference is
 * dropped, not carried over — it was never drawn (the panel-level
 * "fixed light" rule built 2026-09-13). (2) every `panel_type =
 * 'transom'` row is DELETED — **not restorable**, stated here as the
 * task doc requires. (3) each window's remaining panels are shifted so
 * the minimum x/y is 0 again, and the window's own `width_mm`/
 * `height_mm` are recomputed from what's left; a window left with zero
 * panels (it was a lone transom) is deleted outright. Panel `position`
 * values are NOT renumbered — removing a panel can leave a gap, which
 * nothing besides display order depends on (the unique index only
 * forbids two panels sharing one position, not contiguity).
 *
 * `down()` reverses structurally: recreates the dropped columns, folds
 * each panel back to its section `(0, 0)` (a real multi-section panel
 * — anything Step 3 onward actually lets a user create — loses every
 * OTHER section the same way `AddWindowPanels`' own down() already
 * loses panels 2..n of a multi-panel assembly), then drops
 * `window_sections` and the grid columns. Deleted transom rows from
 * `up()` stay deleted; there is nothing left to reconstruct them from.
 */
export class AddWindowSections1788500000000 implements MigrationInterface {
  name = 'AddWindowSections1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. window_sections
    await queryRunner.query(`
      CREATE TABLE "window_sections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "panel_id" uuid NOT NULL,
        "row" integer NOT NULL,
        "col" integer NOT NULL,

        "section_kind" varchar(10) NOT NULL,

        "sash_platform_profile_id" uuid,
        "sash_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,
        "opening_type" varchar(30),

        "glass_kind" varchar(20) NOT NULL,
        "glass_platform_single_id" uuid,
        "glass_company_single_id" uuid REFERENCES "company_glass"("id") ON DELETE RESTRICT,
        "glass_platform_combination_id" uuid,
        "glass_company_combination_id" uuid REFERENCES "company_glass_combination"("id") ON DELETE RESTRICT,

        "has_fly_screen" boolean NOT NULL DEFAULT false,

        CONSTRAINT "FK_window_sections_panel" FOREIGN KEY ("panel_id")
          REFERENCES "window_panels"("id") ON DELETE CASCADE,

        CONSTRAINT "CK_window_sections_row_non_negative" CHECK ("row" >= 0),
        CONSTRAINT "CK_window_sections_col_non_negative" CHECK ("col" >= 0),

        CONSTRAINT "CK_window_sections_section_kind" CHECK ("section_kind" IN ('fixed', 'opening')),

        CONSTRAINT "CK_window_sections_sash_by_kind" CHECK (
          ("section_kind" = 'opening' AND num_nonnulls("sash_platform_profile_id", "sash_company_profile_id") = 1)
          OR ("section_kind" = 'fixed' AND "sash_platform_profile_id" IS NULL AND "sash_company_profile_id" IS NULL)
        ),
        -- Only the "fixed" half is a hard rule. A fixed section never
        -- has an opening type; an "opening" one MAY have one (a hinged
        -- leaf's HingedOpeningType) or may not (sliding/curtain-wall
        -- sections are genuinely opening but have no such value — real
        -- data, see this migration's own class comment).
        CONSTRAINT "CK_window_sections_opening_type_by_kind" CHECK (
          "section_kind" = 'opening' OR "opening_type" IS NULL
        ),
        CONSTRAINT "CK_window_sections_opening_type" CHECK (
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

        CONSTRAINT "CK_window_sections_glass_kind" CHECK ("glass_kind" IN ('single', 'combination')),
        CONSTRAINT "CK_window_sections_glass_shape" CHECK (
          (
            "glass_kind" = 'single'
            AND num_nonnulls("glass_platform_single_id", "glass_company_single_id") = 1
            AND "glass_platform_combination_id" IS NULL AND "glass_company_combination_id" IS NULL
          ) OR (
            "glass_kind" = 'combination'
            AND num_nonnulls("glass_platform_combination_id", "glass_company_combination_id") = 1
            AND "glass_platform_single_id" IS NULL AND "glass_company_single_id" IS NULL
          )
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_panel" ON "window_sections" ("panel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_sash_platform_profile" ON "window_sections" ("sash_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_sash_company_profile" ON "window_sections" ("sash_company_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_glass_platform_single" ON "window_sections" ("glass_platform_single_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_glass_company_single" ON "window_sections" ("glass_company_single_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_glass_platform_combination" ON "window_sections" ("glass_platform_combination_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_glass_company_combination" ON "window_sections" ("glass_company_combination_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_window_sections_panel_row_col" ON "window_sections" ("panel_id", "row", "col")
    `);

    // 2. window_panels: the grid columns
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD COLUMN "column_widths" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "row_heights" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "divider_platform_profile_id" uuid,
        ADD COLUMN "divider_company_profile_id" uuid
          REFERENCES "company_system_profile"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_divider_platform_profile" ON "window_panels" ("divider_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_panels_divider_company_profile" ON "window_panels" ("divider_company_profile_id")`,
    );

    // 3. Backfill: every 'window' panel becomes a 1×1 grid with its old
    // sash/opening/glass/fly-screen columns moved into section (0, 0).
    await queryRunner.query(`
      UPDATE "window_panels"
      SET "column_widths" = jsonb_build_array("width_mm"),
          "row_heights" = jsonb_build_array("height_mm")
      WHERE "panel_type" = 'window'
    `);
    await queryRunner.query(`
      INSERT INTO "window_sections" (
        "panel_id", "row", "col", "section_kind",
        "sash_platform_profile_id", "sash_company_profile_id", "opening_type",
        "glass_kind",
        "glass_platform_single_id", "glass_company_single_id",
        "glass_platform_combination_id", "glass_company_combination_id",
        "has_fly_screen"
      )
      SELECT
        "id", 0, 0,
        CASE WHEN "opening_type" = 'fixed_closed' THEN 'fixed' ELSE 'opening' END,
        CASE WHEN "opening_type" = 'fixed_closed' THEN NULL ELSE "sash_platform_profile_id" END,
        CASE WHEN "opening_type" = 'fixed_closed' THEN NULL ELSE "sash_company_profile_id" END,
        CASE WHEN "opening_type" = 'fixed_closed' THEN NULL ELSE "opening_type" END,
        "glass_kind",
        "glass_platform_single_id", "glass_company_single_id",
        "glass_platform_combination_id", "glass_company_combination_id",
        CASE WHEN "opening_type" = 'fixed_closed' THEN false ELSE "has_fly_screen" END
      FROM "window_panels"
      WHERE "panel_type" = 'window'
    `);

    // 4. Drop every transom panel (decision 3 — not restorable), then
    // re-normalise each window's remaining panels and derived size.
    await queryRunner.query(
      `DELETE FROM "window_panels" WHERE "panel_type" = 'transom'`,
    );

    await queryRunner.query(`
      WITH mins AS (
        SELECT "window_id", MIN("x_mm") AS min_x, MIN("y_mm") AS min_y
        FROM "window_panels"
        GROUP BY "window_id"
      )
      UPDATE "window_panels" p
      SET "x_mm" = p."x_mm" - m.min_x,
          "y_mm" = p."y_mm" - m.min_y
      FROM mins m
      WHERE p."window_id" = m."window_id" AND (m.min_x <> 0 OR m.min_y <> 0)
    `);

    await queryRunner.query(`
      WITH bounds AS (
        SELECT "window_id", MAX("x_mm" + "width_mm") AS max_w, MAX("y_mm" + "height_mm") AS max_h
        FROM "window_panels"
        GROUP BY "window_id"
      )
      UPDATE "windows" w
      SET "width_mm" = b.max_w, "height_mm" = b.max_h
      FROM bounds b
      WHERE w."id" = b."window_id"
    `);

    await queryRunner.query(`
      DELETE FROM "windows" w
      WHERE NOT EXISTS (SELECT 1 FROM "window_panels" p WHERE p."window_id" = w."id")
    `);

    // 5. Drop the moved/retired columns — every CHECK/index/FK that
    // mentioned only these (or `panel_type` alongside a surviving
    // column, e.g. the frame-profile "*_by_type" CHECKs) goes with
    // them automatically.
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "panel_type",
        DROP COLUMN "transom_platform_profile_id",
        DROP COLUMN "transom_company_profile_id",
        DROP COLUMN "sash_platform_profile_id",
        DROP COLUMN "sash_company_profile_id",
        DROP COLUMN "opening_type",
        DROP COLUMN "glass_kind",
        DROP COLUMN "glass_platform_single_id",
        DROP COLUMN "glass_company_single_id",
        DROP COLUMN "glass_platform_combination_id",
        DROP COLUMN "glass_company_combination_id",
        DROP COLUMN "has_fly_screen"
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "CK_window_panels_one_frame_profile"
          CHECK (num_nonnulls("frame_platform_profile_id", "frame_company_profile_id") = 1),
        ADD CONSTRAINT "CK_window_panels_divider_profile"
          CHECK (num_nonnulls("divider_platform_profile_id", "divider_company_profile_id") <= 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "CK_window_panels_divider_profile",
        DROP CONSTRAINT "CK_window_panels_one_frame_profile"
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD COLUMN "panel_type" varchar(10) NOT NULL DEFAULT 'window',
        ADD COLUMN "sash_platform_profile_id" uuid,
        ADD COLUMN "sash_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT,
        ADD COLUMN "opening_type" varchar(30),
        ADD COLUMN "glass_kind" varchar(20),
        ADD COLUMN "glass_platform_single_id" uuid,
        ADD COLUMN "glass_company_single_id" uuid REFERENCES "company_glass"("id") ON DELETE RESTRICT,
        ADD COLUMN "glass_platform_combination_id" uuid,
        ADD COLUMN "glass_company_combination_id" uuid REFERENCES "company_glass_combination"("id") ON DELETE RESTRICT,
        ADD COLUMN "has_fly_screen" boolean NOT NULL DEFAULT false,
        ADD COLUMN "transom_platform_profile_id" uuid,
        ADD COLUMN "transom_company_profile_id" uuid REFERENCES "company_system_profile"("id") ON DELETE RESTRICT
    `);

    // Folds each panel back to its section (0, 0) — any OTHER section
    // (a real grid, only reachable from Step 3 onward) is lost, same
    // posture AddWindowPanels' own down() already has for panels 2..n.
    await queryRunner.query(`
      UPDATE "window_panels" p SET
        "sash_platform_profile_id" = s."sash_platform_profile_id",
        "sash_company_profile_id" = s."sash_company_profile_id",
        "opening_type" = s."opening_type",
        "glass_kind" = s."glass_kind",
        "glass_platform_single_id" = s."glass_platform_single_id",
        "glass_company_single_id" = s."glass_company_single_id",
        "glass_platform_combination_id" = s."glass_platform_combination_id",
        "glass_company_combination_id" = s."glass_company_combination_id",
        "has_fly_screen" = s."has_fly_screen"
      FROM "window_sections" s
      WHERE s."panel_id" = p."id" AND s."row" = 0 AND s."col" = 0
    `);

    await queryRunner.query(
      `ALTER TABLE "window_panels" ALTER COLUMN "glass_kind" SET NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "CK_window_panels_panel_type" CHECK (
          "panel_type" IN ('window', 'transom')
        ),
        ADD CONSTRAINT "CK_window_panels_frame_profile_by_type" CHECK (
          ("panel_type" = 'window' AND num_nonnulls("frame_platform_profile_id", "frame_company_profile_id") = 1)
          OR ("panel_type" = 'transom' AND "frame_platform_profile_id" IS NULL AND "frame_company_profile_id" IS NULL)
        ),
        ADD CONSTRAINT "CK_window_panels_sash_profile_by_type" CHECK (
          ("panel_type" = 'window' AND num_nonnulls("sash_platform_profile_id", "sash_company_profile_id") = 1)
          OR ("panel_type" = 'transom' AND "sash_platform_profile_id" IS NULL AND "sash_company_profile_id" IS NULL)
        ),
        ADD CONSTRAINT "CK_window_panels_transom_profile_by_type" CHECK (
          ("panel_type" = 'transom' AND num_nonnulls("transom_platform_profile_id", "transom_company_profile_id") = 1)
          OR ("panel_type" = 'window' AND "transom_platform_profile_id" IS NULL AND "transom_company_profile_id" IS NULL)
        ),
        ADD CONSTRAINT "CK_window_panels_transom_flat_head" CHECK (
          "panel_type" <> 'transom' OR "head_shape" = 'flat'
        ),
        ADD CONSTRAINT "CK_window_panels_transom_no_extras" CHECK (
          "panel_type" <> 'transom'
          OR ("opening_type" IS NULL AND "has_fly_screen" = false AND "is_door" = false)
        ),
        ADD CONSTRAINT "CK_window_panels_glass_kind" CHECK ("glass_kind" IN ('single', 'combination')),
        ADD CONSTRAINT "CK_window_panels_glass_shape" CHECK (
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
        ADD CONSTRAINT "CK_window_panels_opening_type" CHECK (
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
        )
    `);

    await queryRunner.query(`DROP TABLE "window_sections"`);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "divider_company_profile_id",
        DROP COLUMN "divider_platform_profile_id",
        DROP COLUMN "row_heights",
        DROP COLUMN "column_widths"
    `);
  }
}
