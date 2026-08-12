import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import {
  LookupScope,
  formatScopedRef,
  type CompanyColorLookups,
  type CompanyColorSummary,
  type CompanyPaintBrandSummary,
  type CompanyPaintingPriceSummary,
  type CreateCompanyPaintingPriceInput,
  type UpdateCompanyPaintingPriceInput,
} from '@repo/types/company-lookups';
import type {
  BulkDeleteResult,
  CreateColorInput,
  CreatePaintBrandInput,
  UpdateColorInput,
  UpdatePaintBrandInput,
} from '@repo/types/lookups';
import { Color } from '../../database/control-plane/entities/color.entity';
import { PaintBrand } from '../../database/control-plane/entities/paint-brand.entity';
import { PaintingPrice } from '../../database/control-plane/entities/painting-price.entity';
import { CompanyColor } from '../../database/tenant/entities/company-color.entity';
import { CompanyPaintBrand } from '../../database/tenant/entities/company-paint-brand.entity';
import { CompanyPaintingPrice } from '../../database/tenant/entities/company-painting-price.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { translatePostgresError } from '../lookups/pg-error.util';
import {
  assertColorAvailable,
  assertPaintBrandAvailable,
  assertPaintingPriceAvailable,
} from './platform-collision.util';
import { findBlockedIds } from './find-blocked-ids.util';
import { resolveScopedRef } from './scoped-ref.util';

