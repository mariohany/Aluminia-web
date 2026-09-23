import { MigrationInterface, QueryRunner } from 'typeorm';

// Refresh tokens rotate on every call and the old one used to die
// instantly, which logged a browser out whenever two page loads
// refreshed at once (Chrome restoring several tabs on startup, a
// duplicated tab): one call wrote the new hash, the other browser was
// left holding a token the database no longer knew. This column keeps
// the last few rotated-away hashes accepted for a short grace window
// (REFRESH_GRACE_MS / REFRESH_GRACE_DEPTH in auth.constants.ts) — a list
// rather than a single slot, so three tabs waking together all survive,
// not just the first two. Shape: [{ "hash": "<sha256>", "expiresAt":
// "<ISO>" }, ...], newest first. Existing sessions start empty.
export class AddSessionGraceTokens1790123500000 implements MigrationInterface {
  name = 'AddSessionGraceTokens1790123500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD COLUMN "grace_tokens" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "grace_tokens"`);
  }
}
