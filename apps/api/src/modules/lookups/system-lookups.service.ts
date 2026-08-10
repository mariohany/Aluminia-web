import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  LookupEntity,
  type BulkDeleteResult,
  type CreateSystemBrandInput,
  type CreateSystemCatalogInput,
  type CreateSystemProfileInput,
  type SystemBrandSummary,
  type SystemCatalogSummary,
  type SystemLookups,
  type SystemProfileSummary,
  type SystemsImportEntityResult,
  type SystemsImportResult,
  type UpdateSystemBrandInput,
  type UpdateSystemCatalogInput,
  type UpdateSystemProfileInput,
} from '@repo/types/lookups';
import { SystemBrand } from '../../database/control-plane/entities/system-brand.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { translatePostgresError } from './pg-error.util';
import {
  findBlockedIds,
  runWithSingleVersionBump,
} from './lookup-version.util';
import {
  parseSystemsWorkbook,
  type ParsedCatalogRow,
  type ParsedProfileRow,
} from './systems-import.util';

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

  // Combined Brand/Catalogue/Profile Excel import — one sheet per table
  // in the same workbook (tabs named "Brand"/"Catalogue"/"Profile"; a
  // missing sheet just means that table isn't touched by this import,
  // it isn't an error). Sequential by design: catalogues reference a
  // brand by name and profiles reference a catalogue by name, so brands
  // are resolved/created first, then catalogues (which a same-file
  // profile row may need to resolve against), then profiles. Each
  // table's version bump is independent — a sheet that only adds
  // brands doesn't touch the catalogue or profile version.
  async importSystems(
    buffer: Buffer,
    actorId: string,
  ): Promise<SystemsImportResult> {
    const parsed = await parseSystemsWorkbook(buffer);
    const sheetErrors = [...parsed.errors];

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // ---- Phase 1: brands — pure create-if-missing, nothing to
      // update since name is the only field and also the match key.
      const existingBrands = await queryRunner.manager.find(SystemBrand);
      const brandIdByName = new Map(existingBrands.map((b) => [b.name, b.id]));

      const dedupedBrandNames = new Set(parsed.brands.map((row) => row.name));
      const newBrandNames = [...dedupedBrandNames].filter(
        (name) => !brandIdByName.has(name),
      );

      const brandsResult: SystemsImportEntityResult = {
        created: [],
        updated: [],
        unchangedCount: dedupedBrandNames.size - newBrandNames.length,
        errors: [],
      };

      if (newBrandNames.length > 0) {
        await runWithSingleVersionBump(
          queryRunner,
          ['system_brand'],
          LookupEntity.SYSTEM_BRAND,
          async () => {
            const insertResult = await queryRunner.manager
              .createQueryBuilder()
              .insert()
              .into(SystemBrand)
              .values(newBrandNames.map((name) => ({ name })))
              .execute();
            const inserted = await queryRunner.manager.findBy(SystemBrand, {
              id: In(insertResult.identifiers.map((row) => row.id as string)),
            });
            for (const brand of inserted)
              brandIdByName.set(brand.name, brand.id);
            brandsResult.created.push(...inserted.map((b) => b.name));
            return inserted.length > 0;
          },
        );
      }

      // ---- Phase 2: catalogues — resolve brand by name, dedupe by
      // (brandId, name) to the sheet's last row, then diff against
      // what's stored. No unique constraint exists on (brand_id, name)
      // for ON CONFLICT to target, so creates and updates are two
      // separate statements, both inside the single version-bump wrap.
      const catalogsResult: SystemsImportEntityResult = {
        created: [],
        updated: [],
        unchangedCount: 0,
        errors: [],
      };
      const resolvedCatalogRows = new Map<
        string,
        ParsedCatalogRow & { brandId: string }
      >();
      for (const row of parsed.catalogs) {
        const brandId = brandIdByName.get(row.brandName);
        if (!brandId) {
          catalogsResult.errors.push(
            `Catalogue row ${row.rowNumber}: brand "${row.brandName}" was not found (not in the Brand sheet or the database).`,
          );
          continue;
        }
        resolvedCatalogRows.set(`${brandId}::${row.name}`, { ...row, brandId });
      }

      if (resolvedCatalogRows.size > 0) {
        const existingCatalogs = await queryRunner.manager.find(SystemCatalog);
        const existingByKey = new Map(
          existingCatalogs.map((c) => [`${c.brandId}::${c.name}`, c]),
        );

        const toCreate: (ParsedCatalogRow & { brandId: string })[] = [];
        const toUpdate: {
          id: string;
          row: ParsedCatalogRow & { brandId: string };
        }[] = [];
        for (const [key, row] of resolvedCatalogRows) {
          const existing = existingByKey.get(key);
          if (!existing) {
            toCreate.push(row);
            continue;
          }
          const changed =
            existing.systemType !== row.systemType ||
            existing.maxGlassThickness !== row.maxGlassThickness ||
            existing.maxSashWeight !== row.maxSashWeight;
          if (changed) toUpdate.push({ id: existing.id, row });
          else catalogsResult.unchangedCount += 1;
        }

        if (toCreate.length > 0 || toUpdate.length > 0) {
          await runWithSingleVersionBump(
            queryRunner,
            ['system_catalog'],
            LookupEntity.SYSTEM_CATALOG,
            async () => {
              if (toCreate.length > 0) {
                await queryRunner.manager
                  .createQueryBuilder()
                  .insert()
                  .into(SystemCatalog)
                  .values(
                    toCreate.map((row) => ({
                      brandId: row.brandId,
                      name: row.name,
                      systemType: row.systemType,
                      maxGlassThickness: row.maxGlassThickness,
                      maxSashWeight: row.maxSashWeight,
                    })),
                  )
                  .execute();
                catalogsResult.created.push(
                  ...toCreate.map((row) => `${row.brandName} / ${row.name}`),
                );
              }
              if (toUpdate.length > 0) {
                const values = toUpdate
                  .map(
                    (_, i) =>
                      `($${i * 4 + 1}::uuid, $${i * 4 + 2}::system_type, $${i * 4 + 3}::integer, $${i * 4 + 4}::integer)`,
                  )
                  .join(', ');
                const params = toUpdate.flatMap(({ id, row }) => [
                  id,
                  row.systemType,
                  row.maxGlassThickness,
                  row.maxSashWeight,
                ]);
                await queryRunner.query(
                  `UPDATE "system_catalog" AS t
                   SET "system_type" = v.system_type, "max_glass_thickness" = v.max_glass_thickness, "max_sash_weight" = v.max_sash_weight, "updated_at" = now()
                   FROM (VALUES ${values}) AS v(id, system_type, max_glass_thickness, max_sash_weight)
                   WHERE t.id = v.id`,
                  params,
                );
                catalogsResult.updated.push(
                  ...toUpdate.map(
                    ({ row }) => `${row.brandName} / ${row.name}`,
                  ),
                );
              }
              return toCreate.length > 0 || toUpdate.length > 0;
            },
          );
        }
      }

      // ---- Phase 3: profiles — resolve catalogue by name across ALL
      // catalogues (existing + just-created), not just ones in this
      // import's Catalogue sheet. A name matching more than one
      // catalogue (no cross-brand uniqueness in this schema) is
      // reported as ambiguous rather than guessed at.
      const profilesResult: SystemsImportEntityResult = {
        created: [],
        updated: [],
        unchangedCount: 0,
        errors: [],
      };
      const allCatalogs = await queryRunner.manager.find(SystemCatalog);
      const catalogIdsByName = new Map<string, string[]>();
      for (const catalog of allCatalogs) {
        const list = catalogIdsByName.get(catalog.name) ?? [];
        list.push(catalog.id);
        catalogIdsByName.set(catalog.name, list);
      }

      const resolvedProfileRows = new Map<
        string,
        ParsedProfileRow & { catalogId: string }
      >();
      for (const row of parsed.profiles) {
        const catalogIds = catalogIdsByName.get(row.catalogName) ?? [];
        if (catalogIds.length === 0) {
          profilesResult.errors.push(
            `Profile row ${row.rowNumber}: catalogue "${row.catalogName}" was not found.`,
          );
          continue;
        }
        if (catalogIds.length > 1) {
          profilesResult.errors.push(
            `Profile row ${row.rowNumber}: catalogue "${row.catalogName}" is ambiguous — ${catalogIds.length} catalogues share that name across different brands.`,
          );
          continue;
        }
        resolvedProfileRows.set(`${catalogIds[0]}::${row.profileNo}`, {
          ...row,
          catalogId: catalogIds[0],
        });
      }

      if (resolvedProfileRows.size > 0) {
        const existingProfiles = await queryRunner.manager.find(SystemProfile);
        const existingByKey = new Map(
          existingProfiles.map((p) => [`${p.catalogId}::${p.profileNo}`, p]),
        );

        const toCreate: (ParsedProfileRow & { catalogId: string })[] = [];
        const toUpdate: {
          id: string;
          row: ParsedProfileRow & { catalogId: string };
        }[] = [];
        for (const [key, row] of resolvedProfileRows) {
          const existing = existingByKey.get(key);
          if (!existing) {
            toCreate.push(row);
            continue;
          }
          const numbersChanged = [
            [existing.maxGlassThickness, row.maxGlassThickness],
            [existing.weight, row.weight],
            [existing.perimeter, row.perimeter],
            [existing.inertiaIx, row.inertiaIx],
            [existing.inertiaIy, row.inertiaIy],
          ].some(([a, b]) => Math.abs(a - b) > 0.001);
          const changed =
            existing.profileType !== row.profileType ||
            numbersChanged ||
            (existing.image ?? null) !== (row.image ?? null);
          if (changed) toUpdate.push({ id: existing.id, row });
          else profilesResult.unchangedCount += 1;
        }

        if (toCreate.length > 0 || toUpdate.length > 0) {
          await runWithSingleVersionBump(
            queryRunner,
            ['system_profile'],
            LookupEntity.SYSTEM_PROFILE,
            async () => {
              if (toCreate.length > 0) {
                await queryRunner.manager
                  .createQueryBuilder()
                  .insert()
                  .into(SystemProfile)
                  .values(
                    toCreate.map((row) => ({
                      catalogId: row.catalogId,
                      profileNo: row.profileNo,
                      profileType: row.profileType,
                      maxGlassThickness: row.maxGlassThickness,
                      weight: row.weight,
                      perimeter: row.perimeter,
                      inertiaIx: row.inertiaIx,
                      inertiaIy: row.inertiaIy,
                      image: row.image,
                    })),
                  )
                  .execute();
                profilesResult.created.push(
                  ...toCreate.map(
                    (row) => `${row.catalogName} / ${row.profileNo}`,
                  ),
                );
              }
              if (toUpdate.length > 0) {
                const values = toUpdate
                  .map(
                    (_, i) =>
                      `($${i * 8 + 1}::uuid, $${i * 8 + 2}::profile_type, $${i * 8 + 3}::integer, $${i * 8 + 4}::real, $${i * 8 + 5}::integer, $${i * 8 + 6}::real, $${i * 8 + 7}::real, $${i * 8 + 8}::varchar)`,
                  )
                  .join(', ');
                const params = toUpdate.flatMap(({ id, row }) => [
                  id,
                  row.profileType,
                  row.maxGlassThickness,
                  row.weight,
                  row.perimeter,
                  row.inertiaIx,
                  row.inertiaIy,
                  row.image,
                ]);
                await queryRunner.query(
                  `UPDATE "system_profile" AS t
                   SET "profile_type" = v.profile_type, "max_glass_thickness" = v.max_glass_thickness, "weight" = v.weight, "perimeter" = v.perimeter, "inertia_ix" = v.inertia_ix, "inertia_iy" = v.inertia_iy, "image" = v.image, "updated_at" = now()
                   FROM (VALUES ${values}) AS v(id, profile_type, max_glass_thickness, weight, perimeter, inertia_ix, inertia_iy, image)
                   WHERE t.id = v.id`,
                  params,
                );
                profilesResult.updated.push(
                  ...toUpdate.map(
                    ({ row }) => `${row.catalogName} / ${row.profileNo}`,
                  ),
                );
              }
              return toCreate.length > 0 || toUpdate.length > 0;
            },
          );
        }
      }

      brandsResult.errors.push(
        ...sheetErrors.filter((e) => e.startsWith('Brand ')),
      );
      catalogsResult.errors.unshift(
        ...sheetErrors.filter((e) => e.startsWith('Catalogue ')),
      );
      profilesResult.errors.unshift(
        ...sheetErrors.filter((e) => e.startsWith('Profile ')),
      );

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.systems.imported',
        targetType: 'system',
        metadata: {
          brandsCreated: brandsResult.created.length,
          catalogsCreated: catalogsResult.created.length,
          catalogsUpdated: catalogsResult.updated.length,
          profilesCreated: profilesResult.created.length,
          profilesUpdated: profilesResult.updated.length,
        },
      });

      await queryRunner.commitTransaction();
      return {
        brands: brandsResult,
        catalogs: catalogsResult,
        profiles: profilesResult,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
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