// Colour cluster's tenant-owned counterpart to ColorLookupsService.
// Every method runs inside exactly one `tenantContext.run()` call
// (CLAUDE.md) — the platform-side repository reads/checks mixed in
// (`this.platformColors`, `this.platformBrands`) are a different
// connection pool entirely, so awaiting them from inside that one
// callback doesn't open a second tenant transaction, it's just an
// ordinary unrelated DB round-trip.
@Injectable()
export class CompanyColorLookupsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(Color) private readonly platformColors: Repository<Color>,
    @InjectRepository(PaintBrand)
    private readonly platformBrands: Repository<PaintBrand>,
    @InjectRepository(PaintingPrice)
    private readonly platformPrices: Repository<PaintingPrice>,
  ) {}

  // ---- Color ----
  // No standalone list route — only GET /company/lookups/:slice
  // (assembleSlice, below) is consumed by the frontend (Step 12's
  // useMergedLookupSlice merges at slice granularity, not per entity).

  async createColor(input: CreateColorInput): Promise<CompanyColorSummary> {
    await assertColorAvailable(this.platformColors, input.code);
    return this.tenantContext.run(async (manager) => {
      const color = manager.create(CompanyColor, input);
      await saveOrConflict(
        manager,
        color,
        `You already have a colour named "${input.code.trim()}".`,
      );
      return toCompanyColorSummary(color);
    });
  }

  async updateColor(
    id: string,
    input: UpdateColorInput,
  ): Promise<CompanyColorSummary> {
    return this.tenantContext.run(async (manager) => {
      const color = await manager.findOneBy(CompanyColor, { id });
      if (!color) throw new NotFoundException('Colour not found.');
      if (input.code !== undefined)
        await assertColorAvailable(this.platformColors, input.code);
      Object.assign(color, input);
      await saveOrConflict(
        manager,
        color,
        `You already have a colour named "${color.code.trim()}".`,
      );
      return toCompanyColorSummary(color);
    });
  }

  async deleteColor(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const color = await manager.findOneBy(CompanyColor, { id });
      if (!color) throw new NotFoundException('Colour not found.');
      try {
        await manager.delete(CompanyColor, { id });
      } catch (error) {
        translatePostgresError(
          error,
          'This colour is still used by a glass combination and cannot be deleted.',
        );
      }
    });
  }

  async bulkDeleteColors(ids: string[]): Promise<BulkDeleteResult> {
    return this.tenantContext.run(async (manager) => {
      const blockedIds = await findBlockedIds(manager, ids, [
        { table: 'company_glass_combination_item', column: 'company_color_id' },
        {
          table: 'company_glass_combination_item',
          column: 'company_gap_color_id',
        },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));
      if (deletableIds.length > 0)
        await manager.delete(CompanyColor, deletableIds);
      return { deletedIds: deletableIds, blockedIds: [...blockedIds] };
    });
  }

  async bulkDuplicateColors(
    items: CreateColorInput[],
  ): Promise<CompanyColorSummary[]> {
    for (const item of items)
      await assertColorAvailable(this.platformColors, item.code);
    return this.tenantContext.run(async (manager) => {
      try {
        const insertResult = await manager
          .createQueryBuilder()
          .insert()
          .into(CompanyColor)
          .values(items)
          .execute();
        const newIds = insertResult.identifiers.map((i) => i.id as string);
        const created = await manager.findBy(CompanyColor, { id: In(newIds) });
        return created.map(toCompanyColorSummary);
      } catch (error) {
        return conflictOrThrow(
          error,
          'One or more of those colours already exist.',
        );
      }
    });
  }

  // ---- PaintBrand ----

  async createPaintBrand(
    input: CreatePaintBrandInput,
  ): Promise<CompanyPaintBrandSummary> {
    await assertPaintBrandAvailable(this.platformBrands, input.name);
    return this.tenantContext.run(async (manager) => {
      const brand = manager.create(CompanyPaintBrand, input);
      await saveOrConflict(
        manager,
        brand,
        `You already have a paint brand named "${input.name.trim()}".`,
      );
      return toCompanyPaintBrandSummary(brand);
    });
  }

  async updatePaintBrand(
    id: string,
    input: UpdatePaintBrandInput,
  ): Promise<CompanyPaintBrandSummary> {
    return this.tenantContext.run(async (manager) => {
      const brand = await manager.findOneBy(CompanyPaintBrand, { id });
      if (!brand) throw new NotFoundException('Paint brand not found.');
      if (input.name !== undefined)
        await assertPaintBrandAvailable(this.platformBrands, input.name);
      Object.assign(brand, input);
      await saveOrConflict(
        manager,
        brand,
        `You already have a paint brand named "${brand.name.trim()}".`,
      );
      return toCompanyPaintBrandSummary(brand);
    });
  }

  async deletePaintBrand(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const brand = await manager.findOneBy(CompanyPaintBrand, { id });
      if (!brand) throw new NotFoundException('Paint brand not found.');
      try {
        await manager.delete(CompanyPaintBrand, { id });
      } catch (error) {
        translatePostgresError(
          error,
          'This brand still has prices and cannot be deleted.',
        );
      }
    });
  }

  // No bulk-delete/bulk-duplicate for PaintBrand — matches
  // admin-lookups.controller.ts, which doesn't expose them either
  // (PaintingPricesSection's own comment: "Bulk select/duplicate/delete
  // ... is deliberately dropped" for both brands and prices in that
  // merged master-detail view).

  // ---- PaintingPrice ----

  async createPaintingPrice(
    input: CreateCompanyPaintingPriceInput,
  ): Promise<CompanyPaintingPriceSummary> {
    const { platformId, companyId } = resolveScopedRef(input.brand);
    await assertPaintingPriceAvailable(
      this.platformPrices,
      platformId,
      input.type,
    );
    return this.tenantContext.run(async (manager) => {
      const price = manager.create(CompanyPaintingPrice, {
        platformBrandId: platformId,
        companyBrandId: companyId,
        type: input.type,
        price: input.price,
      });
      try {
        await manager.save(price);
      } catch (error) {
        this.translatePaintingPriceWriteError(error);
      }
      return (await this.resolvePaintingPriceSummaries(manager, [price]))[0];
    });
  }

  async updatePaintingPrice(
    id: string,
    input: UpdateCompanyPaintingPriceInput,
  ): Promise<CompanyPaintingPriceSummary> {
    return this.tenantContext.run(async (manager) => {
      const price = await manager.findOneBy(CompanyPaintingPrice, { id });
      if (!price) throw new NotFoundException('Painting price not found.');

      let platformId = price.platformBrandId;
      let companyId = price.companyBrandId;
      if (input.brand !== undefined) {
        const resolved = resolveScopedRef(input.brand);
        platformId = resolved.platformId;
        companyId = resolved.companyId;
      }
      const type = input.type ?? price.type;
      if (input.brand !== undefined || input.type !== undefined) {
        await assertPaintingPriceAvailable(
          this.platformPrices,
          platformId,
          type,
        );
      }

      price.platformBrandId = platformId;
      price.companyBrandId = companyId;
      if (input.type !== undefined) price.type = input.type;
      if (input.price !== undefined) price.price = input.price;

      try {
        await manager.save(price);
      } catch (error) {
        this.translatePaintingPriceWriteError(error);
      }
      return (await this.resolvePaintingPriceSummaries(manager, [price]))[0];
    });
  }

  async deletePaintingPrice(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const price = await manager.findOneBy(CompanyPaintingPrice, { id });
      if (!price) throw new NotFoundException('Painting price not found.');
      await manager.delete(CompanyPaintingPrice, { id });
    });
  }

  private translatePaintingPriceWriteError(error: unknown): never {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === '23505')
      throw new ConflictException(
        'You already have a price for that brand and finish type.',
      );
    translatePostgresError(error, 'That brand does not exist.');
  }

  // Batches the platform-vs-company brand-name lookup across a whole
  // list rather than resolving each price's brand one at a time.
  private async resolvePaintingPriceSummaries(
    manager: EntityManager,
    prices: CompanyPaintingPrice[],
  ): Promise<CompanyPaintingPriceSummary[]> {
    const companyBrandIds = [
      ...new Set(
        prices.map((p) => p.companyBrandId).filter((id): id is string => !!id),
      ),
    ];
    const platformBrandIds = [
      ...new Set(
        prices.map((p) => p.platformBrandId).filter((id): id is string => !!id),
      ),
    ];
    const [companyBrands, platformBrands] = await Promise.all([
      companyBrandIds.length > 0
        ? manager.findBy(CompanyPaintBrand, { id: In(companyBrandIds) })
        : Promise.resolve([]),
      platformBrandIds.length > 0
        ? this.platformBrands.findBy({ id: In(platformBrandIds) })
        : Promise.resolve([]),
    ]);
    const companyBrandById = new Map(companyBrands.map((b) => [b.id, b]));
    const platformBrandById = new Map(platformBrands.map((b) => [b.id, b]));
    return prices.map((price) =>
      toPaintingPriceSummary(
        price,
        price.companyBrandId
          ? (companyBrandById.get(price.companyBrandId) ?? null)
          : null,
        price.platformBrandId
          ? (platformBrandById.get(price.platformBrandId) ?? null)
          : null,
      ),
    );
  }

  // ---- Tenant read slice ----

  async assembleSlice(): Promise<CompanyColorLookups> {
    return this.tenantContext.run(async (manager) => {
      const [colors, brands, prices] = await Promise.all([
        manager.find(CompanyColor, { order: { code: 'ASC' } }),
        manager.find(CompanyPaintBrand, { order: { name: 'ASC' } }),
        manager.find(CompanyPaintingPrice, { order: { type: 'ASC' } }),
      ]);
      return {
        colors: colors.map(toCompanyColorSummary),
        brands: brands.map(toCompanyPaintBrandSummary),
        prices: await this.resolvePaintingPriceSummaries(manager, prices),
      };
    });
  }
}

