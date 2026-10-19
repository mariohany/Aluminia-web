import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Browser PDF — docs/browser_pdf_planing.md §6, P2. The PDF is drawn in
 * the browser on every open and never stored, so the printed-PDF cache
 * (and its print-job state) goes. `down` recreates the table empty, as it
 * stood before (1792420000000-AddReportSolve): the old code reprints.
 */
export class DropReportCache1792450000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_report_cache_project_kind_language"`,
    );
    await queryRunner.query(`DROP TABLE "report_cache"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "report_cache" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "report_kind" varchar(30) NOT NULL,
        "language" varchar(2) NOT NULL,

        "fingerprint" char(64),
        "pdf" bytea,
        "generated_at" timestamptz,
        "generated_by_user_id" uuid,

        "job_state" varchar(10),
        "job_fingerprint" char(64),
        "job_progress" jsonb,
        "job_started_at" timestamptz,
        "job_started_by_user_id" uuid,
        "job_error" text,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "FK_report_cache_project" FOREIGN KEY ("project_id")
          REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_report_cache_kind" CHECK ("report_kind" IN ('bar_optimiser')),
        CONSTRAINT "CK_report_cache_language" CHECK ("language" IN ('en', 'ar')),
        CONSTRAINT "CK_report_cache_job_state"
          CHECK ("job_state" IS NULL OR "job_state" IN ('queued', 'running', 'failed')),
        CONSTRAINT "CK_report_cache_generated"
          CHECK (("fingerprint" IS NULL) = ("generated_at" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_report_cache_project_kind_language"
        ON "report_cache" ("project_id", "report_kind", "language")
    `);
  }
}
