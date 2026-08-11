import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the 'bottom_rail' profile type introduced after AddLookupTables
// already ran. Postgres requires ADD VALUE to run outside a transaction
// block (pre-PG12 restriction still enforced by the parser), so this
// can't be undone by a plain DROP VALUE — down() is a documented no-op,
// same as any other enum-ADD-VALUE migration would need to be.
export class AddBottomRailProfileType1786419320548 implements MigrationInterface {
  name = 'AddBottomRailProfileType1786419320548';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "profile_type" ADD VALUE 'bottom_rail'`,
    );
  }

  public down(): Promise<void> {
    throw new Error(
      'Irreversible: Postgres cannot drop a value from an enum type. ' +
        'To undo, restore from a backup taken before this migration ran.',
    );
  }
}
