import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  CombinationItemKind,
  createGlassCombinationSchema,
  LookupEntity,
  type BulkDeleteResult,
  type CreateGlassCombinationInput,
  type CreateGlassInput,
  GlassGapType,
  type GlassCombinationItemInput,
  type GlassCombinationItemSummary,
  type GlassCombinationSummary,
  type GlassLookups,
  type GlassSummary,
  type LooseGlassCombinationInput,
  type UpdateGlassCombinationInput,
  type UpdateGlassInput,
} from '@repo/types/lookups';
import { Glass } from '../../database/control-plane/entities/glass.entity';
import { GlassCombination } from '../../database/control-plane/entities/glass-combination.entity';
import { GlassCombinationItem } from '../../database/control-plane/entities/glass-combination-item.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { translatePostgresError } from './pg-error.util';
import {
  findBlockedIds,
  runWithSingleVersionBump,
} from './lookup-version.util';

const COMBINATION_ITEM_RELATIONS = {
  glass: true,
  color: true,
  gapColor: true,
} as const;

@Injectable()
export class GlassLookupsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Glass) private readonly glasses: Repository<Glass>,
    @InjectRepository(GlassCombination)
    private readonly combinations: Repository<GlassCombination>,
    @InjectRepository(GlassCombinationItem)
    private readonly items: Repository<GlassCombinationItem>,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---- Glass ----
  // Same accepted-risk tradeoff as ColorLookupsService — see its header
  // comment. Combinations below are the exception, since their item list
  // genuinely needs multi-statement atomicity.

  listGlass(): Promise<GlassSummary[]> {
    return this.glasses
      .find({ order: { name: 'ASC' } })
      .then((rows) => rows.map(toGlassSummary));
  }

  async createGlass(
    input: CreateGlassInput,
    actorId: string,
  ): Promise<GlassSummary> {
    const glass = await this.glasses.save(this.glasses.create(input));
    await this.auditLog.record(this.glasses.manager, {
      actorUserId: actorId,
      action: 'lookup.glass.created',
      targetType: 'glass',
      targetId: glass.id,
      metadata: { name: glass.name },
    });
    return toGlassSummary(glass);
  }

  async updateGlass(
    id: string,
    input: UpdateGlassInput,
    actorId: string,
  ): Promise<GlassSummary> {
    const glass = await this.glasses.findOneBy({ id });
    if (!glass) throw new NotFoundException('Glass not found.');
    Object.assign(glass, input);
    await this.glasses.save(glass);
    await this.auditLog.record(this.glasses.manager, {
      actorUserId: actorId,
      action: 'lookup.glass.updated',
      targetType: 'glass',
      targetId: glass.id,
      metadata: { name: glass.name },
    });
    return toGlassSummary(glass);
  }

  async deleteGlass(id: string, actorId: string): Promise<void> {
    const glass = await this.glasses.findOneBy({ id });
    if (!glass) throw new NotFoundException('Glass not found.');
    try {
      await this.glasses.delete({ id });
    } catch (error) {
      translatePostgresError(
        error,
        'This glass is still used by a glass combination and cannot be deleted.',
      );
    }
    await this.auditLog.record(this.glasses.manager, {
      actorUserId: actorId,
      action: 'lookup.glass.deleted',
      targetType: 'glass',
      targetId: id,
      metadata: { name: glass.name },
    });
  }

  // Bulk delete/duplicate — see ColorLookupsService's bulkDeleteColors
  // for why a single-table op like this needs no trigger-disable dance.
  async bulkDeleteGlass(
    ids: string[],
    actorId: string,
  ): Promise<BulkDeleteResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const blockedIds = await findBlockedIds(queryRunner, ids, [
        { table: 'glass_combination_item', column: 'glass_id' },
      ]);
      const deletableIds = ids.filter((id) => !blockedIds.has(id));

      if (deletableIds.length > 0) {
        await queryRunner.manager.delete(Glass, deletableIds);
        await this.auditLog.record(queryRunner.manager, {
          actorUserId: actorId,
          action: 'lookup.glass.bulk_deleted',
          targetType: 'glass',
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

  async bulkDuplicateGlass(
    items: CreateGlassInput[],
    actorId: string,
  ): Promise<GlassSummary[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(Glass)
        .values(items)
        .execute();
      const newIds = insertResult.identifiers.map((i) => i.id as string);
      const created = await queryRunner.manager.findBy(Glass, {
        id: In(newIds),
      });

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.glass.bulk_duplicated',
        targetType: 'glass',
        metadata: { count: created.length },
      });

      await queryRunner.commitTransaction();
      return created.map(toGlassSummary);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ---- GlassCombination ----
  // Written whole: the editor assembles the full ordered item list
  // client-side and saves it in one request, so create/update replace
  // the item table's rows inside a transaction rather than diffing.

  async listGlassCombinations(): Promise<GlassCombinationSummary[]> {
    const combos = await this.combinations.find({ order: { name: 'ASC' } });
    if (combos.length === 0) return [];

    const items = await this.items.find({
      where: { combinationId: In(combos.map((c) => c.id)) },
      relations: COMBINATION_ITEM_RELATIONS,
      order: { position: 'ASC' },
    });
    const itemsByCombo = new Map<string, GlassCombinationItem[]>();
    for (const item of items) {
      const list = itemsByCombo.get(item.combinationId) ?? [];
      list.push(item);
      itemsByCombo.set(item.combinationId, list);
    }
    return combos.map((combo) =>
      toGlassCombinationSummary(combo, itemsByCombo.get(combo.id) ?? []),
    );
  }

  async createGlassCombination(
    input: CreateGlassCombinationInput,
    actorId: string,
  ): Promise<GlassCombinationSummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const combo = queryRunner.manager.create(GlassCombination, {
        name: input.name,
      });
      await queryRunner.manager.save(combo);
      await queryRunner.manager.insert(
        GlassCombinationItem,
        buildItemRows(combo.id, input.items),
      );

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.glass_combination.created',
        targetType: 'glass_combination',
        targetId: combo.id,
        metadata: { name: combo.name, itemCount: input.items.length },
      });

      const items = await queryRunner.manager.find(GlassCombinationItem, {
        where: { combinationId: combo.id },
        relations: COMBINATION_ITEM_RELATIONS,
        order: { position: 'ASC' },
      });

      await queryRunner.commitTransaction();
      return toGlassCombinationSummary(combo, items);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return translatePostgresError(
        error,
        'One of the glass or colour references in this combination does not exist.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  async updateGlassCombination(
    id: string,
    input: UpdateGlassCombinationInput,
    actorId: string,
  ): Promise<GlassCombinationSummary> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const combo = await queryRunner.manager.findOneBy(GlassCombination, {
        id,
      });
      if (!combo) throw new NotFoundException('Glass combination not found.');

      if (input.name !== undefined) combo.name = input.name;
      await queryRunner.manager.save(combo);

      if (input.items !== undefined) {
        await queryRunner.manager.delete(GlassCombinationItem, {
          combinationId: id,
        });
        await queryRunner.manager.insert(
          GlassCombinationItem,
          buildItemRows(id, input.items),
        );
      }

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.glass_combination.updated',
        targetType: 'glass_combination',
        targetId: combo.id,
        metadata: { name: combo.name },
      });

      const items = await queryRunner.manager.find(GlassCombinationItem, {
        where: { combinationId: id },
        relations: COMBINATION_ITEM_RELATIONS,
        order: { position: 'ASC' },
      });

      await queryRunner.commitTransaction();
      return toGlassCombinationSummary(combo, items);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return translatePostgresError(
        error,
        'One of the glass or colour references in this combination does not exist.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  async deleteGlassCombination(id: string, actorId: string): Promise<void> {
    const combo = await this.combinations.findOneBy({ id });
    if (!combo) throw new NotFoundException('Glass combination not found.');
    // Items cascade automatically (combination_id is ON DELETE CASCADE) —
    // nothing else in this data warehouse references a combination.
    await this.combinations.delete({ id });
    await this.auditLog.record(this.combinations.manager, {
      actorUserId: actorId,
      action: 'lookup.glass_combination.deleted',
      targetType: 'glass_combination',
      targetId: id,
      metadata: { name: combo.name },
    });
  }

  // Bulk delete/duplicate. Unlike every other bulk* method in this
  // file, these two DO need runWithSingleVersionBump: a combination's
  // cascade into glass_combination_item (delete) or its own explicit
  // item insert (duplicate) touches a second table whose trigger also
  // maps to the glass_combination entity — two statement-level firings
  // for what should read as one version step.
  async bulkDeleteGlassCombinations(
    ids: string[],
    actorId: string,
  ): Promise<BulkDeleteResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await runWithSingleVersionBump(
        queryRunner,
        ['glass_combination', 'glass_combination_item'],
        LookupEntity.GLASS_COMBINATION,
        async () => {
          const result = await queryRunner.manager.delete(
            GlassCombination,
            ids,
          );
          return (result.affected ?? 0) > 0;
        },
      );

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.glass_combination.bulk_deleted',
        targetType: 'glass_combination',
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

  // Request body is validated loosely (BulkDuplicateGlassCombinationsDto,
  // just "name + a non-empty items array") rather than against the full
  // createGlassCombinationSchema — that full validation (min 3 items,
  // sheet/gap alternation, bounded by sheet) runs per-item right here
  // instead, via safeParse. A pre-existing combination that predates
  // this rule (or was otherwise left in an invalid shape) fails on its
  // own and gets skipped and counted in failedCount, rather than 400ing
  // the whole batch and blocking every valid combination alongside it.
  async bulkDuplicateGlassCombinations(
    items: LooseGlassCombinationInput[],
    actorId: string,
  ): Promise<{ created: GlassCombinationSummary[]; failedCount: number }> {
    const validItems: CreateGlassCombinationInput[] = [];
    let failedCount = 0;
    for (const item of items) {
      const result = createGlassCombinationSchema.safeParse(item);
      if (result.success) validItems.push(result.data);
      else failedCount += 1;
    }

    if (validItems.length === 0) {
      return { created: [], failedCount };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      let newIds: string[] = [];
      await runWithSingleVersionBump(
        queryRunner,
        ['glass_combination', 'glass_combination_item'],
        LookupEntity.GLASS_COMBINATION,
        async () => {
          const insertResult = await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(GlassCombination)
            .values(validItems.map((item) => ({ name: item.name })))
            .execute();
          newIds = insertResult.identifiers.map((row) => row.id as string);

          const allItemRows = newIds.flatMap((comboId, index) =>
            buildItemRows(comboId, validItems[index].items),
          );
          await queryRunner.manager.insert(GlassCombinationItem, allItemRows);
          return newIds.length > 0;
        },
      );

      await this.auditLog.record(queryRunner.manager, {
        actorUserId: actorId,
        action: 'lookup.glass_combination.bulk_duplicated',
        targetType: 'glass_combination',
        metadata: { count: newIds.length, failedCount },
      });

      const newCombos = await queryRunner.manager.findBy(GlassCombination, {
        id: In(newIds),
      });
      const newItems = await queryRunner.manager.find(GlassCombinationItem, {
        where: { combinationId: In(newIds) },
        relations: COMBINATION_ITEM_RELATIONS,
        order: { position: 'ASC' },
      });
      const itemsByCombo = new Map<string, GlassCombinationItem[]>();
      for (const item of newItems) {
        const list = itemsByCombo.get(item.combinationId) ?? [];
        list.push(item);
        itemsByCombo.set(item.combinationId, list);
      }

      await queryRunner.commitTransaction();
      return {
        created: newCombos.map((combo) =>
          toGlassCombinationSummary(combo, itemsByCombo.get(combo.id) ?? []),
        ),
        failedCount,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      return translatePostgresError(
        error,
        'One of the glass or colour references in this combination does not exist.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  // ---- Tenant read slice ----

  async assembleSlice(): Promise<GlassLookups> {
    const [glass, combinations] = await Promise.all([
      this.glasses.find({ order: { name: 'ASC' } }),
      this.listGlassCombinations(),
    ]);
    return { glass: glass.map(toGlassSummary), combinations };
  }
}

// Georgian fields only apply to a 'spacer' gap (astragal bars can't sit
// inside a bonded laminate interlayer) — zeroed here defensively even
// though the migration's CHECK constraint is the actual enforcement.
function buildItemRows(
  combinationId: string,
  inputItems: GlassCombinationItemInput[],
): Partial<GlassCombinationItem>[] {
  return inputItems.map((item, position) => {
    if (item.kind === CombinationItemKind.SHEET) {
      return {
        combinationId,
        position,
        kind: CombinationItemKind.SHEET,
        glassId: item.glassId,
        colorId: item.colorId ?? null,
        gapType: null,
        gapThickness: null,
        gapColorId: null,
        isGeorgian: null,
        columnsCount: null,
        rowsCount: null,
      };
    }
    const isSpacer = item.gapType === GlassGapType.SPACER;
    return {
      combinationId,
      position,
      kind: CombinationItemKind.GAP,
      glassId: null,
      colorId: null,
      gapType: item.gapType,
      gapThickness: item.gapThickness,
      gapColorId: item.gapColorId ?? null,
      isGeorgian: isSpacer ? (item.isGeorgian ?? null) : null,
      columnsCount: isSpacer ? (item.columnsCount ?? null) : null,
      rowsCount: isSpacer ? (item.rowsCount ?? null) : null,
    };
  });
}

function toGlassSummary(glass: Glass): GlassSummary {
  return {
    id: glass.id,
    name: glass.name,
    thickness: glass.thickness,
    weightPerSqm: glass.weightPerSqm,
    pricePerSqm: glass.pricePerSqm,
    createdAt: glass.createdAt.toISOString(),
    updatedAt: glass.updatedAt.toISOString(),
  };
}

function toGlassCombinationSummary(
  combo: GlassCombination,
  items: GlassCombinationItem[],
): GlassCombinationSummary {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const summaryItems: GlassCombinationItemSummary[] = sorted.map((item) =>
    item.kind === CombinationItemKind.SHEET
      ? {
          kind: CombinationItemKind.SHEET,
          position: item.position,
          glassId: item.glassId!,
          glassName: item.glass!.name,
          glassThickness: item.glass!.thickness,
          colorId: item.colorId,
          colorCode: item.color?.code ?? null,
        }
      : {
          kind: CombinationItemKind.GAP,
          position: item.position,
          gapType: item.gapType!,
          gapThickness: item.gapThickness!,
          gapColorId: item.gapColorId,
          colorCode: item.gapColor?.code ?? null,
          isGeorgian: item.isGeorgian,
          columnsCount: item.columnsCount,
          rowsCount: item.rowsCount,
        },
  );

  // Derived, never stored (see the entity's comment) — the sum of what
  // the items actually are, so it can never drift from its own parts.
  // Rounded to 2dp (gap_thickness's own numeric(5,2) scale) because
  // summing floats otherwise leaves visible artifacts like 8.379999999999999
  // for 4 + 0.38 + 4.
  const rawTotalThickness = summaryItems.reduce(
    (sum, item) =>
      sum +
      (item.kind === CombinationItemKind.SHEET
        ? item.glassThickness
        : item.gapThickness),
    0,
  );
  const totalThickness = Math.round(rawTotalThickness * 100) / 100;

  return {
    id: combo.id,
    name: combo.name,
    totalThickness,
    items: summaryItems,
    createdAt: combo.createdAt.toISOString(),
    updatedAt: combo.updatedAt.toISOString(),
  };
}
