import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import type {
  CompaniesPerMonthPoint,
  DashboardSummary,
} from '@repo/types/dashboard';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { REDIS_CLIENT } from '../../common/redis.module';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';

// Short-lived, not version-keyed like the lookups cache: there's no
// write path that could bump a "projects changed" version, since a
// project write happens inside some tenant's own schema with no signal
// back to the control plane. A plain TTL is the whole mechanism — per
// admin_dashboard_planing.md's recommendation, "cached for a minute or
// two" is enough for a number nobody reads more than a few times a day.
const PROJECT_COUNT_CACHE_KEY = 'dashboard:project-count';
const PROJECT_COUNT_CACHE_TTL_SECONDS = 90;

// Same "YYYY-MM-01" shape on both sides of the zero-fill join — Postgres's
// date_trunc result and the enumerated calendar cursor must key identically
// or every month looks like it has no signups.
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly tenantConnection: TenantConnectionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const [active, archived, liveSessionCount, projectCount] =
      await Promise.all([
        this.companies.count({ where: { status: CompanyStatus.ACTIVE } }),
        this.companies.count({ where: { status: CompanyStatus.SUSPENDED } }),
        // Same live-session definition as users.service.ts's `online` check:
        // a session row whose expiry hasn't passed yet.
        this.sessions
          .createQueryBuilder('session')
          .where('session.expiresAt > :now', { now: new Date() })
          .getCount(),
        this.totalProjectCount(),
      ]);

    return {
      companies: { active, archived },
      liveSessions: { count: liveSessionCount },
      projects: { count: projectCount },
    };
  }

  // Unset from/to default to the current calendar year — matches "a
  // chart for the year" as the default view. An explicit from or to
  // still resolves against that same current-year fallback on the
  // other side, rather than becoming unbounded, so a single-sided
  // filter can't trigger a full-table scan.
  async companiesPerMonth(
    from?: string,
    to?: string,
  ): Promise<CompaniesPerMonthPoint[]> {
    const currentYear = new Date().getUTCFullYear();
    const start = new Date(`${from ?? `${currentYear}-01-01`}T00:00:00.000Z`);
    const end = new Date(`${to ?? `${currentYear}-12-31`}T23:59:59.999Z`);

    const rows = await this.companies
      .createQueryBuilder('company')
      .select("date_trunc('month', company.createdAt)", 'month')
      .addSelect('COUNT(*)', 'count')
      .where('company.createdAt BETWEEN :start AND :end', { start, end })
      .groupBy("date_trunc('month', company.createdAt)")
      .getRawMany<{ month: Date; count: string }>();
    const countByMonth = new Map(
      rows.map((row) => [monthKey(row.month), Number(row.count)]),
    );

    // Zero-filled so a month with no signups renders as a 0-height bar
    // instead of a gap the reader might mistake for missing data.
    const points: CompaniesPerMonthPoint[] = [];
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
    );
    const endMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
    );
    while (cursor <= endMonth) {
      const key = monthKey(cursor);
      points.push({ month: key, count: countByMonth.get(key) ?? 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }

  /**
   * Unfiltered fan-out across every active company's schema, summed.
   * "Filtered by company/date/status" is open (admin_dashboard_planing.md
   * open question 2) — this ships the unfiltered total now rather than
   * blocking the whole tile on that answer; adding a WHERE clause later
   * doesn't touch this shape.
   *
   * Archived companies are skipped deliberately: their schema still
   * exists (archiving never drops it), but a suspended company's
   * project count isn't "current" in the sense this tile means.
   */
  private async totalProjectCount(): Promise<number> {
    const cached = await this.redis.get(PROJECT_COUNT_CACHE_KEY);
    if (cached !== null) return Number(cached);

    const activeCompanies = await this.companies.find({
      where: { status: CompanyStatus.ACTIVE },
      select: { schemaName: true },
    });

    const counts = await Promise.all(
      activeCompanies.map((company) =>
        this.tenantConnection.runInSchema(company.schemaName, (manager) =>
          manager.count(Project),
        ),
      ),
    );
    const total = counts.reduce((sum, count) => sum + count, 0);

    await this.redis.set(
      PROJECT_COUNT_CACHE_KEY,
      total,
      'EX',
      PROJECT_COUNT_CACHE_TTL_SECONDS,
    );
    return total;
  }
}
