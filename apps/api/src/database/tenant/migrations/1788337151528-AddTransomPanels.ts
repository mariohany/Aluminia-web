import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives `window_panels` a second panel type — a transom: a bar of frame
 * profile with glass and no sash. See docs/transom_planing.md §2.
 *
 * `panel_type` is a plain varchar CHECK list, same posture as
 * `glass_kind`/`opening_type`/`head_shape` on this same table. Every
 * existing row defaults to `'window'`, which is exactly what it already
 * is — no backfill needed beyond the column default.
 *
 * A transom gets its OWN profile reference pair
 * (`transom_platform_profile_id`/`transom_company_profile_id`), not a
 * reuse of `frame_platform_profile_id`/`frame_company_profile_id` —
 * decision 7 in the planing doc rejected reusing the frame slot because
 * a transom's profile is drawn from `ProfileType.TRANSOM`, a distinct
 * catalogue category from the frame profiles a window's own
 * `frame_profile_id` draws from, and collapsing them would make it
 * impossible to tell which catalogue a stored id was validated against.
 *
 * The three profile-shape CHECKs (`one_frame_profile`, `one_sash_profile`,
 * new `transom_profile_by_type`) are all rewritten to be type-aware
 * rather than unconditional: a window panel still needs exactly one
 * frame id and exactly one sash id and no transom id; a transom panel
 * needs exactly one transom id and no frame/sash id at all. Two more
 * CHECKs pin the rest of decision 1 (transom = profile + glass, nothing
 * else): a transom's `head_shape` must be `'flat'` (arched transoms are
 * explicitly deferred, planing doc §7) and its `opening_type`/
 * `has_fly_screen`/`is_door` must all be unset — a transom is never a
 * hinged sash, a fly-screen host, or a door, so those columns simply
 * don't apply, the same "not rendered, not merely disabled" posture the
 * options-panel side of this feature uses (tasks doc Step 6).
 *
 * `sash_platform_profile_id`/`sash_company_profile_id`/`opening_type`
 * were already nullable in this table before this migration (a window
 * panel with a fixed, non-opening sash already leaves `opening_type`
 * NULL) — nothing to alter there. `has_fly_screen`/`is_door` stay
 * `NOT NULL DEFAULT false`: a transom row simply takes the default,
 * same as any window panel that has neither.
 */
export class AddTransomPanels1788337151528 implements MigrationInterface {
  name = 'AddTransomPanels1788337151528';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD COLUMN "panel_type" varchar(10) NOT NULL DEFAULT 'window',
        ADD COLUMN "transom_platform_profile_id" uuid,
        ADD COLUMN "transom_company_profile_id" uuid
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_window_panels_transom_platform_profile"
        ON "window_panels" ("transom_platform_profile_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_window_panels_transom_company_profile"
        ON "window_panels" ("transom_company_profile_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "window_panels_transom_company_profile_id_fkey"
          FOREIGN KEY ("transom_company_profile_id")
          REFERENCES "company_system_profile" ("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "CK_window_panels_one_frame_profile",
        DROP CONSTRAINT "CK_window_panels_one_sash_profile"
    `);

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
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "CK_window_panels_transom_no_extras",
        DROP CONSTRAINT "CK_window_panels_transom_flat_head",
        DROP CONSTRAINT "CK_window_panels_transom_profile_by_type",
        DROP CONSTRAINT "CK_window_panels_sash_profile_by_type",
        DROP CONSTRAINT "CK_window_panels_frame_profile_by_type",
        DROP CONSTRAINT "CK_window_panels_panel_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "CK_window_panels_one_sash_profile" CHECK (
          num_nonnulls("sash_platform_profile_id", "sash_company_profile_id") = 1
        ),
        ADD CONSTRAINT "CK_window_panels_one_frame_profile" CHECK (
          num_nonnulls("frame_platform_profile_id", "frame_company_profile_id") = 1
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "window_panels_transom_company_profile_id_fkey"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_window_panels_transom_company_profile"
    `);
    await queryRunner.query(`
      DROP INDEX "IDX_window_panels_transom_platform_profile"
    `);

    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "transom_company_profile_id",
        DROP COLUMN "transom_platform_profile_id",
        DROP COLUMN "panel_type"
    `);
  }
}
