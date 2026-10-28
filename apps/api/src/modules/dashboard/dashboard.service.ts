import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  BillingCounts,
  CompaniesPerMonthPoint,
  DashboardBilling,
  DashboardBillingCompany,
  DashboardSummary,
  RevenueSummary,
} from '@repo/types/dashboard';
import {
  ENDING_SOON_DAYS,
  addDays,
  cairoDateOf,
  daysBetween,
} from '@repo/types/subscriptions';
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
    const [active, archived, liveSessionCount, projectCount, revenue, billing] =
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
        this.revenue(),
        this.billingCounts(),
      ]);

    return {
      companies: { active, archived },
      liveSessions: { count: liveSessionCount },
      projects: { count: projectCount },
      revenue,
      billing,
    };
  }

  /** Invoices paid this and last Cairo month, in EGP (B22). */
  private async revenue(now = new Date()): Promise<RevenueSummary> {
    const today = cairoDateOf(now);
    const thisMonth = today.slice(0, 7);
    const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
    const [row] = await this.companies.query<
      Array<{ this_month: string; last_month: string }>
    >(
      `SELECT
         COALESCE(SUM(total_egp) FILTER (WHERE to_char(paid_on, 'YYYY-MM') = $1), 0) AS this_month,
         COALESCE(SUM(total_egp) FILTER (WHERE to_char(paid_on, 'YYYY-MM') = $2), 0) AS last_month
       FROM billing_documents WHERE kind = 'invoice'`,
      [thisMonth, lastMonth],
    );
    return {
      thisMonthEgp: Number(row?.this_month ?? 0),
      lastMonthEgp: Number(row?.last_month ?? 0),
    };
  }

  private async billingCounts(): Promise<BillingCounts> {
    const today = cairoDateOf(new Date());
    const [row] = await this.companies.query<
      Array<{ ending: string; expired: string; unpaid: string }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM companies c JOIN plans p ON p.id = c.plan_id
           WHERE c.status = 'active' AND p.key <> 'free' AND NOT c.is_trial
             AND c.ends_at > now() AND c.ends_at <= now() + make_interval(days => $1)) AS ending,
         (SELECT COUNT(*) FROM companies c JOIN plans p ON p.id = c.plan_id
           WHERE c.status = 'active' AND p.key <> 'free' AND NOT c.is_trial
             AND c.ends_at <= now()) AS expired,
         (SELECT COUNT(*) FROM billing_documents
           WHERE kind = 'quotation' AND status = 'sent'
             AND (valid_until IS NULL OR valid_until >= $2)) AS unpaid`,
      [ENDING_SOON_DAYS, today],
    );
    return {
      endingSoon: Number(row?.ending ?? 0),
      unpaid: Number(row?.unpaid ?? 0),
      expired: Number(row?.expired ?? 0),
    };
  }

  /** The Leads card's billing tabs (B22): soonest end first, newest
   * quotation first, most recently expired first; 50 rows each. */
  async billing(): Promise<DashboardBilling> {
    const today = cairoDateOf(new Date());
    const companies = (where: string, order: string, params: unknown[]) =>
      this.companies.query<
        Array<{
          id: string;
          name: string;
          name_en: string;
          name_ar: string;
          ends_at: Date;
        }>
      >(
        `SELECT c.id, c.name, p.name_en, p.name_ar, c.ends_at
         FROM companies c JOIN plans p ON p.id = c.plan_id
         WHERE c.status = 'active' AND p.key <> 'free' AND NOT c.is_trial AND ${where}
         ORDER BY c.ends_at ${order} LIMIT 50`,
        params,
      );
    const toRow = (r: {
      id: string;
      name: string;
      name_en: string;
      name_ar: string;
      ends_at: Date;
    }): DashboardBillingCompany => {
      const endDate = cairoDateOf(new Date(r.ends_at));
      return {
        companyId: r.id,
        companyName: r.name,
        planEn: r.name_en,
        planAr: r.name_ar,
        endDate,
        daysLeft: daysBetween(today, endDate),
      };
    };
    const [ending, expired, unpaid] = await Promise.all([
      companies(
        `c.ends_at > now() AND c.ends_at <= now() + make_interval(days => $1)`,
        'ASC',
        [ENDING_SOON_DAYS],
      ),
      companies(`c.ends_at <= now()`, 'DESC', []),
      this.companies.query<
        Array<{
          id: string;
          number: string;
          company_id: string;
          name: string;
          currency: string;
          total: string;
          valid_until: string | null;
        }>
      >(
        `SELECT d.id, d.number, d.company_id, c.name, d.currency, d.total,
           to_char(d.valid_until, 'YYYY-MM-DD') AS valid_until
         FROM billing_documents d JOIN companies c ON c.id = d.company_id
         WHERE d.kind = 'quotation' AND d.status = 'sent'
           AND (d.valid_until IS NULL OR d.valid_until >= $1)
         ORDER BY d.created_at DESC LIMIT 50`,
        [today],
      ),
    ]);
    return {
      endingSoon: ending.map(toRow),
      expired: expired.map(toRow),
      unpaid: unpaid.map((r) => ({
        documentId: r.id,
        number: r.number,
        companyId: r.company_id,
        companyName: r.name,
        currency: r.currency,
        total: Number(r.total),
        validUntil: r.valid_until,
      })),
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
