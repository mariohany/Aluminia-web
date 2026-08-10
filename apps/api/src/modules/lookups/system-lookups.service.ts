import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type {
  BulkDeleteResult,
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
import { findBlockedIds } from './lookup-version.util';

// Same accepted-risk tradeoff as ColorLookupsService — see its header
// comment. bulk* methods are the exception, same reasoning as
// ColorLookupsService.bulkDeleteColors/bulkDuplicateColors.
@Injectable()
export class SystemLookupsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
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

  async bulkDeleteSystemBrands(
    ids: string[],
    actorId: string,
  ): Promise<BulkDeleteResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const blockedIds = await findBlockedIds(queryRunner, ids, [
        { table: 'system_catalog', column: 'brand_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));

      if (deletableIds.length > 0) {
        await queryRunner.manager.delete(SystemBrand, deletableIds);
        await this.auditLog.record(queryRunner.manager, {
          actorUserId: actorId,
          action: 'lookup.system_brand.bulk_deleted',
          targetType: 'system_brand',
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

  async bulkDuplicateSystemBrands(
    items: CreateSystemBrandInput[],
    actorId: string,
  ): Promise<SystemBrandSummary[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(SystemBrand)
        .values(items)
        .execute();
      const newIds = insertResult.identifiers.map((row) => row.id as string);
      const created = await queryRunner.manager.findBy(SystemBrand, {
        id: In(newIds),
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.system_brand.bulk_duplicated',
        targetType: 'system_brand',
        metadata: { count: created.length },
      });

      await queryRunner.commitTransaction();
      return created.map(toSystemBrandSummary);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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

  async bulkDeleteSystemCatalogs(
    ids: string[],
    actorId: string,
  ): Promise<BulkDeleteResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const blockedIds = await findBlockedIds(queryRunner, ids, [
        { table: 'system_profile', column: 'catalog_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));

      if (deletableIds.length > 0) {
        await queryRunner.manager.delete(SystemCatalog, deletableIds);
        await this.auditLog.record(queryRunner.manager, {
          actorUserId: actorId,
          action: 'lookup.system_catalog.bulk_deleted',
          targetType: 'system_catalog',
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

  async bulkDuplicateSystemCatalogs(
    items: CreateSystemCatalogInput[],
    actorId: string,
  ): Promise<SystemCatalogSummary[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(SystemCatalog)
        .values(items)
        .execute();
      const newIds = insertResult.identifiers.map((row) => row.id as string);
      const created = await queryRunner.manager.find(SystemCatalog, {
        where: { id: In(newIds) },
        relations: { brand: true },
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.system_catalog.bulk_duplicated',
        targetType: 'system_catalog',
        metadata: { count: created.length },
      });

      await queryRunner.commitTransaction();
      return created.map(toSystemCatalogSummary);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return translatePostgresError(error, 'That brand does not exist.');
    } finally {
      await queryRunner.release();
    }
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

  // No pre-check needed — nothing in this schema references a profile,
  // so a bulk delete can never be partially blocked.
  async bulkDeleteSystemProfiles(
    ids: string[],
    actorId: string,
  ): Promise<BulkDeleteResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.delete(SystemProfile, ids);
      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.system_profile.bulk_deleted',
        targetType: 'system_profile',
        metadata: { count: ids.length, ids },
      });

      await queryRunner.commitTransaction();
      return { deletedIds: ids, blockedIds: [] };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async bulkDuplicateSystemProfiles(
    items: CreateSystemProfileInput[],
    actorId: string,
  ): Promise<SystemProfileSummary[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(SystemProfile)
        .values(items)
        .execute();
      const newIds = insertResult.identifiers.map((row) => row.id as string);
      const created = await queryRunner.manager.find(SystemProfile, {
        where: { id: In(newIds) },
        relations: { catalog: true },
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.system_profile.bulk_duplicated',
        targetType: 'system_profile',
        metadata: { count: created.length },
      });

      await queryRunner.commitTransaction();
      return created.map(toSystemProfileSummary);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return translatePostgresError(error, 'That catalogue does not exist.');
    } finally {
      await queryRunner.release();
    }
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
