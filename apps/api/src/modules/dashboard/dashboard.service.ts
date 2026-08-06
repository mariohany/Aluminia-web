import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DashboardSummary } from '@repo/types/dashboard';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { BillingRecord } from '../../database/control-plane/entities/billing-record.entity';
import { Session } from '../../database/control-plane/entities/session.entity';

const RECENT_ACTIVITY_LIMIT = 10;

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(BillingRecord)
    private readonly billing: Repository<BillingRecord>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const [active, archived, planRows, recentBilling, liveSessionCount] =
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
    };
  }
}
