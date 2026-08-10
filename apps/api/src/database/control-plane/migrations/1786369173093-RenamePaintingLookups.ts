import { MigrationInterface, QueryRunner } from 'typeorm';

// Renames the colour-brand/colour-price pair to paint-brand/painting-price
// (product naming decision — see docs/admin_dashboard_planing.md). Uses
// ALTER TABLE/TYPE ... RENAME throughout, not drop+recreate, so existing
// rows (including lookup_meta's version counters) survive in place —
// renaming an enum label doesn't change the underlying stored value, only
// its display name.
export class RenamePaintingLookups1786369173093 implements MigrationInterface {
  name = 'RenamePaintingLookups1786369173093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- tables --------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "color_brand" RENAME TO "paint_brand"`,
    );
    await queryRunner.query(
      `ALTER TABLE "color_price" RENAME TO "painting_price"`,
    );

    // --- constraints (cosmetic, but cheap while touching these tables) -
    await queryRunner.query(
      `ALTER TABLE "paint_brand" RENAME CONSTRAINT "color_brand_pkey" TO "paint_brand_pkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paint_brand" RENAME CONSTRAINT "UQ_color_brand_name" TO "UQ_paint_brand_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME CONSTRAINT "color_price_pkey" TO "painting_price_pkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME CONSTRAINT "UQ_color_price_brand_type" TO "UQ_painting_price_brand_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME CONSTRAINT "color_price_brand_id_fkey" TO "painting_price_brand_id_fkey"`,
    );

    // --- lookup_entity enum ---------------------------------------------
    // Renaming the label updates the two existing lookup_meta rows'
    // display value automatically — no UPDATE needed.
    await queryRunner.query(
      `ALTER TYPE "lookup_entity" RENAME VALUE 'color_brand' TO 'paint_brand'`,
    );
    await queryRunner.query(
      `ALTER TYPE "lookup_entity" RENAME VALUE 'color_price' TO 'painting_price'`,
    );

    // --- version-bump triggers -------------------------------------------
    // The old triggers pass the entity name as a literal string argument
    // (TG_ARGV[0]) cast to lookup_entity at runtime — after the RENAME
    // VALUE above, the literal 'color_brand'/'color_price' no longer casts,
    // so the triggers must be recreated with the new literal, not just
    // renamed.
    await queryRunner.query(
      `DROP TRIGGER "color_brand_bump_lookup_version" ON "paint_brand"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "paint_brand_bump_lookup_version"
        AFTER INSERT OR UPDATE OR DELETE ON "paint_brand"
        FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"('paint_brand')
    `);
    await queryRunner.query(
      `DROP TRIGGER "color_price_bump_lookup_version" ON "painting_price"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "painting_price_bump_lookup_version"
        AFTER INSERT OR UPDATE OR DELETE ON "painting_price"
        FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"('painting_price')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "painting_price_bump_lookup_version" ON "painting_price"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "color_price_bump_lookup_version"
        AFTER INSERT OR UPDATE OR DELETE ON "painting_price"
        FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"('color_price')
    `);
    await queryRunner.query(
      `DROP TRIGGER "paint_brand_bump_lookup_version" ON "paint_brand"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "color_brand_bump_lookup_version"
        AFTER INSERT OR UPDATE OR DELETE ON "paint_brand"
        FOR EACH STATEMENT EXECUTE FUNCTION "bump_lookup_version"('color_brand')
    `);

    await queryRunner.query(
      `ALTER TYPE "lookup_entity" RENAME VALUE 'painting_price' TO 'color_price'`,
    );
    await queryRunner.query(
      `ALTER TYPE "lookup_entity" RENAME VALUE 'paint_brand' TO 'color_brand'`,
    );

    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME CONSTRAINT "painting_price_brand_id_fkey" TO "color_price_brand_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME CONSTRAINT "UQ_painting_price_brand_type" TO "UQ_color_price_brand_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME CONSTRAINT "painting_price_pkey" TO "color_price_pkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paint_brand" RENAME CONSTRAINT "UQ_paint_brand_name" TO "UQ_color_brand_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paint_brand" RENAME CONSTRAINT "paint_brand_pkey" TO "color_brand_pkey"`,
    );

    await queryRunner.query(
      `ALTER TABLE "painting_price" RENAME TO "color_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paint_brand" RENAME TO "color_brand"`,
    );
  }
}
