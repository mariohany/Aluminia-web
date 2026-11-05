import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  TODO_DIFFERENCE_DAYS,
  TODO_ENDING_DAYS,
  TODO_TRIAL_DAYS,
  type BillingTodo,
} from '@repo/types/billing-todo';
import {
  addDays,
  cairoDateOf,
  daysBetween,
  endOfCairoDay,
  type BillingCurrency,
} from '@repo/types/subscriptions';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

type PlanRow = {
  company_id: string;
  company_name: string;
  ends_at: Date;
  plan_id: string;
  plan_key: string;
  plan_name_en: string;
  plan_name_ar: string;
};

/**
 * Billing › To-do (docs/payment_cycle_planing.md §8, task 7.2): sent
 * quotations waiting for payment, paid plans ending in 30 days with no
 * renewal or upgrade quotation sent, trials ending in 7 days, and recent
 * payments whose amount differed. Plans past their end are settled first,
 * like every admin read.
 */
@Injectable()
export class BillingTodoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async todo(now = new Date()): Promise<BillingTodo> {
    await this.subscriptions.settleAllLapsed(now);
    const today = cairoDateOf(now);
    const daysTo = (instant: Date) => daysBetween(today, cairoDateOf(instant));

    const waiting: Array<{
      id: string;
      number: string;
      company_id: string;
      company_name: string;
      currency: BillingCurrency;
      total: string;
      valid_until: string;
      sent_at: Date;
    }> = await this.dataSource.query(
      `SELECT d.id, d.number, d.company_id, c.name AS company_name, d.currency, d.total,
              to_char(d.valid_until, 'YYYY-MM-DD') AS valid_until,
              COALESCE((SELECT max(s.sent_at) FROM billing_sends s WHERE s.document_id = d.id AND s.error IS NULL), d.created_at) AS sent_at
       FROM billing_documents d JOIN companies c ON c.id = d.company_id
       WHERE d.kind = 'quotation' AND d.status = 'sent' AND d.valid_until >= $1 AND c.status = 'active'
       ORDER BY sent_at ASC`,
      [today],
    );

    const plans = (where: string, params: unknown[]): Promise<PlanRow[]> =>
      this.dataSource.query(
        `SELECT c.id AS company_id, c.name AS company_name, c.ends_at,
                p.id AS plan_id, p.key AS plan_key, p.name_en AS plan_name_en, p.name_ar AS plan_name_ar
         FROM companies c JOIN plans p ON p.id = c.plan_id
         WHERE c.status = 'active' AND p.key <> 'free' AND c.ends_at IS NOT NULL AND ${where}
         ORDER BY c.ends_at ASC`,
        params,
      );
    // Ending on or before the Cairo day today + N (ends_at is 23:59:59 of it).
    const until = (days: number) => endOfCairoDay(addDays(today, days));
    const ending = await plans(
      `NOT c.is_trial AND c.ends_at <= $1
       AND NOT EXISTS (SELECT 1 FROM billing_documents q
         WHERE q.company_id = c.id AND q.kind = 'quotation' AND q.status = 'sent'
           AND q.purpose IN ('renewal', 'upgrade') AND q.valid_until >= $2)`,
      [until(TODO_ENDING_DAYS), today],
    );
    const trials = await plans(`c.is_trial AND c.ends_at <= $1`, [
      until(TODO_TRIAL_DAYS),
    ]);

    const differences: Array<{
      id: string;
      number: string;
      company_id: string;
      company_name: string;
      currency: BillingCurrency;
      total: string;
      amount_received: string;
      payment_note: string | null;
      paid_on: string;
    }> = await this.dataSource.query(
      `SELECT d.id, d.number, d.company_id, c.name AS company_name, d.currency, d.total,
              d.amount_received, d.payment_note, to_char(d.paid_on, 'YYYY-MM-DD') AS paid_on
       FROM billing_documents d JOIN companies c ON c.id = d.company_id
       WHERE d.kind = 'invoice' AND d.amount_received <> d.total AND d.paid_on >= $1
       ORDER BY d.paid_on DESC`,
      [addDays(today, -TODO_DIFFERENCE_DAYS)],
    );

    const planOf = (row: PlanRow) => ({
      companyId: row.company_id,
      companyName: row.company_name,
      plan: {
        id: row.plan_id,
        key: row.plan_key as BillingTodo['trialsEnding'][number]['plan']['key'],
        nameEn: row.plan_name_en,
        nameAr: row.plan_name_ar,
      },
      endsAt: new Date(row.ends_at).toISOString(),
      daysLeft: daysTo(new Date(row.ends_at)),
    });
    return {
      waiting: waiting.map((row) => ({
        companyId: row.company_id,
        companyName: row.company_name,
        documentId: row.id,
        number: row.number,
        currency: row.currency,
        total: Number(row.total),
        sentAt: new Date(row.sent_at).toISOString(),
        expiresIn: daysBetween(today, row.valid_until),
      })),
      endingNoQuotation: ending.map(planOf),
      trialsEnding: trials.map(planOf),
      differences: differences.map((row) => ({
        companyId: row.company_id,
        companyName: row.company_name,
        documentId: row.id,
        number: row.number,
        currency: row.currency,
        total: Number(row.total),
        amountReceived: Number(row.amount_received),
        note: row.payment_note,
        paidOn: row.paid_on,
      })),
    };
  }
}
