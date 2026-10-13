import type { DataSource } from 'typeorm';

/**
 * A minimal platform catalogue that one suite owns: a brand with a
 * sliding and a hinged catalogue, one profile of each type the suites
 * reference, a glass and a colour.
 *
 * The platform catalogue is otherwise filled in by hand through the
 * admin console's import, so a fresh database (CI) has none. Suites run
 * in parallel against one database, so each passes its own `prefix`
 * and removes only its own rows (`dropPlatformCatalogue`). Rows left by
 * an interrupted run are cleared before seeding. No version bump is
 * needed: every lookup table's trigger bumps `lookup_meta` on its own.
 */
export interface PlatformCatalogue {
  brandId: string;
  slidingCatalogId: string;
  hingedCatalogId: string;
  frameId: string;
  leafId: string;
  beadId: string;
  transomId: string;
  glassId: string;
  glassName: string;
  colorId: string;
  colorCode: string;
}

export async function seedPlatformCatalogue(
  controlPlane: DataSource,
  prefix: string,
): Promise<PlatformCatalogue> {
  await dropPlatformCatalogue(controlPlane, prefix);

  const brandId = await insertId(
    controlPlane,
    `INSERT INTO system_brand (name) VALUES ($1) RETURNING id`,
    [`${prefix} Brand`],
  );
  const catalog = (name: string, type: string) =>
    insertId(
      controlPlane,
      `INSERT INTO system_catalog (brand_id, name, system_type, max_glass_thickness, max_sash_weight)
       VALUES ($1, $2, $3, 32, 120) RETURNING id`,
      [brandId, `${prefix} ${name}`, type],
    );
  const hingedCatalogId = await catalog('Hinged', 'hinged');
  const slidingCatalogId = await catalog('Sliding', 'sliding');

  const profile = (profileNo: string, type: string) =>
    insertId(
      controlPlane,
      `INSERT INTO system_profile (catalog_id, profile_no, profile_type, max_glass_thickness, weight, perimeter, inertia_ix, inertia_iy)
       VALUES ($1, $2, $3, 24, 1, 100, 1, 1) RETURNING id`,
      [hingedCatalogId, profileNo, type],
    );
  const frameId = await profile('FRAME-01', 'frame');
  const leafId = await profile('LEAF-01', 'leaf');
  const beadId = await profile('BEAD-01', 'glass_beading');
  const transomId = await profile('TRANSOM-01', 'transom');

  const glassName = `${prefix} Glass 6mm`;
  const glassId = await insertId(
    controlPlane,
    `INSERT INTO glass (name, thickness, weight_per_sqm, price_per_sqm)
     VALUES ($1, 6, 15, 100) RETURNING id`,
    [glassName],
  );

  const colorCode = `${prefix} RAL 9016`;
  const colorId = await insertId(
    controlPlane,
    `INSERT INTO color (code, hex) VALUES ($1, '#f1f0ea') RETURNING id`,
    [colorCode],
  );

  return {
    brandId,
    slidingCatalogId,
    hingedCatalogId,
    frameId,
    leafId,
    beadId,
    transomId,
    glassId,
    glassName,
    colorId,
    colorCode,
  };
}

/**
 * Removes every platform row named with `prefix`, including profiles a
 * test created through the API under this suite's catalogues. Run it
 * after the suite's companies are dropped: tenant rows that point at
 * these are gone with their schemas.
 */
export async function dropPlatformCatalogue(
  controlPlane: DataSource,
  prefix: string,
): Promise<void> {
  const like = `${prefix} %`;
  await controlPlane.query(
    `DELETE FROM system_profile WHERE catalog_id IN (
       SELECT id FROM system_catalog WHERE name LIKE $1)`,
    [like],
  );
  await controlPlane.query(`DELETE FROM system_catalog WHERE name LIKE $1`, [
    like,
  ]);
  await controlPlane.query(`DELETE FROM system_brand WHERE name LIKE $1`, [
    like,
  ]);
  await controlPlane.query(`DELETE FROM glass WHERE name LIKE $1`, [like]);
  await controlPlane.query(`DELETE FROM color WHERE code LIKE $1`, [like]);
}

async function insertId(
  controlPlane: DataSource,
  sql: string,
  params: unknown[],
): Promise<string> {
  const [row]: Array<{ id: string }> = await controlPlane.query(sql, params);
  return row.id;
}
