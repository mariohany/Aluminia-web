import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { BillingDocumentKind } from '@repo/types/billing-profile';

// The last quotation / invoice number issued in a year (B17). Locked FOR
// UPDATE by whatever issues the next number, so invoices have no gaps.
@Entity('billing_counters')
export class BillingCounter {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  kind: BillingDocumentKind;

  @PrimaryColumn({ type: 'int' })
  year: number;

  @Column({ type: 'int', default: 0 })
  last: number;
}
