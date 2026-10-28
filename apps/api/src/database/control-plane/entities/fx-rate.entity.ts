import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { BillingCurrency } from '@repo/types/subscriptions';
import { decimalTransformer } from './decimal.transformer';

// One EGP rate per day and currency (B6), fetched on first use that day.
@Entity('fx_rates')
export class FxRate {
  @PrimaryColumn({ type: 'date' })
  date: string;

  @PrimaryColumn({ type: 'varchar', length: 3 })
  currency: Exclude<BillingCurrency, 'EGP'>;

  @Column({
    name: 'egp_per_unit',
    type: 'numeric',
    transformer: decimalTransformer,
  })
  egpPerUnit: number;

  @Column({ name: 'fetched_at', type: 'timestamptz', default: () => 'now()' })
  fetchedAt: Date;
}
