import { MigrationInterface, QueryRunner } from 'typeorm';

// AuthService.refresh finds the session by `refresh_token_hash` on every
// token refresh — every user, every access-token lifetime — and the
// column had no index, so each lookup was a sequential scan (stability
// S15). Unique as well: a hash of 32 random bytes never repeats, and if
// one ever did, two sessions answering to one token is a bug worth
// failing on.
export class AddSessionRefreshTokenHashIndex1791812099000 implements MigrationInterface {
  name = 'AddSessionRefreshTokenHashIndex1791812099000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sessions_refresh_token_hash" ON "sessions" ("refresh_token_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_sessions_refresh_token_hash"`);
  }
}
