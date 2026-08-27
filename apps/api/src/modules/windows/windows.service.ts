import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  GlassKind,
  type CreateWindowInput,
  type UpdateWindowInput,
  type WindowDetail,
  type WindowPanelInput,
  type WindowPanelDetail,
  type WindowSummary,
} from '@repo/types/windows';
import {
  LookupScope,
  formatScopedRef,
  type ScopedRef,
} from '@repo/types/company-lookups';
import { Project } from '../../database/tenant/entities/project.entity';
import { Window } from '../../database/tenant/entities/window.entity';
import { WindowPanel } from '../../database/tenant/entities/window-panel.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { resolveScopedRef } from '../company-lookups/scoped-ref.util';
import { translatePostgresError } from '../lookups/pg-error.util';

/**
 * Window assemblies — one manufacturing job's individual designs —
 * inside one manufacturer's schema. See
 * docs/window_assembly_planing.md.
 *
 * Same rules as ProjectsService: every body runs through
 * `tenantContext.run()`, nothing here knows a schema name, and no
 * repository is injected. All of a request's tenant work happens inside
 * ONE `run()` call — nested calls open independent transactions that
 * cannot see each other's writes, which matters here because replacing
 * a panel set is a delete followed by an insert.
 */
@Injectable()
export class WindowsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  list(projectId: string): Promise<WindowSummary[]> {
    return this.tenantContext.run(async (manager) => {
      const windows = await manager.find(Window, {
        where: { projectId },
        relations: { panels: true },
        order: { name: 'ASC', panels: { position: 'ASC' } },
      });
      return windows.map(toSummary);
    });
  }

  detail(id: string): Promise<WindowDetail> {
    return this.tenantContext.run(async (manager) =>
      toDetail(await this.findOrFail(manager, id)),
    );
  }

  create(
    input: CreateWindowInput,
    createdByUserId: string,
  ): Promise<WindowDetail> {
    return this.tenantContext.run(async (manager) => {
      // Checked inside the SAME run() as the insert, so it shares one
      // transaction with it — same reasoning as ProjectsService.create's
      // client check. The FK would reject a bad id anyway; this turns a
      // raw constraint violation into a 400 that names the problem.
      const projectExists = await manager.exists(Project, {
        where: { id: input.projectId },
      });
      if (!projectExists) {
        throw new BadRequestException('That project does not exist.');
      }

      const panels = prepareAssembly(input.panels);
      const outer = boundingSize(panels);

      const window = manager.create(Window, {
        projectId: input.projectId,
        name: input.name,
        widthMm: outer.widthMm,
        heightMm: outer.heightMm,
        quantity: input.quantity,
        location: input.location ?? null,
        notes: input.notes ?? null,
        createdByUserId,
      });

      try {
        await manager.save(window);
        window.panels = await this.writePanels(manager, window.id, panels);
      } catch (error) {
        this.translateWriteError(error);
      }

      return toDetail(window);
    });
  }

  update(id: string, input: UpdateWindowInput): Promise<WindowDetail> {
    return this.tenantContext.run(async (manager) => {
      const window = await this.findOrFail(manager, id);

      if (input.name !== undefined) window.name = input.name;
      if (input.quantity !== undefined) window.quantity = input.quantity;
      if (input.location !== undefined) window.location = input.location;
      if (input.notes !== undefined) window.notes = input.notes;

      // `panels` REPLACES the whole set rather than merging — the dialog
      // always submits the complete design, and a partial merge would
      // only add a way for the two sides to disagree about which panels
      // still exist. The overall size is re-derived from whatever came
      // in; it is never taken from the request (see createWindowSchema).
      const replacement =
        input.panels !== undefined ? prepareAssembly(input.panels) : null;
      if (replacement) {
        const outer = boundingSize(replacement);
        window.widthMm = outer.widthMm;
        window.heightMm = outer.heightMm;
      }

      try {
        await manager.save(window);
        if (replacement) {
          await manager.delete(WindowPanel, { windowId: window.id });
          window.panels = await this.writePanels(
            manager,
            window.id,
            replacement,
          );
        }
      } catch (error) {
        this.translateWriteError(error);
      }

      return toDetail(window);
    });
  }

  /**
   * No typed confirmation server-side — same posture as
   * ProjectsService.remove: this destroys one window, not a cascade
   * through an unknown number of them. The dialog in the UI is the
   * friction. Panels go with it via FK_window_panels_window's CASCADE.
   */
  remove(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const window = await this.findOrFail(manager, id);
      await manager.remove(window);
    });
  }

  private async writePanels(
    manager: EntityManager,
    windowId: string,
    panels: WindowPanelInput[],
  ): Promise<WindowPanel[]> {
    const rows = panels.map((panel, position) =>
      manager.create(WindowPanel, {
        ...toPanelColumns(panel),
        windowId,
        position,
      }),
    );
    return manager.save(rows);
  }

  private async findOrFail(
    manager: EntityManager,
    id: string,
  ): Promise<Window> {
    const window = await manager.findOne(Window, {
      where: { id },
      relations: { panels: true },
      order: { panels: { position: 'ASC' } },
    });
    // 404 rather than 403 for another tenant's id — same reasoning as
    // ProjectsService.findOrFail: the search_path makes their rows
    // invisible here, so there's nothing to distinguish "someone else's"
    // from "does not exist", which is the correct answer either way.
    if (!window) throw new NotFoundException('Window not found.');
    return window;
  }

  private translateWriteError(error: unknown): never {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === '23505') {
      throw new ConflictException(
        'You already have a window called that in this project.',
      );
    }
    translatePostgresError(
      error,
      'That frame, sash, glass, or colour reference does not exist.',
    );
  }
}

