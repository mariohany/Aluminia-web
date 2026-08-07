import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CreateSystemBrandInput,
  CreateSystemCatalogInput,
  CreateSystemProfileInput,
  SystemBrandSummary,
  SystemCatalogSummary,
  SystemLookups,
  SystemProfileSummary,
  UpdateSystemBrandInput,
  UpdateSystemCatalogInput,
  UpdateSystemProfileInput,
} from '@repo/types/lookups';
import { SystemBrand } from '../../database/control-plane/entities/system-brand.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { translatePostgresError } from './pg-error.util';

// Same accepted-risk tradeoff as ColorLookupsService — see its header
// comment.
@Injectable()
export class SystemLookupsService {
  constructor(
    @InjectRepository(SystemBrand)
    private readonly brands: Repository<SystemBrand>,
    @InjectRepository(SystemCatalog)
    private readonly catalogs: Repository<SystemCatalog>,
    @InjectRepository(SystemProfile)
    private readonly profiles: Repository<SystemProfile>,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---- SystemBrand ----

  listSystemBrands(): Promise<SystemBrandSummary[]> {
    return this.brands
      .find({ order: { name: 'ASC' } })
      .then((rows) => rows.map(toSystemBrandSummary));
  }

  async createSystemBrand(
    input: CreateSystemBrandInput,
    actorId: string,
  ): Promise<SystemBrandSummary> {
    const brand = await this.brands.save(this.brands.create(input));
    await this.auditLog.record(this.brands.manager, {
      actorUserId: actorId,
      action: 'lookup.system_brand.created',
      targetType: 'system_brand',
      targetId: brand.id,
      metadata: { name: brand.name },
    });
    return toSystemBrandSummary(brand);
  }

  async updateSystemBrand(
    id: string,
    input: UpdateSystemBrandInput,
    actorId: string,
  ): Promise<SystemBrandSummary> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) throw new NotFoundException('System brand not found.');
    Object.assign(brand, input);
    await this.brands.save(brand);
    await this.auditLog.record(this.brands.manager, {
      actorUserId: actorId,
      action: 'lookup.system_brand.updated',
      targetType: 'system_brand',
      targetId: brand.id,
      metadata: { name: brand.name },
    });
    return toSystemBrandSummary(brand);
  }

  async deleteSystemBrand(id: string, actorId: string): Promise<void> {
    const brand = await this.brands.findOneBy({ id });
    if (!brand) throw new NotFoundException('System brand not found.');
    try {
      await this.brands.delete({ id });
    } catch (error) {
      translatePostgresError(
        error,
        'This brand still has catalogues and cannot be deleted.',
      );
    }
    await this.auditLog.record(this.brands.manager, {
      actorUserId: actorId,
      action: 'lookup.system_brand.deleted',
      targetType: 'system_brand',
      targetId: id,
      metadata: { name: brand.name },
    });
  }

  // ---- SystemCatalog ----

  listSystemCatalogs(): Promise<SystemCatalogSummary[]> {
    return this.catalogs
      .find({ relations: { brand: true }, order: { name: 'ASC' } })
      .then((rows) => rows.map(toSystemCatalogSummary));
  }

  async createSystemCatalog(
    input: CreateSystemCatalogInput,
    actorId: string,
  ): Promise<SystemCatalogSummary> {
    let catalog: SystemCatalog;
    try {
      catalog = await this.catalogs.save(this.catalogs.create(input));
    } catch (error) {
      return translatePostgresError(error, 'That brand does not exist.');
    }
    await this.auditLog.record(this.catalogs.manager, {
      actorUserId: actorId,
      action: 'lookup.system_catalog.created',
      targetType: 'system_catalog',
      targetId: catalog.id,
      metadata: { name: catalog.name, brandId: catalog.brandId },
    });
    const withBrand = await this.catalogs.findOneOrFail({
      where: { id: catalog.id },
      relations: { brand: true },
    });
    return toSystemCatalogSummary(withBrand);
  }

  async updateSystemCatalog(
    id: string,
    input: UpdateSystemCatalogInput,
    actorId: string,
  ): Promise<SystemCatalogSummary> {
    const catalog = await this.catalogs.findOneBy({ id });
    if (!catalog) throw new NotFoundException('System catalogue not found.');
    Object.assign(catalog, input);
    try {
      await this.catalogs.save(catalog);
    } catch (error) {
      return translatePostgresError(error, 'That brand does not exist.');
    }
    await this.auditLog.record(this.catalogs.manager, {
      actorUserId: actorId,
      action: 'lookup.system_catalog.updated',
      targetType: 'system_catalog',
      targetId: catalog.id,
      metadata: { name: catalog.name, brandId: catalog.brandId },
    });
    const withBrand = await this.catalogs.findOneOrFail({
      where: { id },
      relations: { brand: true },
    });
    return toSystemCatalogSummary(withBrand);
  }

  async deleteSystemCatalog(id: string, actorId: string): Promise<void> {
    const catalog = await this.catalogs.findOneBy({ id });
    if (!catalog) throw new NotFoundException('System catalogue not found.');
    try {
      await this.catalogs.delete({ id });
    } catch (error) {
      translatePostgresError(
        error,
        'This catalogue still has profiles and cannot be deleted.',
      );
    }
    await this.auditLog.record(this.catalogs.manager, {
      actorUserId: actorId,
      action: 'lookup.system_catalog.deleted',
      targetType: 'system_catalog',
      targetId: id,
      metadata: { name: catalog.name },
    });
  }

  // ---- SystemProfile ----

  listSystemProfiles(): Promise<SystemProfileSummary[]> {
    return this.profiles
      .find({ relations: { catalog: true }, order: { profileNo: 'ASC' } })
      .then((rows) => rows.map(toSystemProfileSummary));
  }

  async createSystemProfile(
    input: CreateSystemProfileInput,
    actorId: string,
  ): Promise<SystemProfileSummary> {
    let profile: SystemProfile;
    try {
      profile = await this.profiles.save(this.profiles.create(input));
    } catch (error) {
      return translatePostgresError(error, 'That catalogue does not exist.');
    }
    await this.auditLog.record(this.profiles.manager, {
      actorUserId: actorId,
      action: 'lookup.system_profile.created',
      targetType: 'system_profile',
      targetId: profile.id,
      metadata: { profileNo: profile.profileNo, catalogId: profile.catalogId },
    });
    const withCatalog = await this.profiles.findOneOrFail({
      where: { id: profile.id },
      relations: { catalog: true },
    });
    return toSystemProfileSummary(withCatalog);
  }

  async updateSystemProfile(
    id: string,
    input: UpdateSystemProfileInput,
    actorId: string,
  ): Promise<SystemProfileSummary> {
    const profile = await this.profiles.findOneBy({ id });
    if (!profile) throw new NotFoundException('System profile not found.');
    Object.assign(profile, input);
    try {
      await this.profiles.save(profile);
    } catch (error) {
      return translatePostgresError(error, 'That catalogue does not exist.');
    }
    await this.auditLog.record(this.profiles.manager, {
      actorUserId: actorId,
      action: 'lookup.system_profile.updated',
      targetType: 'system_profile',
      targetId: profile.id,
      metadata: { profileNo: profile.profileNo, catalogId: profile.catalogId },
    });
    const withCatalog = await this.profiles.findOneOrFail({
      where: { id },
      relations: { catalog: true },
    });
    return toSystemProfileSummary(withCatalog);
  }

  async deleteSystemProfile(id: string, actorId: string): Promise<void> {
    const profile = await this.profiles.findOneBy({ id });
    if (!profile) throw new NotFoundException('System profile not found.');
    await this.profiles.delete({ id });
    await this.auditLog.record(this.profiles.manager, {
      actorUserId: actorId,
      action: 'lookup.system_profile.deleted',
      targetType: 'system_profile',
      targetId: id,
      metadata: { profileNo: profile.profileNo },
    });
  }

  // ---- Tenant read slice ----

  async assembleSlice(): Promise<SystemLookups> {
    const [brands, catalogs, profiles] = await Promise.all([
      this.brands.find({ order: { name: 'ASC' } }),
      this.catalogs.find({
        relations: { brand: true },
        order: { name: 'ASC' },
      }),
      this.profiles.find({
        relations: { catalog: true },
        order: { profileNo: 'ASC' },
      }),
    ]);
    return {
      brands: brands.map(toSystemBrandSummary),
      catalogs: catalogs.map(toSystemCatalogSummary),
      profiles: profiles.map(toSystemProfileSummary),
    };
  }
}

function toSystemBrandSummary(brand: SystemBrand): SystemBrandSummary {
  return {
    id: brand.id,
    name: brand.name,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

function toSystemCatalogSummary(catalog: SystemCatalog): SystemCatalogSummary {
  return {
    id: catalog.id,
    brandId: catalog.brandId,
    brandName: catalog.brand!.name,
    name: catalog.name,
    systemType: catalog.systemType,
    maxGlassThickness: catalog.maxGlassThickness,
    maxSashWeight: catalog.maxSashWeight,
    createdAt: catalog.createdAt.toISOString(),
    updatedAt: catalog.updatedAt.toISOString(),
  };
}

function toSystemProfileSummary(profile: SystemProfile): SystemProfileSummary {
  return {
    id: profile.id,
    catalogId: profile.catalogId,
    catalogName: profile.catalog!.name,
    profileNo: profile.profileNo,
    profileType: profile.profileType,
    maxGlassThickness: profile.maxGlassThickness,
    weight: profile.weight,
    perimeter: profile.perimeter,
    inertiaIx: profile.inertiaIx,
    inertiaIy: profile.inertiaIy,
    image: profile.image,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
