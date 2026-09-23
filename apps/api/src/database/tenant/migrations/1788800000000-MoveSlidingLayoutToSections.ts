import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The sliding layout moves from the panel to the SECTION —
 * docs/sliding_windows_planing.md §12 (2026-09-20). AddPanelSlidingLayout
 * put `sliding` on `window_panels` on the assumption that a sliding
 * frame is always exactly one section; Mario reversed that ("create a
 * sliding window and add a transom or mullion next to it for fixed
 * section"), so the layout now lives where every other per-light fact
 * does (sections decision 7): each section of a sliding panel is fixed
 * or sliding on its own.
 *
 * Same column, same shape CHECK, same nullability and the same
 * no-backfill posture as before (decision 5) — only the table changes.
 * Existing data: every panel's layout is copied onto its section
 * `(0, 0)` — the only section a sliding panel could have had until
 * now — and the panel column is dropped. `down` reverses both, keeping
 * only section `(0, 0)`'s layout (a divided sliding panel can't be
 * represented on the old shape, so any other section's is lost —
 * acceptable for a dev-only revert).
 */
export class MoveSlidingLayoutToSections1788800000000 implements MigrationInterface {
  name = 'MoveSlidingLayoutToSections1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ADD COLUMN "sliding" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ADD CONSTRAINT "CK_window_sections_sliding_shape" CHECK (
          "sliding" IS NULL
          OR (jsonb_typeof("sliding") = 'object' AND jsonb_typeof("sliding"->'sashes') = 'array')
        )
    `);
    await queryRunner.query(`
      UPDATE "window_sections" s
        SET "sliding" = p."sliding"
        FROM "window_panels" p
        WHERE p."id" = s."panel_id" AND s."row" = 0 AND s."col" = 0 AND p."sliding" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "CK_window_panels_sliding_shape"
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "sliding"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD COLUMN "sliding" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "CK_window_panels_sliding_shape" CHECK (
          "sliding" IS NULL
          OR (jsonb_typeof("sliding") = 'object' AND jsonb_typeof("sliding"->'sashes') = 'array')
        )
    `);
    await queryRunner.query(`
      UPDATE "window_panels" p
        SET "sliding" = s."sliding"
        FROM "window_sections" s
        WHERE s."panel_id" = p."id" AND s."row" = 0 AND s."col" = 0 AND s."sliding" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        DROP CONSTRAINT "CK_window_sections_sliding_shape"
    `);
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        DROP COLUMN "sliding"
    `);
  }
}