// ---- Assembly geometry ----------------------------------------------
//
// The invariants in docs/window_assembly_planing.md §1. Overlap and
// connectivity are relationships BETWEEN rows, which a row-scoped CHECK
// constraint cannot see, so they are enforced here rather than in the
// migration. Origin normalisation is applied rather than rejected: the
// client already has the same helper, and shifting is idempotent, so an
// assembly ends up with exactly one stored representation either way.
//
// Deliberately NOT enforced: that the panels tile their bounding box. A
// stepped, L-shaped assembly is a real fabricated shape — the UI flags
// it amber, the API accepts it.

/** Normalises the origin, then enforces overlap and connectivity. */
function prepareAssembly(panels: WindowPanelInput[]): WindowPanelInput[] {
  const normalized = normalizeOrigin(panels);
  assertNoOverlap(normalized);
  assertConnected(normalized);
  return normalized;
}

function normalizeOrigin(panels: WindowPanelInput[]): WindowPanelInput[] {
  const minX = Math.min(...panels.map((p) => p.xMm));
  const minY = Math.min(...panels.map((p) => p.yMm));
  if (minX === 0 && minY === 0) return panels;
  return panels.map((p) => ({ ...p, xMm: p.xMm - minX, yMm: p.yMm - minY }));
}

function boundingSize(panels: WindowPanelInput[]): {
  widthMm: number;
  heightMm: number;
} {
  return {
    widthMm: Math.max(...panels.map((p) => p.xMm + p.widthMm)),
    heightMm: Math.max(...panels.map((p) => p.yMm + p.heightMm)),
  };
}

/** Length of the overlap between two 1-D spans; 0 or less means none. */
function spanOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function assertNoOverlap(panels: WindowPanelInput[]): void {
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i];
      const b = panels[j];
      const x = spanOverlap(a.xMm, a.xMm + a.widthMm, b.xMm, b.xMm + b.widthMm);
      const y = spanOverlap(
        a.yMm,
        a.yMm + a.heightMm,
        b.yMm,
        b.yMm + b.heightMm,
      );
      if (x > 0 && y > 0) {
        throw new BadRequestException(
          `Panels ${i + 1} and ${j + 1} overlap. Panels may share an edge but not an area.`,
        );
      }
    }
  }
}

