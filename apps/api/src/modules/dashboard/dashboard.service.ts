import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CompaniesPerMonthPoint,
  DashboardSummary,
} from '@repo/types/dashboard';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { ProjectCountsService } from '../project-counts/project-counts.service';

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
    private readonly projectCounts: ProjectCountsService,
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
        // Unfiltered, active companies only — see ProjectCountsService.
        this.projectCounts.total(),
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
}
