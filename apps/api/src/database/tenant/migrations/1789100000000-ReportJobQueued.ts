import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Report queue — docs/report_queue_planing.md §4. A report job can now
 * wait for a free slot before it runs (C1, C6): `job_state` gains
 * `queued` next to `running` and `failed`. No new columns: a queued job
 * already has its progress (all groups waiting), fingerprint and start
 * time on the row.
 */
export class ReportJobQueued1789100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "report_cache" DROP CONSTRAINT "CK_report_cache_job_state"`,
    );
    await queryRunner.query(`
      ALTER TABLE "report_cache" ADD CONSTRAINT "CK_report_cache_job_state"
        CHECK ("job_state" IS NULL OR "job_state" IN ('queued', 'running', 'failed'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A job still waiting has no slot to come back to: mark it failed.
    await queryRunner.query(
      `UPDATE "report_cache" SET "job_state" = 'failed', "job_error" = 'interrupted' WHERE "job_state" = 'queued'`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_cache" DROP CONSTRAINT "CK_report_cache_job_state"`,
    );
    await queryRunner.query(`
      ALTER TABLE "report_cache" ADD CONSTRAINT "CK_report_cache_job_state"
        CHECK ("job_state" IS NULL OR "job_state" IN ('running', 'failed'))
    `);
  }
}
