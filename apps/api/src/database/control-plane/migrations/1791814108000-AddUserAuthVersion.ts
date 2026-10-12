import { MigrationInterface, QueryRunner } from 'typeorm';

// Stability S3: an access token is a JWT checked only by its signature,
// so a deactivated, demoted or moved user kept their old access for up
// to its 15-minute lifetime. Each user now has a version number, carried
// in the token as `ver` and bumped by every change to their access;
// JwtAuthGuard refuses a token whose version is behind
// (AuthVersionService). Existing users start at 0, which is also what a
// token issued before this migration (no `ver`) counts as.
export class AddUserAuthVersion1791814108000 implements MigrationInterface {
  name = 'AddUserAuthVersion1791814108000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "auth_version" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "auth_version"`);
  }
}
