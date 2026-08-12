import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Color } from '../../database/control-plane/entities/color.entity';
import { PaintBrand } from '../../database/control-plane/entities/paint-brand.entity';
import { PaintingPrice } from '../../database/control-plane/entities/painting-price.entity';
import { Glass } from '../../database/control-plane/entities/glass.entity';
import { GlassCombination } from '../../database/control-plane/entities/glass-combination.entity';
import { SystemBrand } from '../../database/control-plane/entities/system-brand.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';

/**
 * A company row must never share an identity with a platform row
 * (docs/company_lookups_planing.md, "Identity / duplicate rule"). The
 * new company_* tables' unique indexes already cover company-vs-company
 * (both rows live in the same tenant schema, so Postgres can see them
 * both); this file covers the half Postgres can't — a company row and a
 * platform row live in different schemas, so nothing but an explicit
 * pre-check catches that collision. Every comparison here is trimmed and
 * case-insensitive, matching the company tables' own `lower(...)` unique
 * index expressions exactly.
 *
 * Deliberately racy (see the planing doc's "Accepted risks" #2): nothing
 * stops a super admin creating a colliding platform row moments after
 * this check passes. Accepted — surfaced on next read as a conflict,
 * never hard-prevented with, say, an advisory lock across two databases.
 */

async function existsCaseInsensitive<T extends { id: string }>(
  repo: Repository<T>,
  column: string,
  value: string,
): Promise<boolean> {
  const row = await repo
    .createQueryBuilder('row')
    .where(`lower(trim(row.${column})) = lower(trim(:value))`, { value })
    .getOne();
  return !!row;
}

export async function assertColorAvailable(
  colors: Repository<Color>,
  code: string,
): Promise<void> {
  if (await existsCaseInsensitive(colors, 'code', code)) {
    throw new ConflictException(
      `A platform colour named "${code.trim()}" already exists.`,
    );
  }
}

export async function assertPaintBrandAvailable(
  brands: Repository<PaintBrand>,
  name: string,
): Promise<void> {
  if (await existsCaseInsensitive(brands, 'name', name)) {
    throw new ConflictException(
      `A platform paint brand named "${name.trim()}" already exists.`,
    );
  }
}

export async function assertGlassAvailable(
  glasses: Repository<Glass>,
  name: string,
): Promise<void> {
  if (await existsCaseInsensitive(glasses, 'name', name)) {
    throw new ConflictException(
      `A platform glass named "${name.trim()}" already exists.`,
    );
  }
}

export async function assertGlassCombinationAvailable(
  combinations: Repository<GlassCombination>,
  name: string,
): Promise<void> {
  if (await existsCaseInsensitive(combinations, 'name', name)) {
    throw new ConflictException(
      `A platform glass combination named "${name.trim()}" already exists.`,
    );
  }
}

export async function assertSystemBrandAvailable(
  brands: Repository<SystemBrand>,
  name: string,
): Promise<void> {
  if (await existsCaseInsensitive(brands, 'name', name)) {
    throw new ConflictException(
      `A platform system brand named "${name.trim()}" already exists.`,
    );
  }
}

// Composite identity (brand, type) — only worth checking when the brand
// half of the reference is itself platform-owned. A company-owned brand
// can never collide with a platform painting price: platform rows only
// ever reference platform brands, so there is no platform row to
// collide with on that axis at all.
export async function assertPaintingPriceAvailable(
  prices: Repository<PaintingPrice>,
  platformBrandId: string | null,
  type: string,
): Promise<void> {
  if (!platformBrandId) return;
  const existing = await prices
    .createQueryBuilder('p')
    .where('p.brand_id = :brandId', { brandId: platformBrandId })
    .andWhere('lower(trim(p.type)) = lower(trim(:type))', { type })
    .getOne();
  if (existing) {
    throw new ConflictException(
      'A platform price for that brand and finish type already exists.',
    );
  }
}

export async function assertSystemCatalogAvailable(
  catalogs: Repository<SystemCatalog>,
  platformBrandId: string | null,
  name: string,
): Promise<void> {
  if (!platformBrandId) return;
  const existing = await catalogs
    .createQueryBuilder('c')
    .where('c.brand_id = :brandId', { brandId: platformBrandId })
    .andWhere('lower(trim(c.name)) = lower(trim(:name))', { name })
    .getOne();
  if (existing) {
    throw new ConflictException(
      'A platform catalogue with that name already exists under that brand.',
    );
  }
}

export async function assertSystemProfileAvailable(
  profiles: Repository<SystemProfile>,
  platformCatalogId: string | null,
  profileNo: string,
): Promise<void> {
  if (!platformCatalogId) return;
  const existing = await profiles
    .createQueryBuilder('p')
    .where('p.catalog_id = :catalogId', { catalogId: platformCatalogId })
    .andWhere('lower(trim(p.profile_no)) = lower(trim(:profileNo))', {
      profileNo,
    })
    .getOne();
  if (existing) {
    throw new ConflictException(
      'A platform profile with that number already exists under that catalogue.',
    );
  }
}
