import { MigrationInterface, QueryRunner } from 'typeorm';

// Tenant-side counterpart of the control-plane's AddProfileFlyScreen —
// a company's own profiles need the same capability flag as the
// platform catalogue's. Same default, same rationale: false until a
// company explicitly ticks it. See docs/window_creation_planing.md
// Section 1.
export class AddCompanyProfileFlyScreen1786831096555 implements MigrationInterface {
  name = 'AddCompanyProfileFlyScreen1786831096555';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" ADD COLUMN "accepts_fly_screen" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_system_profile" DROP COLUMN "accepts_fly_screen"`,
    );
  }
}
