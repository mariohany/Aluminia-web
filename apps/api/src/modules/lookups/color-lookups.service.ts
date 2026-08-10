import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  PaintBrandSummary,
  ColorLookups,
  PaintingPriceSummary,
  ColorSummary,
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

// Single-table writes, not wrapped in an explicit transaction: same
// accepted-risk tradeoff already made in CompaniesService.create() for
// provisioning — an audit-log write lagging a successful data write by
// one statement is a narrow risk, not worth a queryRunner per entity
// here. GlassLookupsService.saveCombination is the exception, because a
// combination's item list genuinely needs multi-statement atomicity.
@Injectable()
export class ColorLookupsService {
  constructor(
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
