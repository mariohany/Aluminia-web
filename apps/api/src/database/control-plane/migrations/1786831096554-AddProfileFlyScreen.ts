import { MigrationInterface, QueryRunner } from 'typeorm';

// A profile's capability, not its identity — whether a fly screen can be
// fitted to this extrusion. Defaults to false: every profile that exists
// today starts as "no fly screen" until an admin explicitly ticks it,
// rather than the software silently claiming a capability nobody
// verified. See docs/window_creation_planing.md Section 1.
export class AddProfileFlyScreen1786831096554 implements MigrationInterface {
  name = 'AddProfileFlyScreen1786831096554';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "system_profile" ADD COLUMN "accepts_fly_screen" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "system_profile" DROP COLUMN "accepts_fly_screen"`,
    );
  }
}
