import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reports + Bar optimiser — docs/reports_planing.md §6.
 *
 * `cutting_settings`: the company's one row of saw settings (D8). No row
 * means the defaults (`DEFAULT_CUTTING_SETTINGS`), so existing tenants
 * need no backfill. 6000/6500 are always tried and never stored (D7);
 * `extra_lengths_mm` holds only what the user added. The CHECKs mirror
 * `cuttingSettingsSchema` (`CUTTING_LIMITS`, Q2).
 *
 * `report_cache`: one row per project × report × language (D13) — the
 * cached PDF and the numbers shown on screen, plus the fingerprint of the
 * inputs they were made from (stale when it no longer matches, D14) and
 * each window's `updated_at` at the time (to say "N windows changed",
 * D15). The background job that fills it (D22) keeps its state on the
 * same row: `job_state` running/failed, its per-member-group progress,
 * and the fingerprint it is building, so the previous PDF stays readable
 * while a new one is made.
 */
export class AddReports1789000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cutting_settings" (
        "id" smallint PRIMARY KEY DEFAULT 1,
        "kerf_mm" numeric(3,1) NOT NULL DEFAULT 4,
        "end_trim_mm" integer NOT NULL DEFAULT 10,
        "extra_lengths_mm" integer[] NOT NULL DEFAULT '{}',
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "CK_cutting_settings_single_row" CHECK ("id" = 1),
        CONSTRAINT "CK_cutting_settings_kerf"
          CHECK ("kerf_mm" BETWEEN 0 AND 10 AND ("kerf_mm" * 2) = trunc("kerf_mm" * 2)),
        CONSTRAINT "CK_cutting_settings_end_trim"
          CHECK ("end_trim_mm" BETWEEN 0 AND 100),
        CONSTRAINT "CK_cutting_settings_extra_count"
          CHECK (cardinality("extra_lengths_mm") <= 10),
        CONSTRAINT "CK_cutting_settings_extra_range"
          CHECK (1000 <= ALL ("extra_lengths_mm") AND 12000 >= ALL ("extra_lengths_mm"))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "report_cache" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "report_kind" varchar(30) NOT NULL,
        "language" varchar(2) NOT NULL,

        "fingerprint" char(64),
        "window_stamps" jsonb,
        "summary" jsonb,
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
          CHECK ("job_state" IS NULL OR "job_state" IN ('running', 'failed')),
        CONSTRAINT "CK_report_cache_generated"
          CHECK (("fingerprint" IS NULL) = ("generated_at" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_report_cache_project_kind_language"
        ON "report_cache" ("project_id", "report_kind", "language")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_report_cache_project_kind_language"`,
    );
    await queryRunner.query(`DROP TABLE "report_cache"`);
    await queryRunner.query(`DROP TABLE "cutting_settings"`);
  }
}
