import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type {
  PaintBrandSummary,
  ColorLookups,
  PaintingPriceSummary,
  ColorSummary,
  ColorImportResult,
  BulkDeleteResult,
  CreatePaintBrandInput,
  CreateColorInput,
  CreatePaintingPriceInput,
  UpdatePaintBrandInput,
  UpdateColorInput,
  UpdatePaintingPriceInput,
} from '@repo/types/lookups';
import { Color } from '../../database/control-plane/entities/color.entity';
import { PaintBrand } from '../../database/control-plane/entities/paint-brand.entity';
import { PaintingPrice } from '../../database/control-plane/entities/painting-price.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { translatePostgresError } from './pg-error.util';
import { parseColorWorkbook, type ParsedColorRow } from './color-import.util';
import { findBlockedIds } from './lookup-version.util';

// Single-table writes, not wrapped in an explicit transaction: same
// accepted-risk tradeoff already made in CompaniesService.create() for
// provisioning — an audit-log write lagging a successful data write by
// one statement is a narrow risk, not worth a queryRunner per entity
// here. GlassLookupsService.saveCombination is the exception, because a
// combination's item list genuinely needs multi-statement atomicity —
// importColors() below is a second exception, for the same reason.
@Injectable()
export class ColorLookupsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Color) private readonly colors: Repository<Color>,
    @InjectRepository(PaintBrand)
    private readonly brands: Repository<PaintBrand>,
    @InjectRepository(PaintingPrice)
    private readonly prices: Repository<PaintingPrice>,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---- Color ----

  listColors(): Promise<ColorSummary[]> {
    return this.colors
      .find({ order: { code: 'ASC' } })
      .then((rows) => rows.map(toColorSummary));
  }

  async createColor(
    input: CreateColorInput,
    actorId: string,
  ): Promise<ColorSummary> {
    const color = await this.colors.save(this.colors.create(input));
    await this.auditLog.record(this.colors.manager, {
      actorUserId: actorId,
      action: 'lookup.color.created',
      targetType: 'color',
      targetId: color.id,
      metadata: { code: color.code },
    });
    return toColorSummary(color);
  }

  async updateColor(
    id: string,
    input: UpdateColorInput,
    actorId: string,
  ): Promise<ColorSummary> {
    const color = await this.colors.findOneBy({ id });
    if (!color) throw new NotFoundException('Colour not found.');
    Object.assign(color, input);
    await this.colors.save(color);
    await this.auditLog.record(this.colors.manager, {
      actorUserId: actorId,
      action: 'lookup.color.updated',
      targetType: 'color',
      targetId: color.id,
      metadata: { code: color.code },
    });
    return toColorSummary(color);
  }

  async deleteColor(id: string, actorId: string): Promise<void> {
    const color = await this.colors.findOneBy({ id });
    if (!color) throw new NotFoundException('Colour not found.');
    try {
      await this.colors.delete({ id });
    } catch (error) {
      translatePostgresError(
        error,
        'This colour is still used by a glass combination and cannot be deleted.',
      );
    }
    await this.auditLog.record(this.colors.manager, {
      actorUserId: actorId,
      action: 'lookup.color.deleted',
      targetType: 'color',
      targetId: id,
      metadata: { code: color.code },
    });
  }

  // Bulk delete/duplicate. Both are a single DB statement against this
  // one table (no cascade into another table, unlike glass_combination),
  // so — unlike importColors() — no trigger-disable dance is needed:
  // one statement already means one version-bump firing. Delete
  // pre-checks which ids are still referenced by a glass combination
  // and only deletes the rest, rather than failing the whole batch.
  async bulkDeleteColors(
    ids: string[],
    actorId: string,
  ): Promise<BulkDeleteResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const blockedIds = await findBlockedIds(queryRunner, ids, [
        { table: 'glass_combination_item', column: 'color_id' },
        { table: 'glass_combination_item', column: 'gap_color_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));

      if (deletableIds.length > 0) {
        await queryRunner.manager.delete(Color, deletableIds);
        await this.auditLog.record(queryRunner.manager, {
          actorUserId: actorId,
          action: 'lookup.color.bulk_deleted',
          targetType: 'color',
          metadata: { count: deletableIds.length, ids: deletableIds },
        });
      }

      await queryRunner.commitTransaction();
      return { deletedIds: deletableIds, blockedIds: [...blockedIds] };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDuplicateColors(
    items: CreateColorInput[],
    actorId: string,
  ): Promise<ColorSummary[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(Color)
        .values(items)
        .execute();
      const newIds = insertResult.identifiers.map((i) => i.id as string);
      const created = await queryRunner.manager.findBy(Color, {
        id: In(newIds),
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.color.bulk_duplicated',
        targetType: 'color',
        metadata: { count: created.length },
      });

      await queryRunner.commitTransaction();
      return created.map(toColorSummary);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return translatePostgresError(
        error,
        'One or more of those colours already exist.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  // Excel/CSV import. Duplicate RAL codes within the sheet collapse to
  // their last occurrence (later row = more current) rather than being
  // rejected; existing colours are matched by code and only touched
  // when the sheet's hex actually differs (case-insensitively) from
  // what's stored, so a re-import of an unchanged sheet is a no-op.
  async importColors(
    buffer: Buffer,
    actorId: string,
  ): Promise<ColorImportResult> {
    const { rows, errors } = await parseColorWorkbook(buffer);

    const byCode = new Map<string, ParsedColorRow>();
    // Counts rows collapsed away, not total occurrences — a code
    // appearing 3 times in the sheet reports 2 here (the 2 that lost
    // out to the last-row-wins rule), not 3.
    const duplicateCounts = new Map<string, number>();
    for (const row of rows) {
      if (byCode.has(row.code)) {
        duplicateCounts.set(row.code, (duplicateCounts.get(row.code) ?? 0) + 1);
      }
      byCode.set(row.code, row);
    }

    const existing = await this.colors.find();
    const existingByCode = new Map(existing.map((c) => [c.code, c]));

    const created: string[] = [];
    const updated: { code: string; oldHex: string; newHex: string }[] = [];
    let unchangedCount = 0;
    const toWrite: { code: string; hex: string }[] = [];

    for (const row of byCode.values()) {
      const match = existingByCode.get(row.code);
      if (!match) {
        created.push(row.code);
        toWrite.push({ code: row.code, hex: row.hex });
        continue;
      }
      if (match.hex.toUpperCase() === row.hex.toUpperCase()) {
        unchangedCount += 1;
        continue;
      }
      updated.push({ code: row.code, oldHex: match.hex, newHex: row.hex });
      toWrite.push({ code: row.code, hex: row.hex });
    }

    if (toWrite.length > 0) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        // The version-bump trigger is FOR EACH STATEMENT (see
        // AddLookupTables migration) — but a single INSERT ... ON
        // CONFLICT DO UPDATE that both inserts and updates rows still
        // fires it twice (once for the INSERT event, once for the
        // UPDATE event), not once. Disabling the trigger for this
        // bulk write and bumping lookup_meta by exactly 1 afterwards
        // is the only way to guarantee one version step per import,
        // regardless of row count or create/update mix.
        await queryRunner.query(
          'ALTER TABLE "color" DISABLE TRIGGER "color_bump_lookup_version"',
        );
        const values = toWrite
          .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
          .join(', ');
        const params = toWrite.flatMap((row) => [row.code, row.hex]);
        await queryRunner.query(
          `INSERT INTO "color" ("code", "hex") VALUES ${values}
           ON CONFLICT ("code") DO UPDATE SET "hex" = EXCLUDED."hex", "updated_at" = now()`,
          params,
        );
        await queryRunner.query(
          'ALTER TABLE "color" ENABLE TRIGGER "color_bump_lookup_version"',
        );
        await queryRunner.query(
          `UPDATE "lookup_meta" SET "version" = "version" + 1 WHERE "id" = 'color'`,
        );
        await this.auditLog.record(queryRunner.manager, {
          actorUserId: actorId,
          action: 'lookup.color.imported',
          targetType: 'color',
          metadata: {
            created: created.length,
            updated: updated.length,
            unchanged: unchangedCount,
            duplicates: duplicateCounts.size,
            errors: errors.length,
          },
        });
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    } else {
      await this.auditLog.record(this.colors.manager, {
        actorUserId: actorId,
        action: 'lookup.color.imported',
        targetType: 'color',
        metadata: {
          created: 0,
          updated: 0,
          unchanged: unchangedCount,
          duplicates: duplicateCounts.size,
          errors: errors.length,
        },
      });
    }

    return {
      created,
      updated,
      unchangedCount,
      duplicates: [...duplicateCounts.entries()].map(([code, occurrences]) => ({
        code,
        occurrences,
      })),
      errors,
    };
  }

  // ---- PaintBrand ----

  listPaintBrands(): Promise<PaintBrandSummary[]> {
    return this.brands
      .find({ order: { name: 'ASC' } })
      .then((rows) => rows.map(toPaintBrandSummary));
  }

  async createPaintBrand(
    input: CreatePaintBrandInput,
    actorId: string,
  ): Promise<PaintBrandSummary> {
    const brand = await this.brands.save(this.brands.create(input));
    await this.auditLog.record(this.brands.manager, {
      actorUserId: actorId,
      action: 'lookup.paint_brand.created',
      targetType: 'paint_brand',
      targetId: brand.id,
      metadata: { name: brand.name },
    });
    return toPaintBrandSummary(brand);
  }

  async updatePaintBrand(
    id: string,
    input: UpdatePaintBrandInput,
    actorId: string,
  ): Promise<PaintBrandSummary> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) throw new NotFoundException('Paint brand not found.');
    Object.assign(brand, input);
    await this.brands.save(brand);
    await this.auditLog.record(this.brands.manager, {
      actorUserId: actorId,
      action: 'lookup.paint_brand.updated',
      targetType: 'paint_brand',
      targetId: brand.id,
      metadata: { name: brand.name },
    });
    return toPaintBrandSummary(brand);
  }

  async deletePaintBrand(id: string, actorId: string): Promise<void> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) throw new NotFoundException('Paint brand not found.');
    try {
      await this.brands.delete({ id });
    } catch (error) {
      translatePostgresError(
        error,
        'This brand still has prices and cannot be deleted.',
      );
    }
    await this.auditLog.record(this.brands.manager, {
      actorUserId: actorId,
      action: 'lookup.paint_brand.deleted',
      targetType: 'paint_brand',
      targetId: id,
      metadata: { name: brand.name },
    });
  }

  // ---- PaintingPrice ----

  listPaintingPrices(): Promise<PaintingPriceSummary[]> {
    return this.prices
      .find({ relations: { brand: true }, order: { type: 'ASC' } })
      .then((rows) => rows.map(toPaintingPriceSummary));
  }

  async createPaintingPrice(
    input: CreatePaintingPriceInput,
    actorId: string,
  ): Promise<PaintingPriceSummary> {
    let price: PaintingPrice;
    try {
      price = await this.prices.save(this.prices.create(input));
    } catch (error) {
      return translatePostgresError(error, 'That brand does not exist.');
    }
    await this.auditLog.record(this.prices.manager, {
      actorUserId: actorId,
      action: 'lookup.painting_price.created',
      targetType: 'painting_price',
      targetId: price.id,
      metadata: {
        brandId: price.brandId,
        type: price.type,
        price: price.price,
      },
    });
    const withBrand = await this.prices.findOneOrFail({
      where: { id: price.id },
      relations: { brand: true },
    });
    return toPaintingPriceSummary(withBrand);
  }

  async updatePaintingPrice(
    id: string,
    input: UpdatePaintingPriceInput,
    actorId: string,
  ): Promise<PaintingPriceSummary> {
    const price = await this.prices.findOneBy({ id });
    if (!price) throw new NotFoundException('Painting price not found.');
    Object.assign(price, input);
    try {
      await this.prices.save(price);
    } catch (error) {
      return translatePostgresError(error, 'That brand does not exist.');
    }
    await this.auditLog.record(this.prices.manager, {
      actorUserId: actorId,
      action: 'lookup.painting_price.updated',
      targetType: 'painting_price',
      targetId: price.id,
      metadata: {
        brandId: price.brandId,
        type: price.type,
        price: price.price,
      },
    });
    const withBrand = await this.prices.findOneOrFail({
      where: { id },
      relations: { brand: true },
    });
    return toPaintingPriceSummary(withBrand);
  }

  async deletePaintingPrice(id: string, actorId: string): Promise<void> {
    const price = await this.prices.findOneBy({ id });
    if (!price) throw new NotFoundException('Painting price not found.');
    await this.prices.delete({ id });
    await this.auditLog.record(this.prices.manager, {
      actorUserId: actorId,
      action: 'lookup.painting_price.deleted',
      targetType: 'painting_price',
      targetId: id,
      metadata: { brandId: price.brandId, type: price.type },
    });
  }

  // ---- Tenant read slice ----

  async assembleSlice(): Promise<ColorLookups> {
    const [colors, brands, prices] = await Promise.all([
      this.colors.find({ order: { code: 'ASC' } }),
      this.brands.find({ order: { name: 'ASC' } }),
      this.prices.find({ relations: { brand: true }, order: { type: 'ASC' } }),
    ]);
    return {
      colors: colors.map(toColorSummary),
      brands: brands.map(toPaintBrandSummary),
      prices: prices.map(toPaintingPriceSummary),
    };
  }
}

function toColorSummary(color: Color): ColorSummary {
  return {
    id: color.id,
    code: color.code,
    hex: color.hex,
    createdAt: color.createdAt.toISOString(),
    updatedAt: color.updatedAt.toISOString(),
  };
}

function toPaintBrandSummary(brand: PaintBrand): PaintBrandSummary {
  return {
    id: brand.id,
    name: brand.name,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

function toPaintingPriceSummary(price: PaintingPrice): PaintingPriceSummary {
  return {
    id: price.id,
    brandId: price.brandId,
    brandName: price.brand!.name,
    type: price.type,
    price: price.price,
    createdAt: price.createdAt.toISOString(),
    updatedAt: price.updatedAt.toISOString(),
  };
}
