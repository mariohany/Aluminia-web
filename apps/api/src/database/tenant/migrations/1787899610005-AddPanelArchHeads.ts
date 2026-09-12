import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives a panel an arched head and a set of freely-drawn glazing bars —
 * docs/arch_windows_planing.md §1/§4.
 *
 * `head_shape` is a plain varchar CHECK list, same posture as
 * `glass_kind`/`opening_type` on this same table: the platform enum
 * types live in `public`, outside the tenant search_path, and Zod
 * (packages/types/src/windows.ts's HeadShape) is the real enforcement
 * point for API callers. `head_rise_mm` is NULL iff the shape is
 * `'flat'` — a panel that was never touched by this feature (every
 * existing row) still reads back exactly that: `'flat'`, NULL rise, an
 * empty `bars` array. No backfill needed; the column defaults already
 * express "this panel doesn't have one."
 *
 * `bars` is a `jsonb` column, not a child table — an explicit,
 * deliberate call (planing doc decision 10), unlike every profile/glass
 * reference on this table, which gets a real FK precisely because THIS
 * migration's siblings argue a dangling reference is broken data. The
 * trade-off accepted here: a CHECK can rule out bars on a flat head, but
 * it cannot see INSIDE the array to prove ids are unique or that every
 * anchor only references something earlier in it — that validation
 * lives in WindowsService.validatePanelHead, re-implemented
 * independently of the Zod schema, same posture as every other
 * assembly-level invariant in this codebase (no overlap, connectivity).
 */
export class AddPanelArchHeads1787899610005 implements MigrationInterface {
  name = 'AddPanelArchHeads1787899610005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD COLUMN "head_shape" varchar(12) NOT NULL DEFAULT 'flat',
        ADD COLUMN "head_rise_mm" integer,
        ADD COLUMN "bars" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        ADD CONSTRAINT "CK_window_panels_head_shape" CHECK (
          "head_shape" IN ('flat', 'round', 'segmental', 'gothic')
        ),
        ADD CONSTRAINT "CK_window_panels_head_rise" CHECK (
          ("head_shape" = 'flat') = ("head_rise_mm" IS NULL)
        ),
        ADD CONSTRAINT "CK_window_panels_bars_flat" CHECK (
          "head_shape" <> 'flat' OR "bars" = '[]'::jsonb
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "CK_window_panels_bars_flat",
        DROP CONSTRAINT "CK_window_panels_head_rise",
        DROP CONSTRAINT "CK_window_panels_head_shape"
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "bars",
        DROP COLUMN "head_rise_mm",
        DROP COLUMN "head_shape"
    `);
  }
}
