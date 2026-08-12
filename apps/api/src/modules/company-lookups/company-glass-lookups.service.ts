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
  createCompanyGlassCombinationSchema,
  formatScopedRef,
  type CompanyGlassCombinationItemInput,
  type CompanyGlassCombinationItemSummary,
  type CompanyGlassCombinationSummary,
  type CompanyGlassLookups,
  type CompanyGlassSummary,
  type CreateCompanyGlassCombinationInput,
  type LooseCompanyGlassCombinationInput,
  type UpdateCompanyGlassCombinationInput,
} from '@repo/types/company-lookups';
import {
  CombinationItemKind,
  GlassGapType,
  type BulkDeleteResult,
  type CreateGlassInput,
  type UpdateGlassInput,
} from '@repo/types/lookups';
import { Color } from '../../database/control-plane/entities/color.entity';
import { Glass } from '../../database/control-plane/entities/glass.entity';
import { GlassCombination } from '../../database/control-plane/entities/glass-combination.entity';
import { CompanyColor } from '../../database/tenant/entities/company-color.entity';
import { CompanyGlass } from '../../database/tenant/entities/company-glass.entity';
import { CompanyGlassCombination } from '../../database/tenant/entities/company-glass-combination.entity';
import { CompanyGlassCombinationItem } from '../../database/tenant/entities/company-glass-combination-item.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { translatePostgresError } from '../lookups/pg-error.util';
import {
  assertGlassAvailable,
  assertGlassCombinationAvailable,
} from './platform-collision.util';
import { findBlockedIds } from './find-blocked-ids.util';
import { resolveScopedRef } from './scoped-ref.util';

