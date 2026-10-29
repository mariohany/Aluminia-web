import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { FxQuote } from '@repo/types/billing-documents';
import { cairoDateOf, type BillingCurrency } from '@repo/types/subscriptions';
import { FxRate } from '../../database/control-plane/entities/fx-rate.entity';

type ForeignCurrency = Exclude<BillingCurrency, 'EGP'>;
const FOREIGN: ForeignCurrency[] = ['SAR', 'AED', 'USD', 'EUR'];

/** Where today's rates come from. A token, so tests swap it for a fake. */
export const FX_SOURCE = Symbol('FX_SOURCE');
export interface FxSource {
  /** Units of each currency per 1 EGP, as open.er-api.com gives them. */
  perEgp(): Promise<Partial<Record<string, number>>>;
}

/** open.er-api.com (B6): free, no key, daily. */
export const openErApiSource: FxSource = {
  async perEgp() {
    const res = await fetch('https://open.er-api.com/v6/latest/EGP', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`FX API answered ${res.status}`);
    const body = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    if (body.result !== 'success' || !body.rates) {
      throw new Error('FX API gave no rates');
    }
    return body.rates;
  },
};

/**
 * The EGP rate of a quotation's currency (docs/subscriptions_planing.md B6):
 * one fetch a day (Cairo) into `fx_rates`, reused all day; the last known
 * rate when the API is down; none at all and the admin types it. The rate
 * a quotation uses is frozen on it, so this only prefills the dialog.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    @InjectRepository(FxRate) private readonly rates: Repository<FxRate>,
    @Inject(FX_SOURCE) private readonly source: FxSource,
  ) {}

  async quote(currency: BillingCurrency, now = new Date()): Promise<FxQuote> {
    if (currency === 'EGP') {
      return { currency, date: null, egpPerUnit: null, source: 'none' };
    }
    const today = cairoDateOf(now);
    let row = await this.rates.findOne({ where: { date: today, currency } });
    if (!row) {
      await this.fetchToday(today);
      row = await this.rates.findOne({ where: { date: today, currency } });
    }
    if (row) {
      return {
        currency,
        date: row.date,
        egpPerUnit: row.egpPerUnit,
        source: 'today',
      };
    }
    const last = await this.rates.findOne({
      where: { currency },
      order: { date: 'DESC' },
    });
    return last
      ? {
          currency,
          date: last.date,
          egpPerUnit: last.egpPerUnit,
          source: 'last_known',
        }
      : { currency, date: null, egpPerUnit: null, source: 'none' };
  }

  private async fetchToday(today: string): Promise<void> {
    try {
      const perEgp = await this.source.perEgp();
      const rows = FOREIGN.flatMap((currency) => {
        const rate = perEgp[currency];
        return rate && rate > 0
          ? [
              {
                date: today,
                currency,
                egpPerUnit: Number((1 / rate).toFixed(6)),
              },
            ]
          : [];
      });
      if (rows.length) {
        await this.rates
          .createQueryBuilder()
          .insert()
          .values(rows)
          .orIgnore()
          .execute();
      }
    } catch (error) {
      this.logger.warn(`FX fetch failed: ${(error as Error).message}`);
    }
  }
}
