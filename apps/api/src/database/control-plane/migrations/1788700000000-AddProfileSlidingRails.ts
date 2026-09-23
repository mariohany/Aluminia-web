import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A sliding frame extrusion's rail (track) count — docs/sliding_windows_planing.md
 * §11, decisions 11–12. Like `accepts_fly_screen`, a capability of the
 * profile rather than a window fact: the editor used to ask for the
 * rail count per window (a `rails` field inside `window_panels.sliding`),
 * Mario moved it here so a frame profile carries it once and every
 * window built on that profile reads it.
 *
 * NULLABLE, with a shape CHECK (2–4 when set). It only means anything
 * for a FRAME profile in a SLIDING catalogue; the API's
 * `normalizeSlidingRails` writes NULL for every other profile, so the
 * CHECK doesn't try to encode the catalogue join.
 *
 * BACKFILLED to 2 for every frame profile in a sliding catalogue —
 * deliberately the opposite of the fly-screen default and of the
 * window-side "flag it, don't guess" posture: Mario, 2026-09-20, "by
 * default any sliding frame now should be 2 rails until user change
 * that". A NULL here would block every sliding window in every tenant
 * until an admin visited the catalogue; 2 is the common extrusion and
 * one click to change on the profile.
 */
export class AddProfileSlidingRails1788700000000 implements MigrationInterface {
  name = 'AddProfileSlidingRails1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "system_profile" ADD COLUMN "sliding_rails" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_profile"
         ADD CONSTRAINT "CK_system_profile_sliding_rails"
         CHECK ("sliding_rails" IS NULL OR "sliding_rails" BETWEEN 2 AND 4)`,
    );
    await queryRunner.query(
      `UPDATE "system_profile" AS p
         SET "sliding_rails" = 2
         FROM "system_catalog" AS c
         WHERE c.id = p."catalog_id"
           AND p."profile_type" = 'frame'
           AND c."system_type" = 'sliding'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "system_profile" DROP CONSTRAINT "CK_system_profile_sliding_rails"`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_profile" DROP COLUMN "sliding_rails"`,
    );
  }
}
