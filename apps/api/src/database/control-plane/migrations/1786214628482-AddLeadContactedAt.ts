import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns the leads capture table into something an admin can work from:
 * `contacted_at` is set the moment someone clicks the phone number to
 * call a lead (see LeadsService.markContacted). Nullable, no default —
 * a lead is "new" until that first call, and this column only ever
 * moves forward from null to a timestamp, never back.
 *
 * Still deliberately not a full pipeline (no status enum, no notes,
 * no assignee) — see AddLeads1786206450554's comment for why. This is
 * the smallest useful signal: called vs not called.
 */
export class AddLeadContactedAt1786214628482 implements MigrationInterface {
  name = 'AddLeadContactedAt1786214628482';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "leads" ADD "contacted_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "contacted_at"`);
  }
}
