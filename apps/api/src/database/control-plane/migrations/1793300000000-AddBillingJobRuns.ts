import { MigrationInterface, QueryRunner } from 'typeorm';

// Payment cycle P17, P28 (Mario 2026-11-04): the daily billing job runs
// once per Cairo day. Its row is claimed first, so a second trigger the
// same day does nothing; a failed run can be run again.
export class AddBillingJobRuns1793300000000 implements MigrationInterface {
  name = 'AddBillingJobRuns1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "billing_job_runs" (
        "run_date" date PRIMARY KEY,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        "summary" jsonb,
        "error" text
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_job_runs"`);
  }
}