function toCompanyColorSummary(color: CompanyColor): CompanyColorSummary {
  return {
    id: color.id,
    code: color.code,
    hex: color.hex,
    scope: LookupScope.COMPANY,
    createdAt: color.createdAt.toISOString(),
    updatedAt: color.updatedAt.toISOString(),
  };
}

function toCompanyPaintBrandSummary(
  brand: CompanyPaintBrand,
): CompanyPaintBrandSummary {
  return {
    id: brand.id,
    name: brand.name,
    scope: LookupScope.COMPANY,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

function toPaintingPriceSummary(
  price: CompanyPaintingPrice,
  companyBrand: CompanyPaintBrand | null,
  platformBrand: PaintBrand | null,
): CompanyPaintingPriceSummary {
  const isPlatform = !!price.platformBrandId;
  return {
    id: price.id,
    brand: formatScopedRef(
      isPlatform ? LookupScope.PLATFORM : LookupScope.COMPANY,
      (price.platformBrandId ?? price.companyBrandId)!,
    ),
    brandName: isPlatform
      ? (platformBrand?.name ?? null)
      : (companyBrand?.name ?? null),
    brandScope: isPlatform ? LookupScope.PLATFORM : LookupScope.COMPANY,
    type: price.type,
    price: price.price,
    scope: LookupScope.COMPANY,
    createdAt: price.createdAt.toISOString(),
    updatedAt: price.updatedAt.toISOString(),
  };
}

// Shared save-and-translate-unique-violation helper — every simple
// (single-column-identity) entity in this file uses the exact same
// "save, and if it collides with an existing company row, 409" shape.
async function saveOrConflict<T extends object>(
  manager: EntityManager,
  entity: T,
  message: string,
): Promise<void> {
  try {
    await manager.save(entity);
  } catch (error) {
    conflictOrThrow(error, message);
  }
}

function conflictOrThrow(error: unknown, message: string): never {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === '23505') throw new ConflictException(message);
  throw error as Error;
}