/**
 * Two panels are coupled when they share an edge SEGMENT of non-zero
 * length. Corner contact is deliberately not adjacency — two units
 * meeting at a point are not joined in any physical sense.
 */
function edgesTouch(a: WindowPanelInput, b: WindowPanelInput): boolean {
  const verticallyAligned =
    spanOverlap(a.yMm, a.yMm + a.heightMm, b.yMm, b.yMm + b.heightMm) > 0;
  const horizontallyAligned =
    spanOverlap(a.xMm, a.xMm + a.widthMm, b.xMm, b.xMm + b.widthMm) > 0;
  const sideBySide = a.xMm + a.widthMm === b.xMm || b.xMm + b.widthMm === a.xMm;
  const stacked = a.yMm + a.heightMm === b.yMm || b.yMm + b.heightMm === a.yMm;
  return (sideBySide && verticallyAligned) || (stacked && horizontallyAligned);
}

function assertConnected(panels: WindowPanelInput[]): void {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (let i = 0; i < panels.length; i++) {
      if (seen.has(i)) continue;
      if (!edgesTouch(panels[current], panels[i])) continue;
      seen.add(i);
      queue.push(i);
    }
  }
  if (seen.size !== panels.length) {
    const orphan = panels.findIndex((_, i) => !seen.has(i));
    throw new BadRequestException(
      `Panel ${orphan + 1} is not attached to the rest of the assembly. Every panel must share an edge with another.`,
    );
  }
}

// ---- Column mapping --------------------------------------------------

function toPanelColumns(
  panel: WindowPanelInput,
): Omit<WindowPanel, 'id' | 'window' | 'windowId' | 'position'> {
  const framePair = resolveScopedRef(panel.frameProfile);
  const sashPair = resolveScopedRef(panel.sashProfile);
  const glassPair = resolveScopedRef(panel.glass);
  const interiorPair = resolveOptionalScopedRef(panel.interiorColor);
  const exteriorPair = resolveOptionalScopedRef(panel.exteriorColor);
  const isSingle = panel.glassKind === GlassKind.SINGLE;

  return {
    xMm: panel.xMm,
    yMm: panel.yMm,
    widthMm: panel.widthMm,
    heightMm: panel.heightMm,
    framePlatformProfileId: framePair.platformId,
    frameCompanyProfileId: framePair.companyId,
    sashPlatformProfileId: sashPair.platformId,
    sashCompanyProfileId: sashPair.companyId,
    hasFlyScreen: panel.hasFlyScreen,
    isDoor: panel.isDoor,
    glassKind: panel.glassKind,
    glassPlatformSingleId: isSingle ? glassPair.platformId : null,
    glassCompanySingleId: isSingle ? glassPair.companyId : null,
    glassPlatformCombinationId: isSingle ? null : glassPair.platformId,
    glassCompanyCombinationId: isSingle ? null : glassPair.companyId,
    openingType: panel.openingType ?? null,
    interiorColorPlatformId: interiorPair.platformId,
    interiorColorCompanyId: interiorPair.companyId,
    exteriorColorPlatformId: exteriorPair.platformId,
    exteriorColorCompanyId: exteriorPair.companyId,
  };
}

// `undefined` (absent from the request) and `null` (explicitly cleared)
// both resolve to an empty pair; a real `ScopedRef` resolves to the
// platform/company pair — same nullable-pair shape `company-lookups`
// already uses. Only interior/exterior colour ever need this nullable
// form; frame/sash/glass are always-required refs and call
// `resolveScopedRef` directly.
function resolveOptionalScopedRef(ref: ScopedRef | null | undefined): {
  platformId: string | null;
  companyId: string | null;
} {
  if (!ref) return { platformId: null, companyId: null };
  return resolveScopedRef(ref);
}