// Glass cluster's tenant-owned counterpart to GlassLookupsService. See
// CompanyColorLookupsService's header comment for the "one
// tenantContext.run() call, platform reads mixed in freely" pattern
// this follows throughout.
@Injectable()
export class CompanyGlassLookupsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(Glass)
    private readonly platformGlasses: Repository<Glass>,
    @InjectRepository(Color) private readonly platformColors: Repository<Color>,
    @InjectRepository(GlassCombination)
    private readonly platformCombinations: Repository<GlassCombination>,
  ) {}

  // ---- Glass ----
  // No standalone list route — see CompanyColorLookupsService's comment
  // on why only assembleSlice() is wired to a controller GET.

  async createGlass(input: CreateGlassInput): Promise<CompanyGlassSummary> {
    await assertGlassAvailable(this.platformGlasses, input.name);
    return this.tenantContext.run(async (manager) => {
      const glass = manager.create(CompanyGlass, input);
      try {
        await manager.save(glass);
      } catch (error) {
        conflictOrThrow(
          error,
          `You already have glass named "${input.name.trim()}".`,
        );
      }
      return toCompanyGlassSummary(glass);
    });
  }

  async updateGlass(
    id: string,
    input: UpdateGlassInput,
  ): Promise<CompanyGlassSummary> {
    return this.tenantContext.run(async (manager) => {
      const glass = await manager.findOneBy(CompanyGlass, { id });
      if (!glass) throw new NotFoundException('Glass not found.');
      if (input.name !== undefined)
        await assertGlassAvailable(this.platformGlasses, input.name);
      Object.assign(glass, input);
      try {
        await manager.save(glass);
      } catch (error) {
        conflictOrThrow(
          error,
          `You already have glass named "${glass.name.trim()}".`,
        );
      }
      return toCompanyGlassSummary(glass);
    });
  }

  async deleteGlass(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const glass = await manager.findOneBy(CompanyGlass, { id });
      if (!glass) throw new NotFoundException('Glass not found.');
      try {
        await manager.delete(CompanyGlass, { id });
      } catch (error) {
        translatePostgresError(
          error,
          'This glass is still used by a glass combination and cannot be deleted.',
        );
      }
    });
  }

  async bulkDeleteGlass(ids: string[]): Promise<BulkDeleteResult> {
    return this.tenantContext.run(async (manager) => {
      const blockedIds = await findBlockedIds(manager, ids, [
        { table: 'company_glass_combination_item', column: 'company_glass_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));
      if (deletableIds.length > 0)
        await manager.delete(CompanyGlass, deletableIds);
      return { deletedIds: deletableIds, blockedIds: [...blockedIds] };
    });
  }

  async bulkDuplicateGlass(
    items: CreateGlassInput[],
  ): Promise<CompanyGlassSummary[]> {
    for (const item of items)
      await assertGlassAvailable(this.platformGlasses, item.name);
    return this.tenantContext.run(async (manager) => {
      try {
        const insertResult = await manager
          .createQueryBuilder()
          .insert()
          .into(CompanyGlass)
          .values(items)
          .execute();
        const newIds = insertResult.identifiers.map((i) => i.id as string);
        const created = await manager.findBy(CompanyGlass, { id: In(newIds) });
        return created.map(toCompanyGlassSummary);
      } catch (error) {
        return conflictOrThrow(
          error,
          'One or more of that glass already exists.',
        );
      }
    });
  }

  // ---- GlassCombination ----
  // Written whole, same as the platform version — the full ordered item
  // list is replaced inside a transaction rather than diffed.

  async createGlassCombination(
    input: CreateCompanyGlassCombinationInput,
  ): Promise<CompanyGlassCombinationSummary> {
    await assertGlassCombinationAvailable(
      this.platformCombinations,
      input.name,
    );
    return this.tenantContext.run(async (manager) => {
      const combo = manager.create(CompanyGlassCombination, {
        name: input.name,
      });
      try {
        await manager.save(combo);
      } catch (error) {
        conflictOrThrow(
          error,
          `You already have a glass combination named "${input.name.trim()}".`,
        );
      }
      try {
        await manager.insert(
          CompanyGlassCombinationItem,
          buildCompanyItemRows(combo.id, input.items),
        );
      } catch (error) {
        translatePostgresError(
          error,
          'One of the glass or colour references in this combination does not exist.',
        );
      }
      const items = await manager.find(CompanyGlassCombinationItem, {
        where: { combinationId: combo.id },
        order: { position: 'ASC' },
      });
      return (
        await this.resolveCombinationSummaries(manager, [combo], items)
      )[0];
    });
  }

  async updateGlassCombination(
    id: string,
    input: UpdateCompanyGlassCombinationInput,
  ): Promise<CompanyGlassCombinationSummary> {
    return this.tenantContext.run(async (manager) => {
      const combo = await manager.findOneBy(CompanyGlassCombination, { id });
      if (!combo) throw new NotFoundException('Glass combination not found.');

      if (input.name !== undefined) {
        await assertGlassCombinationAvailable(
          this.platformCombinations,
          input.name,
        );
        combo.name = input.name;
      }
      try {
        await manager.save(combo);
      } catch (error) {
        conflictOrThrow(
          error,
          `You already have a glass combination named "${combo.name.trim()}".`,
        );
      }

      if (input.items !== undefined) {
        await manager.delete(CompanyGlassCombinationItem, {
          combinationId: id,
        });
        try {
          await manager.insert(
            CompanyGlassCombinationItem,
            buildCompanyItemRows(id, input.items),
          );
        } catch (error) {
          translatePostgresError(
            error,
            'One of the glass or colour references in this combination does not exist.',
          );
        }
      }

      const items = await manager.find(CompanyGlassCombinationItem, {
        where: { combinationId: id },
        order: { position: 'ASC' },
      });
      return (
        await this.resolveCombinationSummaries(manager, [combo], items)
      )[0];
    });
  }

  async deleteGlassCombination(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const combo = await manager.findOneBy(CompanyGlassCombination, { id });
      if (!combo) throw new NotFoundException('Glass combination not found.');
      // Items cascade automatically (combination_id is ON DELETE CASCADE).
      await manager.delete(CompanyGlassCombination, { id });
    });
  }

  async bulkDeleteGlassCombinations(ids: string[]): Promise<BulkDeleteResult> {
    return this.tenantContext.run(async (manager) => {
      const result = await manager.delete(CompanyGlassCombination, ids);
      return {
        deletedIds: (result.affected ?? 0) > 0 ? ids : [],
        blockedIds: [],
      };
    });
  }

  // Same "loose shape now, full structural rules per item" split as the
  // platform version (GlassLookupsService's own comment explains why:
  // one legacy-shaped item shouldn't 400 the whole batch) — with a
  // platform-collision check added per valid item, since that's the one
  // rule the shape validation alone can't catch.
  async bulkDuplicateGlassCombinations(
    items: LooseCompanyGlassCombinationInput[],
  ): Promise<{
    created: CompanyGlassCombinationSummary[];
    failedCount: number;
  }> {
    const validItems: CreateCompanyGlassCombinationInput[] = [];
    let failedCount = 0;
    for (const item of items) {
      const result = createCompanyGlassCombinationSchema.safeParse(item);
      if (result.success) validItems.push(result.data);
      else failedCount += 1;
    }

    const availableItems: CreateCompanyGlassCombinationInput[] = [];
    for (const item of validItems) {
      try {
        await assertGlassCombinationAvailable(
          this.platformCombinations,
          item.name,
        );
        availableItems.push(item);
      } catch {
        failedCount += 1;
      }
    }

    if (availableItems.length === 0) return { created: [], failedCount };

    return this.tenantContext.run(async (manager) => {
      const insertResult = await manager
        .createQueryBuilder()
        .insert()
        .into(CompanyGlassCombination)
        .values(availableItems.map((item) => ({ name: item.name })))
        .execute();
      const newIds = insertResult.identifiers.map((row) => row.id as string);

      const allItemRows = newIds.flatMap((comboId, index) =>
        buildCompanyItemRows(comboId, availableItems[index].items),
      );
      await manager.insert(CompanyGlassCombinationItem, allItemRows);

      const newCombos = await manager.findBy(CompanyGlassCombination, {
        id: In(newIds),
      });
      const newItems = await manager.find(CompanyGlassCombinationItem, {
        where: { combinationId: In(newIds) },
        order: { position: 'ASC' },
      });
      const created = await this.resolveCombinationSummaries(
        manager,
        newCombos,
        newItems,
      );
      return { created, failedCount };
    });
  }

  // ---- Tenant read slice ----

  async assembleSlice(): Promise<CompanyGlassLookups> {
    return this.tenantContext.run(async (manager) => {
      const glass = await manager.find(CompanyGlass, {
        order: { name: 'ASC' },
      });
      const combos = await manager.find(CompanyGlassCombination, {
        order: { name: 'ASC' },
      });
      const items =
        combos.length > 0
          ? await manager.find(CompanyGlassCombinationItem, {
              where: { combinationId: In(combos.map((c) => c.id)) },
              order: { position: 'ASC' },
            })
          : [];
      return {
        glass: glass.map(toCompanyGlassSummary),
        combinations: await this.resolveCombinationSummaries(
          manager,
          combos,
          items,
        ),
      };
    });
  }

  // Batches the platform-vs-company glass/colour lookups across every
  // item of every combination passed in, rather than resolving one
  // combination at a time — same principle as
  // CompanyColorLookupsService.resolvePaintingPriceSummaries.
  private async resolveCombinationSummaries(
    manager: EntityManager,
    combos: CompanyGlassCombination[],
    items: CompanyGlassCombinationItem[],
  ): Promise<CompanyGlassCombinationSummary[]> {
    const itemsByCombo = new Map<string, CompanyGlassCombinationItem[]>();
    for (const item of items) {
      const list = itemsByCombo.get(item.combinationId) ?? [];
      list.push(item);
      itemsByCombo.set(item.combinationId, list);
    }

    const companyGlassIds = uniqueDefined(items.map((i) => i.companyGlassId));
    const platformGlassIds = uniqueDefined(items.map((i) => i.platformGlassId));
    const companyColorIds = uniqueDefined([
      ...items.map((i) => i.companyColorId),
      ...items.map((i) => i.companyGapColorId),
    ]);
    const platformColorIds = uniqueDefined([
      ...items.map((i) => i.platformColorId),
      ...items.map((i) => i.platformGapColorId),
    ]);

    const [companyGlasses, platformGlasses, companyColors, platformColors] =
      await Promise.all([
        companyGlassIds.length > 0
          ? manager.findBy(CompanyGlass, { id: In(companyGlassIds) })
          : Promise.resolve([]),
        platformGlassIds.length > 0
          ? this.platformGlasses.findBy({ id: In(platformGlassIds) })
          : Promise.resolve([]),
        companyColorIds.length > 0
          ? manager.findBy(CompanyColor, { id: In(companyColorIds) })
          : Promise.resolve([]),
        platformColorIds.length > 0
          ? this.platformColors.findBy({ id: In(platformColorIds) })
          : Promise.resolve([]),
      ]);
    const companyGlassById = new Map(companyGlasses.map((g) => [g.id, g]));
    const platformGlassById = new Map(platformGlasses.map((g) => [g.id, g]));
    const companyColorById = new Map(companyColors.map((c) => [c.id, c]));
    const platformColorById = new Map(platformColors.map((c) => [c.id, c]));

    return combos.map((combo) => {
      const sorted = (itemsByCombo.get(combo.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position);
      const summaryItems: CompanyGlassCombinationItemSummary[] = sorted.map(
        (item) => {
          if (item.kind === CombinationItemKind.SHEET) {
            const isPlatformGlass = !!item.platformGlassId;
            const glass = isPlatformGlass
              ? platformGlassById.get(item.platformGlassId!)
              : companyGlassById.get(item.companyGlassId!);
            const hasColor = !!item.platformColorId || !!item.companyColorId;
            const isPlatformColor = !!item.platformColorId;
            const color = !hasColor
              ? undefined
              : isPlatformColor
                ? platformColorById.get(item.platformColorId!)
                : companyColorById.get(item.companyColorId!);
            return {
              kind: CombinationItemKind.SHEET,
              position: item.position,
              glass: formatScopedRef(
                isPlatformGlass ? LookupScope.PLATFORM : LookupScope.COMPANY,
                (item.platformGlassId ?? item.companyGlassId)!,
              ),
              glassName: glass?.name ?? null,
              glassScope: isPlatformGlass
                ? LookupScope.PLATFORM
                : LookupScope.COMPANY,
              glassThickness: glass?.thickness ?? null,
              color: hasColor
                ? formatScopedRef(
                    isPlatformColor
                      ? LookupScope.PLATFORM
                      : LookupScope.COMPANY,
                    (item.platformColorId ?? item.companyColorId)!,
                  )
                : null,
              colorCode: color?.code ?? null,
              colorScope: hasColor
                ? isPlatformColor
                  ? LookupScope.PLATFORM
                  : LookupScope.COMPANY
                : null,
            };
          }

          const hasGapColor =
            !!item.platformGapColorId || !!item.companyGapColorId;
          const isPlatformGapColor = !!item.platformGapColorId;
          const gapColor = !hasGapColor
            ? undefined
            : isPlatformGapColor
              ? platformColorById.get(item.platformGapColorId!)
              : companyColorById.get(item.companyGapColorId!);
          return {
            kind: CombinationItemKind.GAP,
            position: item.position,
            gapType: item.gapType!,
            gapThickness: item.gapThickness!,
            gapColor: hasGapColor
              ? formatScopedRef(
                  isPlatformGapColor
                    ? LookupScope.PLATFORM
                    : LookupScope.COMPANY,
                  (item.platformGapColorId ?? item.companyGapColorId)!,
                )
              : null,
            colorCode: gapColor?.code ?? null,
            colorScope: hasGapColor
              ? isPlatformGapColor
                ? LookupScope.PLATFORM
                : LookupScope.COMPANY
              : null,
            isGeorgian: item.isGeorgian,
            columnsCount: item.columnsCount,
            rowsCount: item.rowsCount,
          };
        },
      );

      const rawTotal = summaryItems.reduce(
        (sum, item) =>
          sum +
          (item.kind === CombinationItemKind.SHEET
            ? (item.glassThickness ?? 0)
            : item.gapThickness),
        0,
      );

      return {
        id: combo.id,
        name: combo.name,
        totalThickness: Math.round(rawTotal * 100) / 100,
        items: summaryItems,
        scope: LookupScope.COMPANY,
        createdAt: combo.createdAt.toISOString(),
        updatedAt: combo.updatedAt.toISOString(),
      };
    });
  }
}

function uniqueDefined(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

// Mirrors GlassLookupsService's buildItemRows exactly, with each of the
// three references resolved to its platform/company pair.
function buildCompanyItemRows(
  combinationId: string,
  inputItems: CompanyGlassCombinationItemInput[],
): Partial<CompanyGlassCombinationItem>[] {
  return inputItems.map((item, position) => {
    if (item.kind === CombinationItemKind.SHEET) {
      const glassRef = resolveScopedRef(item.glass);
      const colorRef = item.color ? resolveScopedRef(item.color) : null;
      return {
        combinationId,
        position,
        kind: CombinationItemKind.SHEET,
        platformGlassId: glassRef.platformId,
        companyGlassId: glassRef.companyId,
        platformColorId: colorRef?.platformId ?? null,
        companyColorId: colorRef?.companyId ?? null,
        gapType: null,
        gapThickness: null,
        platformGapColorId: null,
        companyGapColorId: null,
        isGeorgian: null,
        columnsCount: null,
        rowsCount: null,
      };
    }
    const isSpacer = item.gapType === GlassGapType.SPACER;
    const gapColorRef = item.gapColor ? resolveScopedRef(item.gapColor) : null;
    return {
      combinationId,
      position,
      kind: CombinationItemKind.GAP,
      platformGlassId: null,
      companyGlassId: null,
      platformColorId: null,
      companyColorId: null,
      gapType: item.gapType,
      gapThickness: item.gapThickness,
      platformGapColorId: gapColorRef?.platformId ?? null,
      companyGapColorId: gapColorRef?.companyId ?? null,
      isGeorgian: isSpacer ? (item.isGeorgian ?? null) : null,
      columnsCount: isSpacer ? (item.columnsCount ?? null) : null,
      rowsCount: isSpacer ? (item.rowsCount ?? null) : null,
    };
  });
}

function toCompanyGlassSummary(glass: CompanyGlass): CompanyGlassSummary {
  return {
    id: glass.id,
    name: glass.name,
    thickness: glass.thickness,
    weightPerSqm: glass.weightPerSqm,
    pricePerSqm: glass.pricePerSqm,
    scope: LookupScope.COMPANY,
    createdAt: glass.createdAt.toISOString(),
    updatedAt: glass.updatedAt.toISOString(),
  };
}

function conflictOrThrow(error: unknown, message: string): never {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === '23505') throw new ConflictException(message);
  throw error as Error;
}
