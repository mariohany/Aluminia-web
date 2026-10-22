import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A profile's face width in mm (docs/mitre_cuts_planing.md §4, M1 + M7):
 * how wide the extrusion shows in the elevation. Every profile type has
 * it; today only frame and leaf profiles use it, for the metal their 45°
 * ends take off (the report's real waste). NULLABLE with no backfill:
 * empty means the drawing's placeholder widths (frame 45, sash 60), which
 * is what every report counted with until now.
 */
export class AddProfileFaceWidth1792700000000 implements MigrationInterface {
  name = 'AddProfileFaceWidth1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "system_profile" ADD COLUMN "face_width_mm" real`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_profile"
         ADD CONSTRAINT "CK_system_profile_face_width_mm"
         CHECK ("face_width_mm" IS NULL OR ("face_width_mm" > 0 AND "face_width_mm" <= 500))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "system_profile" DROP CONSTRAINT "CK_system_profile_face_width_mm"`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_profile" DROP COLUMN "face_width_mm"`,
    );
  }
}
