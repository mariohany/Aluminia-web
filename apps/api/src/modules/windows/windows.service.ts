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
  type WindowSummary,
} from '@repo/types/windows';
import {
  LookupScope,
  formatScopedRef,
  type ScopedRef,
} from '@repo/types/company-lookups';
import { Project } from '../../database/tenant/entities/project.entity';
import { Window } from '../../database/tenant/entities/window.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { resolveScopedRef } from '../company-lookups/scoped-ref.util';
import { translatePostgresError } from '../lookups/pg-error.util';

/**
 * Windows — one manufacturing job's individual designs — inside one
 * manufacturer's schema. See docs/window_creation_planing.md.
 *
 * Same rules as ProjectsService: every body runs through
 * `tenantContext.run()`, nothing here knows a schema name, and no
 * repository is injected.
 */
@Injectable()
export class WindowsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  list(projectId: string): Promise<WindowSummary[]> {
    return this.tenantContext.run(async (manager) => {
      const windows = await manager.find(Window, {
        where: { projectId },
        order: { name: 'ASC' },
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

      const framePair = resolveScopedRef(input.frameProfile);
      const sashPair = resolveScopedRef(input.sashProfile);
      const glassPair = resolveScopedRef(input.glass);
      const interiorPair = resolveOptionalScopedRef(input.interiorColor);
      const exteriorPair = resolveOptionalScopedRef(input.exteriorColor);
      const isSingle = input.glassKind === GlassKind.SINGLE;

      const window = manager.create(Window, {
        projectId: input.projectId,
        name: input.name,
        framePlatformProfileId: framePair.platformId,
        frameCompanyProfileId: framePair.companyId,
        sashPlatformProfileId: sashPair.platformId,
        sashCompanyProfileId: sashPair.companyId,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        quantity: input.quantity,
        hasFlyScreen: input.hasFlyScreen,
        isDoor: input.isDoor,
        glassKind: input.glassKind,
        openingType: input.openingType ?? null,
        glassPlatformSingleId: isSingle ? glassPair.platformId : null,
        glassCompanySingleId: isSingle ? glassPair.companyId : null,
        glassPlatformCombinationId: isSingle ? null : glassPair.platformId,
        glassCompanyCombinationId: isSingle ? null : glassPair.companyId,
        interiorColorPlatformId: interiorPair.platformId,
        interiorColorCompanyId: interiorPair.companyId,
        exteriorColorPlatformId: exteriorPair.platformId,
        exteriorColorCompanyId: exteriorPair.companyId,
        location: input.location ?? null,
        notes: input.notes ?? null,
        createdByUserId,
      });

      try {
        await manager.save(window);
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

      if (input.frameProfile !== undefined) {
        const pair = resolveScopedRef(input.frameProfile);
        window.framePlatformProfileId = pair.platformId;
        window.frameCompanyProfileId = pair.companyId;
      }
      if (input.sashProfile !== undefined) {
        const pair = resolveScopedRef(input.sashProfile);
        window.sashPlatformProfileId = pair.platformId;
        window.sashCompanyProfileId = pair.companyId;
      }

      if (input.widthMm !== undefined) window.widthMm = input.widthMm;
      if (input.heightMm !== undefined) window.heightMm = input.heightMm;
      if (input.quantity !== undefined) window.quantity = input.quantity;
      if (input.hasFlyScreen !== undefined)
        window.hasFlyScreen = input.hasFlyScreen;
      if (input.isDoor !== undefined) window.isDoor = input.isDoor;
      if (input.openingType !== undefined)
        window.openingType = input.openingType;

      // glassKind and glass are one discriminated union at the storage
      // layer (CK_windows_glass_shape) — they must change together or
      // not at all. Accepting one without the other would leave no way
      // to know which pair the caller means the new value to populate.
      if (input.glassKind !== undefined || input.glass !== undefined) {
        if (input.glassKind === undefined || input.glass === undefined) {
          throw new BadRequestException(
            'glassKind and glass must be updated together.',
          );
        }
        const glassPair = resolveScopedRef(input.glass);
        const isSingle = input.glassKind === GlassKind.SINGLE;
        window.glassKind = input.glassKind;
        window.glassPlatformSingleId = isSingle ? glassPair.platformId : null;
        window.glassCompanySingleId = isSingle ? glassPair.companyId : null;
        window.glassPlatformCombinationId = isSingle
          ? null
          : glassPair.platformId;
        window.glassCompanyCombinationId = isSingle
          ? null
          : glassPair.companyId;
      }

      if (input.interiorColor !== undefined) {
        const pair = resolveOptionalScopedRef(input.interiorColor);
        window.interiorColorPlatformId = pair.platformId;
        window.interiorColorCompanyId = pair.companyId;
      }
      if (input.exteriorColor !== undefined) {
        const pair = resolveOptionalScopedRef(input.exteriorColor);
        window.exteriorColorPlatformId = pair.platformId;
        window.exteriorColorCompanyId = pair.companyId;
      }

      if (input.location !== undefined) window.location = input.location;
      if (input.notes !== undefined) window.notes = input.notes;

      try {
        await manager.save(window);
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
   * friction.
   */
  remove(id: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const window = await this.findOrFail(manager, id);
      await manager.remove(window);
    });
  }

  private async findOrFail(
    manager: EntityManager,
    id: string,
  ): Promise<Window> {
    const window = await manager.findOne(Window, { where: { id } });
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

// `undefined` (absent from the request) leaves both columns of the pair
// alone; `null` (explicitly cleared) or a real `ScopedRef` resolves to
// the platform/company pair — same nullable-pair shape `company-lookups`
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

function toSummary(window: Window): WindowSummary {
  return {
    id: window.id,
    name: window.name,
    widthMm: window.widthMm,
    heightMm: window.heightMm,
    quantity: window.quantity,
    frameProfile: toRequiredScopedRef(
      window.framePlatformProfileId,
      window.frameCompanyProfileId,
    ),
    glassKind: window.glassKind as WindowSummary['glassKind'],
    glass: toGlassRef(window),
    hasFlyScreen: window.hasFlyScreen,
    isDoor: window.isDoor,
  };
}

function toGlassRef(window: Window): ScopedRef {
  const isSingle = window.glassKind === GlassKind.SINGLE;
  return toRequiredScopedRef(
    isSingle ? window.glassPlatformSingleId : window.glassPlatformCombinationId,
    isSingle ? window.glassCompanySingleId : window.glassCompanyCombinationId,
  );
}

function toDetail(window: Window): WindowDetail {
  return {
    id: window.id,
    projectId: window.projectId,
    name: window.name,
    widthMm: window.widthMm,
    heightMm: window.heightMm,
    quantity: window.quantity,
    frameProfile: toRequiredScopedRef(
      window.framePlatformProfileId,
      window.frameCompanyProfileId,
    ),
    sashProfile: toRequiredScopedRef(
      window.sashPlatformProfileId,
      window.sashCompanyProfileId,
    ),
    hasFlyScreen: window.hasFlyScreen,
    isDoor: window.isDoor,
    glassKind: window.glassKind as WindowDetail['glassKind'],
    glass: toGlassRef(window),
    openingType: window.openingType as WindowDetail['openingType'],
    interiorColor: toOptionalScopedRef(
      window.interiorColorPlatformId,
      window.interiorColorCompanyId,
    ),
    exteriorColor: toOptionalScopedRef(
      window.exteriorColorPlatformId,
      window.exteriorColorCompanyId,
    ),
    location: window.location,
    notes: window.notes,
    createdByUserId: window.createdByUserId,
    createdAt: window.createdAt.toISOString(),
    updatedAt: window.updatedAt.toISOString(),
  };
}
