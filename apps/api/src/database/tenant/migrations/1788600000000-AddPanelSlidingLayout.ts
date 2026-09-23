import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A sliding frame's rails and sashes — docs/sliding_windows_planing.md
 * §2, decision 1. Until now a sliding panel stored NOTHING about how it
 * slides: the drawing always showed two leaves, and the section's
 * `opening_type` (a `HingedOpeningType`) stayed NULL. This adds one
 * nullable jsonb column on `window_panels` — the panel is the frame,
 * and rails are a frame fact — holding `{ rails, sashes: [{ rail,
 * openingType, directionSource }] }`.
 *
 * jsonb rather than a child table, same reasoning as `bars` (see
 * AddPanelArchHeads): every real rule on this blob — rail < rails, an
 * `auto` sash agreeing with the neighbour rule, no sash sliding into
 * the frame or a same-rail neighbour — relates array elements to each
 * other and to the frame, which a CHECK can't reach. Those live in
 * `slidingLayoutSchema` (packages/types/src/sliding.ts), enforced on
 * every write by the global ZodValidationPipe. The CHECK here is only a
 * shape guard: null, or an object with a `sashes` array.
 *
 * Deliberately NULLABLE and deliberately NOT backfilled (decision 5,
 * the same call Mario made for `bead_*` on `window_sections`): every
 * sliding panel written before this migration reads back NULL, and
 * the editor shows a `slidingLayoutRequired` error on it until the
 * user picks a layout themselves — rather than this migration guessing
 * `[0, 1]` for windows a manufacturer has already quoted. NULL is
 * also the correct, permanent value for every hinged / curtain-wall
 * panel and for a FIXED sliding frame (decision 6: "fixed" is the
 * section's kind, not a layout with zero sashes), so the column can't
 * be made NOT NULL later either.
 */
export class AddPanelSlidingLayout1788600000000 implements MigrationInterface {
  name = 'AddPanelSlidingLayout1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP CONSTRAINT "CK_window_panels_sliding_shape"
    `);
    await queryRunner.query(`
      ALTER TABLE "window_panels"
        DROP COLUMN "sliding"
    `);
  }
}