// The DB's CHECK constraints guarantee exactly one side of each pair is
// set (or, for the two optional colours, at most one) — these throw only
// if that invariant were somehow violated, which would mean the CHECK
// itself failed to do its job.
function toRequiredScopedRef(
  platformId: string | null,
  companyId: string | null,
): ScopedRef {
  if (platformId) return formatScopedRef(LookupScope.PLATFORM, platformId);
  if (companyId) return formatScopedRef(LookupScope.COMPANY, companyId);
  throw new Error(
    'Expected exactly one of a required reference pair to be set.',
  );
}

function toOptionalScopedRef(
  platformId: string | null,
  companyId: string | null,
): ScopedRef | null {
  if (platformId) return formatScopedRef(LookupScope.PLATFORM, platformId);
  if (companyId) return formatScopedRef(LookupScope.COMPANY, companyId);
  return null;
}

/**
 * Panels in stored order. A window with none is impossible through this
 * service (the schema demands at least one, and both write paths go
 * through `prepareAssembly`), so an empty set means the row was written
 * by something else — worth failing loudly rather than rendering a
 * window with no build.
 */
function orderedPanels(window: Window): WindowPanel[] {
  const panels = window.panels ?? [];
  if (panels.length === 0) {
    throw new Error(`Window ${window.id} has no panels.`);
  }
  return [...panels].sort((a, b) => a.position - b.position);
}

function toSummary(window: Window): WindowSummary {
  const panels = orderedPanels(window);
  // The card's frame/glass are the FIRST panel's, not the assembly's —
  // an assembly has no single frame. The card draws the whole thing, so
  // the full panel set goes out with the summary: these rows are already
  // loaded (resolving `first` needs them anyway), and the alternative is
  // one detail request per card.
  const first = panels[0];
  return {
    id: window.id,
    name: window.name,
    widthMm: window.widthMm,
    heightMm: window.heightMm,
    quantity: window.quantity,
    panels: panels.map(toPanelDetail),
    frameProfile: toRequiredScopedRef(
      first.framePlatformProfileId,
      first.frameCompanyProfileId,
    ),
    glassKind: first.glassKind as WindowSummary['glassKind'],
    glass: toGlassRef(first),
    hasFlyScreen: first.hasFlyScreen,
    isDoor: first.isDoor,
  };
}

function toGlassRef(panel: WindowPanel): ScopedRef {
  const isSingle = panel.glassKind === GlassKind.SINGLE;
  return toRequiredScopedRef(
    isSingle ? panel.glassPlatformSingleId : panel.glassPlatformCombinationId,
    isSingle ? panel.glassCompanySingleId : panel.glassCompanyCombinationId,
  );
}

function toPanelDetail(panel: WindowPanel): WindowPanelDetail {
  return {
    xMm: panel.xMm,
    yMm: panel.yMm,
    widthMm: panel.widthMm,
    heightMm: panel.heightMm,
    frameProfile: toRequiredScopedRef(
      panel.framePlatformProfileId,
      panel.frameCompanyProfileId,
    ),
    sashProfile: toRequiredScopedRef(
      panel.sashPlatformProfileId,
      panel.sashCompanyProfileId,
    ),
    hasFlyScreen: panel.hasFlyScreen,
    isDoor: panel.isDoor,
    glassKind: panel.glassKind as WindowPanelDetail['glassKind'],
    glass: toGlassRef(panel),
    openingType: panel.openingType as WindowPanelDetail['openingType'],
    interiorColor: toOptionalScopedRef(
      panel.interiorColorPlatformId,
      panel.interiorColorCompanyId,
    ),
    exteriorColor: toOptionalScopedRef(
      panel.exteriorColorPlatformId,
      panel.exteriorColorCompanyId,
    ),
  };
}

function toDetail(window: Window): WindowDetail {
  return {
    ...toSummary(window),
    projectId: window.projectId,
    location: window.location,
    notes: window.notes,
    createdByUserId: window.createdByUserId,
    createdAt: window.createdAt.toISOString(),
    updatedAt: window.updatedAt.toISOString(),
  };
}
