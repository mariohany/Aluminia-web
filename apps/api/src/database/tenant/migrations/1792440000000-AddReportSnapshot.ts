import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Browser PDF — docs/browser_pdf_planing.md §6. The browser now draws the
 * PDF from a snapshot the server saves with the solve: `report` (the
 * summary, the plans with their piece labels, the project and client
 * names, frozen at Generate, P6) and `snapshot_fingerprint` (the solve
 * fingerprint + the project and client stamps: a rename makes it stale,
 * P8). `summary` moves into `report`.
 *
 * Solves made before have no snapshot to draw: they are cleared (the
 * report version moves to 4, so they were stale anyway) and their
 * projects generate again. `report_cache` goes with its code in the next
 * migration.
 */
export class AddReportSnapshot1792440000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "report_solve"
        ADD COLUMN "report" jsonb,
        ADD COLUMN "snapshot_fingerprint" char(64)
    `);
    await queryRunner.query(`
      UPDATE "report_solve"
         SET "solve_fingerprint" = NULL, "window_stamps" = NULL, "result" = NULL,
             "solved_at" = NULL, "solved_by_user_id" = NULL
    `);
    await queryRunner.query(`ALTER TABLE "report_solve" DROP COLUMN "summary"`);
    await queryRunner.query(
      `ALTER TABLE "report_solve" DROP CONSTRAINT "CK_report_solve_solved"`,
    );
    await queryRunner.query(`
      ALTER TABLE "report_solve" ADD CONSTRAINT "CK_report_solve_solved"
        CHECK (("solve_fingerprint" IS NULL) = ("solved_at" IS NULL)
           AND ("solve_fingerprint" IS NULL) = ("result" IS NULL)
           AND ("solve_fingerprint" IS NULL) = ("report" IS NULL)
           AND ("solve_fingerprint" IS NULL) = ("snapshot_fingerprint" IS NULL))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "report_solve" DROP CONSTRAINT "CK_report_solve_solved"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_solve" ADD COLUMN "summary" jsonb`,
    );
    await queryRunner.query(
      `UPDATE "report_solve" SET "summary" = "report" -> 'summary'`,
    );
    await queryRunner.query(`
      ALTER TABLE "report_solve"
        DROP COLUMN "report",
        DROP COLUMN "snapshot_fingerprint"
    `);
    await queryRunner.query(`
      ALTER TABLE "report_solve" ADD CONSTRAINT "CK_report_solve_solved"
        CHECK (("solve_fingerprint" IS NULL) = ("solved_at" IS NULL)
           AND ("solve_fingerprint" IS NULL) = ("result" IS NULL))
    `);
  }
}
