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
  type CompanySystemBrandSummary,
  type CompanySystemCatalogSummary,
  type CompanySystemLookups,
  type CompanySystemProfileSummary,
  type CreateCompanySystemCatalogInput,
  type CreateCompanySystemProfileInput,
  type UpdateCompanySystemCatalogInput,
  type UpdateCompanySystemProfileInput,
} from '@repo/types/company-lookups';
import type {
  BulkDeleteResult,
  CreateSystemBrandInput,
  UpdateSystemBrandInput,
} from '@repo/types/lookups';
import { SystemBrand } from '../../database/control-plane/entities/system-brand.entity';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { CompanySystemBrand } from '../../database/tenant/entities/company-system-brand.entity';
import { CompanySystemCatalog } from '../../database/tenant/entities/company-system-catalog.entity';
import { CompanySystemProfile } from '../../database/tenant/entities/company-system-profile.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { translatePostgresError } from '../lookups/pg-error.util';
import {
  assertSystemBrandAvailable,
  assertSystemCatalogAvailable,
  assertSystemProfileAvailable,
} from './platform-collision.util';
import { findBlockedIds } from './find-blocked-ids.util';
import { resolveScopedRef } from './scoped-ref.util';

// Systems cluster's tenant-owned counterpart to SystemLookupsService.
// See CompanyColorLookupsService's header comment for the "one
// tenantContext.run() call, platform reads mixed in freely" pattern
// this follows throughout.
@Injectable()
export class CompanySystemLookupsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(SystemBrand)
    private readonly platformBrands: Repository<SystemBrand>,
    @InjectRepository(SystemCatalog)
    private readonly platformCatalogs: Repository<SystemCatalog>,
    @InjectRepository(SystemProfile)
    private readonly platformProfiles: Repository<SystemProfile>,
  ) {}

  // ---- SystemBrand ----

  async createSystemBrand(
    input: CreateSystemBrandInput,
  ): Promise<CompanySystemBrandSummary> {
    await assertSystemBrandAvailable(this.platformBrands, input.name);
    return this.tenantContext.run(async (manager) => {
      const brand = manager.create(CompanySystemBrand, input);
      try {
        await manager.save(brand);
      } catch (error) {
        conflictOrThrow(
          error,
          `You already have a system brand named "${input.name.trim()}".`,
        );
      }
      return toCompanySystemBrandSummary(brand);
    });
  }

  async updateSystemBrand(
    id: string,
    input: UpdateSystemBrandInput,
  ): Promise<CompanySystemBrandSummary> {
    return this.tenantContext.run(async (manager) => {
      const brand = await manager.findOneBy(CompanySystemBrand, { id });
      if (!brand) throw new NotFoundException('System brand not found.');
      if (input.name !== undefined)
        await assertSystemBrandAvailable(this.platformBrands, input.name);
      Object.assign(brand, input);
      try {
        await manager.save(brand);
      } catch (error) {
        conflictOrThrow(
          error,
          `You already have a system brand named "${brand.name.trim()}".`,
        );
      }
      return toCompanySystemBrandSummary(brand);
    });
  }

  async deleteSystemBrand(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const brand = await manager.findOneBy(CompanySystemBrand, { id });
      if (!brand) throw new NotFoundException('System brand not found.');
      try {
        await manager.delete(CompanySystemBrand, { id });
      } catch (error) {
        translatePostgresError(
          error,
          'This brand still has catalogues and cannot be deleted.',
        );
      }
    });
  }

  async bulkDeleteSystemBrands(ids: string[]): Promise<BulkDeleteResult> {
    return this.tenantContext.run(async (manager) => {
      const blockedIds = await findBlockedIds(manager, ids, [
        { table: 'company_system_catalog', column: 'company_brand_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));
      if (deletableIds.length > 0)
        await manager.delete(CompanySystemBrand, deletableIds);
      return { deletedIds: deletableIds, blockedIds: [...blockedIds] };
    });
  }

  async bulkDuplicateSystemBrands(
    items: CreateSystemBrandInput[],
  ): Promise<CompanySystemBrandSummary[]> {
    for (const item of items)
      await assertSystemBrandAvailable(this.platformBrands, item.name);
    return this.tenantContext.run(async (manager) => {
      try {
        const insertResult = await manager
          .createQueryBuilder()
          .insert()
          .into(CompanySystemBrand)
          .values(items)
          .execute();
        const newIds = insertResult.identifiers.map((i) => i.id as string);
        const created = await manager.findBy(CompanySystemBrand, {
          id: In(newIds),
        });
        return created.map(toCompanySystemBrandSummary);
      } catch (error) {
        return conflictOrThrow(
          error,
          'One or more of those system brands already exist.',
        );
      }
    });
  }

  // ---- SystemCatalog ----

  async createSystemCatalog(
    input: CreateCompanySystemCatalogInput,
  ): Promise<CompanySystemCatalogSummary> {
    const { platformId, companyId } = resolveScopedRef(input.brand);
    await assertSystemCatalogAvailable(
      this.platformCatalogs,
      platformId,
      input.name,
    );
    return this.tenantContext.run(async (manager) => {
      const catalog = manager.create(CompanySystemCatalog, {
        platformBrandId: platformId,
        companyBrandId: companyId,
        name: input.name,
        systemType: input.systemType,
        maxGlassThickness: input.maxGlassThickness,
        maxSashWeight: input.maxSashWeight,
      });
      try {
        await manager.save(catalog);
      } catch (error) {
        this.translateCatalogWriteError(error);
      }
      return (await this.resolveCatalogSummaries(manager, [catalog]))[0];
    });
  }

  async updateSystemCatalog(
    id: string,
    input: UpdateCompanySystemCatalogInput,
  ): Promise<CompanySystemCatalogSummary> {
    return this.tenantContext.run(async (manager) => {
      const catalog = await manager.findOneBy(CompanySystemCatalog, { id });
      if (!catalog) throw new NotFoundException('System catalogue not found.');

      let platformId = catalog.platformBrandId;
      let companyId = catalog.companyBrandId;
      if (input.brand !== undefined) {
        const resolved = resolveScopedRef(input.brand);
        platformId = resolved.platformId;
        companyId = resolved.companyId;
      }
      const name = input.name ?? catalog.name;
      if (input.brand !== undefined || input.name !== undefined) {
        await assertSystemCatalogAvailable(
          this.platformCatalogs,
          platformId,
          name,
        );
      }

      catalog.platformBrandId = platformId;
      catalog.companyBrandId = companyId;
      if (input.name !== undefined) catalog.name = input.name;
      if (input.systemType !== undefined) catalog.systemType = input.systemType;
      if (input.maxGlassThickness !== undefined)
        catalog.maxGlassThickness = input.maxGlassThickness;
      if (input.maxSashWeight !== undefined)
        catalog.maxSashWeight = input.maxSashWeight;

      try {
        await manager.save(catalog);
      } catch (error) {
        this.translateCatalogWriteError(error);
      }
      return (await this.resolveCatalogSummaries(manager, [catalog]))[0];
    });
  }

  async deleteSystemCatalog(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const catalog = await manager.findOneBy(CompanySystemCatalog, { id });
      if (!catalog) throw new NotFoundException('System catalogue not found.');
      try {
        await manager.delete(CompanySystemCatalog, { id });
      } catch (error) {
        translatePostgresError(
          error,
          'This catalogue still has profiles and cannot be deleted.',
        );
      }
    });
  }

  async bulkDeleteSystemCatalogs(ids: string[]): Promise<BulkDeleteResult> {
    return this.tenantContext.run(async (manager) => {
      const blockedIds = await findBlockedIds(manager, ids, [
        { table: 'company_system_profile', column: 'company_catalog_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));
      if (deletableIds.length > 0)
        await manager.delete(CompanySystemCatalog, deletableIds);
      return { deletedIds: deletableIds, blockedIds: [...blockedIds] };
    });
  }

  async bulkDuplicateSystemCatalogs(
    items: CreateCompanySystemCatalogInput[],
  ): Promise<CompanySystemCatalogSummary[]> {
    const resolved = items.map((item) => ({
      item,
      ref: resolveScopedRef(item.brand),
    }));
    for (const { item, ref } of resolved) {
      await assertSystemCatalogAvailable(
        this.platformCatalogs,
        ref.platformId,
        item.name,
      );
    }
    return this.tenantContext.run(async (manager) => {
      try {
        const insertResult = await manager
          .createQueryBuilder()
          .insert()
          .into(CompanySystemCatalog)
          .values(
            resolved.map(({ item, ref }) => ({
              platformBrandId: ref.platformId,
              companyBrandId: ref.companyId,
              name: item.name,
              systemType: item.systemType,
              maxGlassThickness: item.maxGlassThickness,
              maxSashWeight: item.maxSashWeight,
            })),
          )
          .execute();
        const newIds = insertResult.identifiers.map((i) => i.id as string);
        const created = await manager.findBy(CompanySystemCatalog, {
          id: In(newIds),
        });
        return this.resolveCatalogSummaries(manager, created);
      } catch (error) {
        return conflictOrThrow(
          error,
          'One or more of those catalogues already exist.',
        );
      }
    });
  }

  private translateCatalogWriteError(error: unknown): never {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === '23505')
      throw new ConflictException(
        'You already have a catalogue with that name under that brand.',
      );
    translatePostgresError(error, 'That brand does not exist.');
  }

  private async resolveCatalogSummaries(
    manager: EntityManager,
    catalogs: CompanySystemCatalog[],
  ): Promise<CompanySystemCatalogSummary[]> {
    const companyBrandIds = uniqueDefined(
      catalogs.map((c) => c.companyBrandId),
    );
    const platformBrandIds = uniqueDefined(
      catalogs.map((c) => c.platformBrandId),
    );
    const [companyBrands, platformBrands] = await Promise.all([
      companyBrandIds.length > 0
        ? manager.findBy(CompanySystemBrand, { id: In(companyBrandIds) })
        : Promise.resolve([]),
      platformBrandIds.length > 0
        ? this.platformBrands.findBy({ id: In(platformBrandIds) })
        : Promise.resolve([]),
    ]);
    const companyBrandById = new Map(companyBrands.map((b) => [b.id, b]));
    const platformBrandById = new Map(platformBrands.map((b) => [b.id, b]));
    return catalogs.map((catalog) => {
      const isPlatform = !!catalog.platformBrandId;
      return {
        id: catalog.id,
        brand: formatScopedRef(
          isPlatform ? LookupScope.PLATFORM : LookupScope.COMPANY,
          (catalog.platformBrandId ?? catalog.companyBrandId)!,
        ),
        brandName: isPlatform
          ? (platformBrandById.get(catalog.platformBrandId!)?.name ?? null)
          : (companyBrandById.get(catalog.companyBrandId!)?.name ?? null),
        brandScope: isPlatform ? LookupScope.PLATFORM : LookupScope.COMPANY,
        name: catalog.name,
        systemType: catalog.systemType,
        maxGlassThickness: catalog.maxGlassThickness,
        maxSashWeight: catalog.maxSashWeight,
        scope: LookupScope.COMPANY,
        createdAt: catalog.createdAt.toISOString(),
        updatedAt: catalog.updatedAt.toISOString(),
      };
    });
  }

  // ---- SystemProfile ----

  async createSystemProfile(
    input: CreateCompanySystemProfileInput,
  ): Promise<CompanySystemProfileSummary> {
    const { platformId, companyId } = resolveScopedRef(input.catalog);
    await assertSystemProfileAvailable(
      this.platformProfiles,
      platformId,
      input.profileNo,
    );
    return this.tenantContext.run(async (manager) => {
      const profile = manager.create(CompanySystemProfile, {
        platformCatalogId: platformId,
        companyCatalogId: companyId,
        profileNo: input.profileNo,
        profileType: input.profileType,
        maxGlassThickness: input.maxGlassThickness,
        weight: input.weight,
        perimeter: input.perimeter,
        inertiaIx: input.inertiaIx,
        inertiaIy: input.inertiaIy,
        image: input.image ?? null,
        acceptsFlyScreen: input.acceptsFlyScreen,
      });
      try {
        await manager.save(profile);
      } catch (error) {
        this.translateProfileWriteError(error);
      }
      return (await this.resolveProfileSummaries(manager, [profile]))[0];
    });
  }

  async updateSystemProfile(
    id: string,
    input: UpdateCompanySystemProfileInput,
  ): Promise<CompanySystemProfileSummary> {
    return this.tenantContext.run(async (manager) => {
      const profile = await manager.findOneBy(CompanySystemProfile, { id });
      if (!profile) throw new NotFoundException('System profile not found.');

      let platformId = profile.platformCatalogId;
      let companyId = profile.companyCatalogId;
      if (input.catalog !== undefined) {
        const resolved = resolveScopedRef(input.catalog);
        platformId = resolved.platformId;
        companyId = resolved.companyId;
      }
      const profileNo = input.profileNo ?? profile.profileNo;
      if (input.catalog !== undefined || input.profileNo !== undefined) {
        await assertSystemProfileAvailable(
          this.platformProfiles,
          platformId,
          profileNo,
        );
      }

      profile.platformCatalogId = platformId;
      profile.companyCatalogId = companyId;
      if (input.profileNo !== undefined) profile.profileNo = input.profileNo;
      if (input.profileType !== undefined)
        profile.profileType = input.profileType;
      if (input.maxGlassThickness !== undefined)
        profile.maxGlassThickness = input.maxGlassThickness;
      if (input.weight !== undefined) profile.weight = input.weight;
      if (input.perimeter !== undefined) profile.perimeter = input.perimeter;
      if (input.inertiaIx !== undefined) profile.inertiaIx = input.inertiaIx;
      if (input.inertiaIy !== undefined) profile.inertiaIy = input.inertiaIy;
      if (input.image !== undefined) profile.image = input.image ?? null;
      if (input.acceptsFlyScreen !== undefined)
        profile.acceptsFlyScreen = input.acceptsFlyScreen;

      try {
        await manager.save(profile);
      } catch (error) {
        this.translateProfileWriteError(error);
      }
      return (await this.resolveProfileSummaries(manager, [profile]))[0];
    });
  }

  async deleteSystemProfile(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const profile = await manager.findOneBy(CompanySystemProfile, { id });
      if (!profile) throw new NotFoundException('System profile not found.');
      await manager.delete(CompanySystemProfile, { id });
    });
  }

  async bulkDeleteSystemProfiles(ids: string[]): Promise<BulkDeleteResult> {
    return this.tenantContext.run(async (manager) => {
      const result = await manager.delete(CompanySystemProfile, ids);
      return {
        deletedIds: (result.affected ?? 0) > 0 ? ids : [],
        blockedIds: [],
      };
    });
  }

  async bulkDuplicateSystemProfiles(
    items: CreateCompanySystemProfileInput[],
  ): Promise<CompanySystemProfileSummary[]> {
    const resolved = items.map((item) => ({
      item,
      ref: resolveScopedRef(item.catalog),
    }));
    for (const { item, ref } of resolved) {
      await assertSystemProfileAvailable(
        this.platformProfiles,
        ref.platformId,
        item.profileNo,
      );
    }
    return this.tenantContext.run(async (manager) => {
      try {
        const insertResult = await manager
          .createQueryBuilder()
          .insert()
          .into(CompanySystemProfile)
          .values(
            resolved.map(({ item, ref }) => ({
              platformCatalogId: ref.platformId,
              companyCatalogId: ref.companyId,
              profileNo: item.profileNo,
              profileType: item.profileType,
              maxGlassThickness: item.maxGlassThickness,
              weight: item.weight,
              perimeter: item.perimeter,
              inertiaIx: item.inertiaIx,
              inertiaIy: item.inertiaIy,
              image: item.image ?? null,
              acceptsFlyScreen: item.acceptsFlyScreen,
            })),
          )
          .execute();
        const newIds = insertResult.identifiers.map((i) => i.id as string);
        const created = await manager.findBy(CompanySystemProfile, {
          id: In(newIds),
        });
        return this.resolveProfileSummaries(manager, created);
      } catch (error) {
        return conflictOrThrow(
          error,
          'One or more of those profiles already exist.',
        );
      }
    });
  }

  private translateProfileWriteError(error: unknown): never {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === '23505')
      throw new ConflictException(
        'You already have a profile with that number under that catalogue.',
      );
    translatePostgresError(error, 'That catalogue does not exist.');
  }

  private async resolveProfileSummaries(
    manager: EntityManager,
    profiles: CompanySystemProfile[],
  ): Promise<CompanySystemProfileSummary[]> {
    const companyCatalogIds = uniqueDefined(
      profiles.map((p) => p.companyCatalogId),
    );
    const platformCatalogIds = uniqueDefined(
      profiles.map((p) => p.platformCatalogId),
    );
    const [companyCatalogs, platformCatalogs] = await Promise.all([
      companyCatalogIds.length > 0
        ? manager.findBy(CompanySystemCatalog, { id: In(companyCatalogIds) })
        : Promise.resolve([]),
      platformCatalogIds.length > 0
        ? this.platformCatalogs.findBy({ id: In(platformCatalogIds) })
        : Promise.resolve([]),
    ]);
    const companyCatalogById = new Map(companyCatalogs.map((c) => [c.id, c]));
    const platformCatalogById = new Map(platformCatalogs.map((c) => [c.id, c]));
    return profiles.map((profile) => {
      const isPlatform = !!profile.platformCatalogId;
      return {
        id: profile.id,
        catalog: formatScopedRef(
          isPlatform ? LookupScope.PLATFORM : LookupScope.COMPANY,
          (profile.platformCatalogId ?? profile.companyCatalogId)!,
        ),
        catalogName: isPlatform
          ? (platformCatalogById.get(profile.platformCatalogId!)?.name ?? null)
          : (companyCatalogById.get(profile.companyCatalogId!)?.name ?? null),
        catalogScope: isPlatform ? LookupScope.PLATFORM : LookupScope.COMPANY,
        profileNo: profile.profileNo,
        profileType: profile.profileType,
        maxGlassThickness: profile.maxGlassThickness,
        weight: profile.weight,
        perimeter: profile.perimeter,
        inertiaIx: profile.inertiaIx,
        inertiaIy: profile.inertiaIy,
        image: profile.image,
        acceptsFlyScreen: profile.acceptsFlyScreen,
        scope: LookupScope.COMPANY,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      };
    });
  }

  // ---- Tenant read slice ----

  async assembleSlice(): Promise<CompanySystemLookups> {
    return this.tenantContext.run(async (manager) => {
      const [brands, catalogs, profiles] = await Promise.all([
        manager.find(CompanySystemBrand, { order: { name: 'ASC' } }),
        manager.find(CompanySystemCatalog, { order: { name: 'ASC' } }),
        manager.find(CompanySystemProfile, { order: { profileNo: 'ASC' } }),
      ]);
      const [catalogSummaries, profileSummaries] = await Promise.all([
        this.resolveCatalogSummaries(manager, catalogs),
        this.resolveProfileSummaries(manager, profiles),
      ]);
      return {
        brands: brands.map(toCompanySystemBrandSummary),
        catalogs: catalogSummaries,
        profiles: profileSummaries,
      };
    });
  }
}

function uniqueDefined(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function toCompanySystemBrandSummary(
  brand: CompanySystemBrand,
): CompanySystemBrandSummary {
  return {
    id: brand.id,
    name: brand.name,
    scope: LookupScope.COMPANY,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

function conflictOrThrow(error: unknown, message: string): never {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === '23505') throw new ConflictException(message);
  throw error as Error;
}
