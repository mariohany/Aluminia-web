import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import type { CompanyAlerts } from '@repo/types/alerts';
import { subscriptionState } from '@repo/types/subscriptions';
import { Company } from '../../database/control-plane/entities/company.entity';
import { BillingRemindersService } from './billing-reminders.service';

/**
 * GET /company/alerts (docs/subscriptions_planing.md Q2, Mario
 * 2026-10-29): what to show a user now that they opened the app, and, on
 * the way, the warning email before the end (B15) if one is due — unless
 * the daily job sends those (`BILLING_REMINDERS_BY_JOB`, production,
 * payment cycle P17). The call itself never fails over an email.
 */
@Injectable()
export class CompanyAlertsService {
  private readonly logger = new Logger(CompanyAlertsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reminders: BillingRemindersService,
  ) {}

  async alerts(user: {
    companyId: string;
    role: UserRole;
  }): Promise<CompanyAlerts> {
    const company = await this.dataSource.manager.findOne(Company, {
      where: { id: user.companyId },
      relations: { plan: true },
    });
    if (!company?.plan) return { ending: null };
    const state = subscriptionState(
      {
        planKey: company.plan.key,
        endsAt: company.endsAt,
        isTrial: company.isTrial,
      },
      new Date(),
    );
    if (state.kind !== 'ending') return { ending: null };

    try {
      if (!this.reminders.byJob) {
        await this.reminders.remindIfDue(
          company,
          state.daysLeft,
          state.endDate,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Warning email for ${company.id} failed: ${(error as Error).message}`,
      );
    }
    return {
      ending: { ...state, canRenew: user.role === UserRole.COMPANY_ADMIN },
    };
  }
}
