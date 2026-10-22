import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant-side counterpart of the control-plane's AddProfileFaceWidth: a
 * company's own profiles carry the same nullable face width, same CHECK,
 * no backfill (docs/mitre_cuts_planing.md §4).
 */
export class AddCompanyProfileFaceWidth1792700000001 implements MigrationInterface {
  name = 'AddCompanyProfileFaceWidth1792700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" ADD COLUMN "face_width_mm" real`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_system_profile"
         ADD CONSTRAINT "CK_company_system_profile_face_width_mm"
         CHECK ("face_width_mm" IS NULL OR ("face_width_mm" > 0 AND "face_width_mm" <= 500))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" DROP CONSTRAINT "CK_company_system_profile_face_width_mm"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" DROP COLUMN "face_width_mm"`,
    );
  }
}
