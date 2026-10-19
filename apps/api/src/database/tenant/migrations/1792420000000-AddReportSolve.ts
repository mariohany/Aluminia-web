import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Browser solve — docs/browser_solve_planing.md §6. A report's solve is
 * now stored once per project (`report_solve`), and each language's PDF
 * is printed from it (`report_cache`, B4).
 *
 * `report_solve`: the last good solve (its plans as piece-line numbers,
 * the on-screen summary, the solve fingerprint and each window's
 * `updated_at` for "N windows changed") plus the solve in progress, made
 * by a browser holding `solve_token`, whose progress writes double as its
 * heartbeat (`updated_at`, B5).
 *
 * `report_cache` keeps only the printed PDF per language: `fingerprint`
 * is now the print fingerprint and `job_*` the print job. `summary` and
 * `window_stamps` move to `report_solve`. Existing PDFs stay readable;
 * the new fingerprints differ from the old ones, so they read as stale
 * until generated again (REPORT_VERSION 3).
 */
export class AddReportSolve1792420000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "report_solve" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "report_kind" varchar(30) NOT NULL,

        "solve_fingerprint" char(64),
        "window_stamps" jsonb,
        "result" jsonb,
        "summary" jsonb,
        "solved_at" timestamptz,
        "solved_by_user_id" uuid,

        "solve_state" varchar(10),
        "solve_token" uuid,
        "solve_pending_fingerprint" char(64),
        "solve_progress" jsonb,
        "solve_started_at" timestamptz,
        "solve_started_by_user_id" uuid,
        "solve_error" text,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "FK_report_solve_project" FOREIGN KEY ("project_id")
          REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_report_solve_kind" CHECK ("report_kind" IN ('bar_optimiser')),
        CONSTRAINT "CK_report_solve_state"
          CHECK ("solve_state" IS NULL OR "solve_state" IN ('solving', 'failed')),
        CONSTRAINT "CK_report_solve_solved"
          CHECK (("solve_fingerprint" IS NULL) = ("solved_at" IS NULL)
             AND ("solve_fingerprint" IS NULL) = ("result" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_report_solve_project_kind"
        ON "report_solve" ("project_id", "report_kind")
    `);
    await queryRunner.query(
      `ALTER TABLE "report_cache" DROP COLUMN "summary", DROP COLUMN "window_stamps"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "report_cache" ADD COLUMN "window_stamps" jsonb, ADD COLUMN "summary" jsonb`,
    );
    // Put each project's summary and stamps back on its printed rows, so
    // the old code still shows the numbers next to the PDFs.
    await queryRunner.query(`
      UPDATE "report_cache" c
         SET "summary" = s."summary", "window_stamps" = s."window_stamps"
        FROM "report_solve" s
       WHERE s."project_id" = c."project_id" AND s."report_kind" = c."report_kind"
    `);
    await queryRunner.query(`DROP INDEX "UQ_report_solve_project_kind"`);
    await queryRunner.query(`DROP TABLE "report_solve"`);
  }
}
