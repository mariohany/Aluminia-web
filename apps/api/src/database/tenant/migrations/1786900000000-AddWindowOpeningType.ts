import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A hinged window's opening type (top-hung, side-hung left/right,
 * tilt-turn left/right, pivot bottom/side, the double-door/French
 * variants, single-door, and the two fixed-mullion splits) — picked from
 * the Design step's "Type" icon grid and drawn on the elevation. See
 * packages/types/src/windows.ts's HingedOpeningType for the full list —
 * this CHECK mirrors it exactly, the same "plain varchar + CHECK IN
 * (...)" shape AddWindows used for glass_kind, for the same reason: the
 * platform enum type lives in `public`, outside the tenant search_path.
 *
 * Nullable and unconstrained beyond the value list — a sliding or
 * curtain-wall window (or a hinged one nobody has picked a type for yet)
 * simply leaves this null. Nothing else on the row depends on it.
 */
export class AddWindowOpeningType1786900000000 implements MigrationInterface {
  name = 'AddWindowOpeningType1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "windows" ADD COLUMN "opening_type" varchar(30)
    `);
    await queryRunner.query(`
      ALTER TABLE "windows" ADD CONSTRAINT "CK_windows_opening_type" CHECK (
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "windows" DROP CONSTRAINT "CK_windows_opening_type"`,
    );
    await queryRunner.query(`ALTER TABLE "windows" DROP COLUMN "opening_type"`);
  }
}
