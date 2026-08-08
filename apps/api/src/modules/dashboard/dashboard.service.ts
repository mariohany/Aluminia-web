import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import type { DashboardSummary } from '@repo/types/dashboard';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { Session } from '../../database/control-plane/entities/session.entity';
import { Lead } from '../../database/control-plane/entities/lead.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { REDIS_CLIENT } from '../../common/redis.module';
import { TenantConnectionService } from '../tenancy/tenant-connection.service';

const RECENT_ACTIVITY_LIMIT = 10;

// Short-lived, not version-keyed like the lookups cache: there's no
// write path that could bump a "projects changed" version, since a
// project write happens inside some tenant's own schema with no signal
// back to the control plane. A plain TTL is the whole mechanism — per
// admin_dashboard_planing.md's recommendation, "cached for a minute or
// two" is enough for a number nobody reads more than a few times a day.
const PROJECT_COUNT_CACHE_KEY = 'dashboard:project-count';
const PROJECT_COUNT_CACHE_TTL_SECONDS = 90;

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(BillingRecord)
    private readonly billing: Repository<BillingRecord>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly tenantConnection: TenantConnectionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const [active, archived, planRows, recentBilling, liveSessionCount, leadCount, projectCount] =
      await Promise.all([
        this.companies.count({ where: { status: CompanyStatus.ACTIVE } }),
        this.companies.count({ where: { status: CompanyStatus.SUSPENDED } }),
        this.companies
          .createQueryBuilder('company')
          .select('company.plan', 'plan')
          .addSelect('COUNT(*)', 'count')
          .groupBy('company.plan')
          .orderBy('company.plan', 'ASC')
          .getRawMany<{ plan: string; count: string }>(),
        this.billing.find({
          relations: { company: true },
          order: { createdAt: 'DESC' },
          take: RECENT_ACTIVITY_LIMIT,
        }),
        // Same live-session definition as users.service.ts's `online` check:
        // a session row whose expiry hasn't passed yet.
        this.sessions
          .createQueryBuilder('session')
          .where('session.expiresAt > :now', { now: new Date() })
          .getCount(),
        this.leads.count(),
        this.totalProjectCount(),
      ]);

    return {
      companies: { active, archived },
      planDistribution: planRows.map((row) => ({
        plan: row.plan,
        count: Number(row.count),
      })),
      // `company` is guaranteed present: billing.company_id cascades on
      // company delete, so a surviving billing row always has its company.
      recentActivity: recentBilling.map((record) => ({
        id: record.id,
        companyId: record.companyId,
        companyName: record.company!.name,
        plan: record.plan,
        maxUsers: record.maxUsers,
        notes: record.notes,
        effectiveFrom: record.effectiveFrom.toISOString(),
      })),
      liveSessions: { count: liveSessionCount },
      incomingLeads: { count: leadCount },
      projects: { count: projectCount },
    };
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

    await this.redis.set(PROJECT_COUNT_CACHE_KEY, total, 'EX', PROJECT_COUNT_CACHE_TTL_SECONDS);
    return total;
  }
}
