import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A fixed light's glass sits straight in a glazing bead, not a sash —
 * `window_sections` never had anywhere to record which bead profile
 * that is, so a fixed section's glass thickness had no cap at all and
 * the glass picker showed nothing to choose from (it filters on that
 * cap). Adds the same platform/company pair shape every other profile
 * reference on this table already uses.
 *
 * Deliberately NOT the same CHECK posture as `CK_window_sections_sash_by_kind`:
 * that one requires exactly one of the pair set for its kind. This one
 * only forbids an opening section from EVER having a bead (structurally
 * meaningless, so a hard rule) and forbids a fixed section's pair from
 * having BOTH set (a shape guard), but tolerates a fixed section with
 * NEITHER set — every fixed section written before this migration is
 * exactly that shape, and Mario wants those existing rows to keep
 * loading as-is rather than be silently backfilled with a guessed
 * profile. `windowSectionSchema` (packages/types/src/windows.ts) is
 * what actually requires a fixed section to carry a bead profile on
 * every SAVE — so opening one of these older windows and trying to
 * save anything (even an unrelated edit) surfaces a `beadRequired`
 * issue until the user picks one, same "Zod stricter than the DB"
 * posture the `hasFlyScreen` column already has for a different rule.
 */
export class AddSectionBeadProfile1788500100000 implements MigrationInterface {
  name = 'AddSectionBeadProfile1788500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ADD COLUMN "bead_platform_profile_id" uuid,
        ADD COLUMN "bead_company_profile_id" uuid
          REFERENCES "company_system_profile"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_bead_platform_profile" ON "window_sections" ("bead_platform_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_window_sections_bead_company_profile" ON "window_sections" ("bead_company_profile_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "window_sections"
        ADD CONSTRAINT "CK_window_sections_bead_by_kind" CHECK (
          ("section_kind" = 'fixed' AND num_nonnulls("bead_platform_profile_id", "bead_company_profile_id") <= 1)
          OR ("section_kind" = 'opening' AND "bead_platform_profile_id" IS NULL AND "bead_company_profile_id" IS NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        DROP CONSTRAINT "CK_window_sections_bead_by_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "window_sections"
        DROP COLUMN "bead_platform_profile_id",
        DROP COLUMN "bead_company_profile_id"
    `);
  }
}
