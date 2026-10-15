import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import {
  DEFAULT_CUTTING_SETTINGS,
  ReportKind,
  stockLengthsOf,
  type CuttingSettings,
  type CuttingSettingsInput,
  type ReportLanguage,
  type ReportProgressGroup,
  type ReportStatus,
} from '@repo/types/reports';
import { SystemCatalog } from '../../database/control-plane/entities/system-catalog.entity';
import { SystemProfile } from '../../database/control-plane/entities/system-profile.entity';
import { CuttingSettingsRow } from '../../database/tenant/entities/cutting-settings.entity';
import { ReportCache } from '../../database/tenant/entities/report-cache.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  buildProjectPieces,
  changedWindowCount,
  fingerprintOf,
  loadReportInputs,
  windowStampsOf,
  type ReportInputs,
} from './report-inputs';
import {
  JOB_ORPHANED_AFTER_MS,
  ReportJobService,
  initialProgress,
  type ReportJob,
} from './report-job.service';

// docs/reports_planing.md §7. Every request does its tenant work in ONE
// `tenantContext.run()`; platform catalogue reads (control plane) are
// mixed in freely, as in CompanySystemLookupsService.

const KIND = ReportKind.BAR_OPTIMISER;

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(SystemProfile)
    private readonly platformProfiles: Repository<SystemProfile>,
    @InjectRepository(SystemCatalog)
    private readonly platformCatalogs: Repository<SystemCatalog>,
    private readonly jobs: ReportJobService,
  ) {}

  getSettings(): Promise<CuttingSettings> {
    return this.tenantContext.run(async (manager) =>
      toSettings(
        await manager.findOne(CuttingSettingsRow, { where: { id: 1 } }),
      ),
    );
  }

  /** Saving moves `updated_at`, which every report's fingerprint reads:
   * every project's report turns stale (D14). */
  saveSettings(input: CuttingSettingsInput): Promise<CuttingSettings> {
    return this.tenantContext.run(async (manager) => {
      const row =
        (await manager.findOne(CuttingSettingsRow, { where: { id: 1 } })) ??
        manager.create(CuttingSettingsRow, { id: 1 });
      row.kerfMm = input.kerfMm;
      row.endTrimMm = input.endTrimMm;
      row.extraLengthsMm = [...input.extraLengthsMm].sort((a, b) => b - a);
      row.updatedAt = new Date();
      return toSettings(await manager.save(row));
    });
  }

  status(projectId: string, language: ReportLanguage): Promise<ReportStatus> {
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const row = await findRow(manager, projectId, language);
      return this.toStatus(manager, inputs, row, language);
    });
  }

  /** Starts a background run (D22) and returns at once with its status.
   * One job per project + language: while one runs (and is alive), this
   * just reports it. The row is locked so two clicks can't both start. */
  async generate(
    projectId: string,
    language: ReportLanguage,
    userId: string,
  ): Promise<ReportStatus> {
    const { schemaName, companyName } = this.tenantContext.tenant;
    let job: ReportJob | null = null;

    const status = await this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      await manager
        .createQueryBuilder()
        .insert()
        .into(ReportCache)
        .values({ projectId, reportKind: KIND, language })
        .orIgnore()
        .execute();
      const row = await manager
        .createQueryBuilder(ReportCache, 'r')
        .setLock('pessimistic_write')
        .where(
          'r.project_id = :projectId AND r.report_kind = :kind AND r.language = :language',
          { projectId, kind: KIND, language },
        )
        .getOneOrFail();

      if (isAlive(row)) return this.toStatus(manager, inputs, row, language);

      const pieces = buildProjectPieces(inputs);
      const fingerprint = fingerprintOf(inputs, language);
      const startedAt = new Date();
      row.jobState = 'running';
      row.jobFingerprint = fingerprint;
      row.jobProgress = { groups: initialProgress(pieces) };
      row.jobStartedAt = startedAt;
      row.jobStartedByUserId = userId;
      row.jobError = null;
      await manager.save(row);

      job = {
        schemaName,
        cacheId: row.id,
        startedAt,
        userId,
        language,
        companyName,
        fingerprint,
        windowStamps: windowStampsOf(inputs),
        inputs,
        pieces,
      };
      return this.toStatus(manager, inputs, row, language);
    });

    // After the commit, so the job's first write finds its row reserved.
    if (job) this.jobs.start(job);
    return status;
  }

  pdf(
    projectId: string,
    language: ReportLanguage,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    return this.tenantContext.run(async (manager) => {
      const inputs = await this.inputs(manager, projectId);
      const row = await manager
        .createQueryBuilder(ReportCache, 'r')
        .addSelect('r.pdf')
        .where(
          'r.project_id = :projectId AND r.report_kind = :kind AND r.language = :language',
          { projectId, kind: KIND, language },
        )
        .getOne();
      if (!row?.pdf) throw new NotFoundException('No report generated yet.');
      return {
        pdf: row.pdf,
        fileName: `${fileSlug(inputs.project.enName)}-bar-optimiser-${language}.pdf`,
      };
    });
  }

  private async inputs(
    manager: EntityManager,
    projectId: string,
  ): Promise<ReportInputs> {
    const inputs = await loadReportInputs(
      manager,
      { profiles: this.platformProfiles, catalogs: this.platformCatalogs },
      projectId,
    );
    if (!inputs) throw new NotFoundException('Project not found.');
    return inputs;
  }

  private async toStatus(
    manager: EntityManager,
    inputs: ReportInputs,
    row: ReportCache | null,
    language: ReportLanguage,
  ): Promise<ReportStatus> {
    // A job whose server died never finishes: mark it failed (D22).
    if (row?.jobState === 'running' && !isAlive(row)) {
      row.jobState = 'failed';
      row.jobError = 'interrupted';
      await manager.save(row);
    }
    const stamps = windowStampsOf(inputs);
    const fingerprint = fingerprintOf(inputs, language);
    const state = !row?.fingerprint
      ? 'none'
      : row.fingerprint === fingerprint
        ? 'fresh'
        : 'stale';
    const hasPdf = row
      ? Boolean(
          (
            await manager.query<{ has: boolean }[]>(
              'SELECT (pdf IS NOT NULL) AS "has" FROM report_cache WHERE id = $1',
              [row.id],
            )
          )[0]?.has,
        )
      : false;
    const progress = row?.jobProgress as {
      groups?: ReportProgressGroup[];
    } | null;

    return {
      state,
      generatedAt: row?.generatedAt?.toISOString() ?? null,
      changedWindows:
        state === 'stale'
          ? changedWindowCount(row?.windowStamps ?? null, stamps)
          : 0,
      hasPdf,
      summary:
        state === 'none'
          ? null
          : ((row?.summary as ReportStatus['summary']) ?? null),
      job:
        row?.jobState && row.jobStartedAt
          ? {
              state: row.jobState,
              startedAt: row.jobStartedAt.toISOString(),
              groups: progress?.groups ?? [],
              error: row.jobError,
            }
          : null,
    };
  }
}

function findRow(
  manager: EntityManager,
  projectId: string,
  language: ReportLanguage,
): Promise<ReportCache | null> {
  return manager.findOne(ReportCache, {
    where: { projectId, reportKind: KIND, language },
  });
}

/** Running, and touched recently enough that its server is still alive. */
function isAlive(row: ReportCache): boolean {
  return (
    row.jobState === 'running' &&
    Date.now() - row.updatedAt.getTime() < JOB_ORPHANED_AFTER_MS
  );
}

function toSettings(row: CuttingSettingsRow | null): CuttingSettings {
  const base = row ?? DEFAULT_CUTTING_SETTINGS;
  return {
    kerfMm: base.kerfMm,
    endTrimMm: base.endTrimMm,
    extraLengthsMm: [...base.extraLengthsMm],
    stockLengthsMm: stockLengthsOf(base),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}
