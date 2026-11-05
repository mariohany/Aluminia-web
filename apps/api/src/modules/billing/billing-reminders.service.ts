import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { UserRole } from '@repo/types/auth';
import { dueWarningStep } from '@repo/types/alerts';
import type { Env } from '../../config/env.schema';
import { Company } from '../../database/control-plane/entities/company.entity';
import {
  User,
  UserStatus,
} from '../../database/control-plane/entities/user.entity';
import { MAILER, type Mailer } from '../../mail/mailer';
import { reminderEmail } from '../../mail/templates';

/**
 * The warning email before a paid plan ends (B15, payment cycle P17):
 * once per stage (30 / 15 / 5 / 1 days) and end date. The stage is
 * claimed in `billing_notices` before sending, so two senders at once (two
 * users opening the app, the alerts call and the daily job) send one email;
 * a failed send gives the claim back, so the next try sends it.
 */
@Injectable()
export class BillingRemindersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Whether the daily job sends the reminders (production) instead of the alerts call. */
  get byJob(): boolean {
    return (
      this.config.get('BILLING_REMINDERS_BY_JOB', { infer: true }) === 'true'
    );
  }

  /**
   * Sends the reminder due for `daysLeft`, if one is and nobody sent it.
   * `copySuperAdmins` (the daily job) adds the super admins as hidden
   * copies. Returns whether an email went out; throws if sending failed.
   */
  async remindIfDue(
    company: Company,
    daysLeft: number,
    endDate: string,
    copySuperAdmins = false,
  ): Promise<boolean> {
    const step = dueWarningStep(daysLeft);
    if (step === null || !company.endsAt || !company.plan) return false;
    const claimed: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO billing_notices (company_id, ends_at, step) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, ends_at, step) DO NOTHING RETURNING id`,
      [company.id, company.endsAt, step],
    );
    const noticeId = claimed[0]?.id;
    if (!noticeId) return false;

    const admins = await this.dataSource.manager.find(User, {
      where: {
        companyId: company.id,
        role: UserRole.COMPANY_ADMIN,
        status: UserStatus.ACTIVE,
      },
      order: { createdAt: 'ASC' },
    });
    const to = admins.map((a) => a.email);
    if (to.length === 0) return false;
    const bcc = copySuperAdmins
      ? (
          await this.dataSource.manager.find(User, {
            where: {
              companyId: IsNull(),
              role: UserRole.SUPER_ADMIN,
              status: UserStatus.ACTIVE,
            },
          })
        ).map((u) => u.email)
      : [];
    try {
      await this.mailer.send({
        to,
        bcc,
        ...reminderEmail({
          companyEn: company.name,
          companyAr: company.nameAr,
          planEn: company.plan.nameEn,
          planAr: company.plan.nameAr,
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
      [noticeId, [...to, ...bcc]],
    );
    return true;
  }
}
