import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Not } from 'typeorm';
import {
  ENDING_SOON_DAYS,
  cairoDateOf,
  subscriptionState,
} from '@repo/types/subscriptions';
import {
  Company,
  CompanyStatus,
} from '../../database/control-plane/entities/company.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BillingRemindersService } from './billing-reminders.service';

export type DailyBillingResult =
  | { ran: false; date: string }
  | {
      ran: true;
      date: string;
      /** Plans and trials past their end, dropped to Free. */
      dropped: number;
      /** Reminder emails sent (client admins + super admins in copy). */
      reminded: number;
      /** Companies whose reminder failed (it is tried again next run). */
      failed: string[];
    };

/**
 * The daily billing job (docs/payment_cycle_planing.md P17, P28): a
 * DigitalOcean scheduled job runs `npm run job:daily-billing` once a day.
 * It drops every plan and trial past its end to Free (the lazy drop on the
 * next request stays as the safety net) and sends the due 30/15/5/1-day
 * reminders to the client admins with the super admins in copy.
 *
 * Once per Cairo day: the run's `billing_job_runs` row is claimed first,
 * so a second trigger the same day does nothing. A run that failed is
 * claimed again by the next trigger. Reminders are claimed one by one in
 * `billing_notices`, so even an overlap sends each one once.
 */
@Injectable()
export class DailyBillingService {
  private readonly logger = new Logger(DailyBillingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly subscriptions: SubscriptionsService,
    private readonly reminders: BillingRemindersService,
  ) {}

  async run(now = new Date()): Promise<DailyBillingResult> {
    const date = cairoDateOf(now);
    const claimed: Array<{ run_date: string }> = await this.dataSource.query(
      `INSERT INTO billing_job_runs (run_date) VALUES ($1)
       ON CONFLICT (run_date) DO UPDATE SET started_at = now(), finished_at = NULL, error = NULL
         WHERE billing_job_runs.error IS NOT NULL
       RETURNING run_date`,
      [date],
    );
    if (claimed.length === 0) {
      this.logger.log(`Daily billing already ran for ${date}.`);
      return { ran: false, date };
    }

    try {
      const dropped = await this.subscriptions.settleAllLapsed(now);

      const ending = await this.dataSource.manager.find(Company, {
        where: {
          status: CompanyStatus.ACTIVE,
          isTrial: false,
          endsAt: Not(IsNull()),
        },
        relations: { plan: true },
      });
      let reminded = 0;
      const failed: string[] = [];
      for (const company of ending) {
        if (!company.plan || company.plan.key === 'free') continue;
        const state = subscriptionState(
          { planKey: company.plan.key, endsAt: company.endsAt, isTrial: false },
          now,
        );
        if (state.kind !== 'ending' || state.daysLeft > ENDING_SOON_DAYS)
          continue;
        try {
          if (
            await this.reminders.remindIfDue(
              company,
              state.daysLeft,
              state.endDate,
              true,
            )
          ) {
            reminded++;
          }
        } catch (error) {
          failed.push(company.id);
          this.logger.warn(
            `Reminder for ${company.id} failed: ${(error as Error).message}`,
          );
        }
      }

      const result = { ran: true as const, date, dropped, reminded, failed };
      await this.dataSource.query(
        `UPDATE billing_job_runs SET finished_at = now(), summary = $2,
           error = CASE WHEN $3::int > 0 THEN 'reminders failed' ELSE NULL END
         WHERE run_date = $1`,
        [date, { dropped, reminded, failed }, failed.length],
      );
      return result;
    } catch (error) {
      await this.dataSource.query(
        `UPDATE billing_job_runs SET error = $2 WHERE run_date = $1`,
        [date, (error as Error).message.slice(0, 1000)],
      );
      throw error;
    }
  }
}
