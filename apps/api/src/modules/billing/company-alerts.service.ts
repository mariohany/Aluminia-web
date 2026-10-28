import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import { dueWarningStep, type CompanyAlerts } from '@repo/types/alerts';
import { subscriptionState } from '@repo/types/subscriptions';
import type { Env } from '../../config/env.schema';
import { Company } from '../../database/control-plane/entities/company.entity';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { MAILER, type Mailer } from '../../mail/mailer';
import { reminderEmail } from '../../mail/templates';

/**
 * GET /company/alerts (docs/subscriptions_planing.md Q2, Mario
 * 2026-10-29): what to show a user now that they opened the app, and, on
 * the way, the warning email before the end (B15) if one is due — once
 * per stage (30 / 15 / 5 / 1 days) and end date, whoever opens the app and
 * however often. The stage is claimed in `billing_notices` before sending,
 * so two users opening at once send one email; a failed send gives the
 * claim back, so the next open tries again. The call itself never fails
 * over an email.
 */
@Injectable()
export class CompanyAlertsService {
  private readonly logger = new Logger(CompanyAlertsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
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
      await this.warnIfDue(company, state.daysLeft, state.endDate);
    } catch (error) {
      this.logger.warn(
        `Warning email for ${company.id} failed: ${(error as Error).message}`,
      );
    }
    return {
      ending: { ...state, canRenew: user.role === UserRole.COMPANY_ADMIN },
    };
  }

  private async warnIfDue(
    company: Company,
    daysLeft: number,
    endDate: string,
  ): Promise<void> {
    const step = dueWarningStep(daysLeft);
    if (step === null || !company.endsAt) return;
    const claimed: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO billing_notices (company_id, ends_at, step) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, ends_at, step) DO NOTHING RETURNING id`,
      [company.id, company.endsAt, step],
    );
    const noticeId = claimed[0]?.id;
    if (!noticeId) return;

    const admins = await this.dataSource.manager.find(User, {
      where: {
        companyId: company.id,
        role: UserRole.COMPANY_ADMIN,
        status: UserStatus.ACTIVE,
      },
      order: { createdAt: 'ASC' },
    });
    const to = admins.map((a) => a.email);
    if (to.length === 0) return;
    try {
      await this.mailer.send({
        to,
        ...reminderEmail({
          companyEn: company.name,
          companyAr: company.nameAr,
          planEn: company.plan!.nameEn,
          planAr: company.plan!.nameAr,
          endsOn: endDate,
          daysLeft,
          appUrl: this.config.get('CORS_ORIGIN', { infer: true }),
        }),
      });
    } catch (error) {
      await this.dataSource.query(`DELETE FROM billing_notices WHERE id = $1`, [
        noticeId,
      ]);
      throw error;
    }
    await this.dataSource.query(
      `UPDATE billing_notices SET sent_to = $2 WHERE id = $1`,
      [noticeId, to],
    );
  }
}
