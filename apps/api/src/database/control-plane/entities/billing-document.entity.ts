import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BillingDocumentKind } from '@repo/types/billing-profile';
import type {
  DiscountKind,
  DocumentParty,
  PaymentMethod,
  QuotationMonths,
  StoredDocumentStatus,
} from '@repo/types/billing-documents';
import type { BillingCurrency } from '@repo/types/subscriptions';
import { Company } from './company.entity';
import { Plan } from './plan.entity';
import { User } from './user.entity';
import { decimalTransformer } from './decimal.transformer';

const decimal = (name: string, nullable = false) => ({
  name,
  type: 'numeric' as const,
  nullable,
  transformer: decimalTransformer,
});

// A quotation or an invoice (docs/subscriptions_planing.md §3d). Everything
// printed is a snapshot taken when it was issued.
@Entity('billing_documents')
export class BillingDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: Company;

  @Column({ type: 'varchar', length: 20 })
  kind: BillingDocumentKind;

  @Column({ type: 'varchar', length: 30, unique: true })
  number: string;

  @Column({ type: 'varchar', length: 20 })
  status: StoredDocumentStatus;

  @Column({ name: 'quotation_id', type: 'uuid', nullable: true })
  quotationId: string | null;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'plan_id' })
  plan?: Plan;

  @Column({ name: 'plan_name_en', type: 'varchar', length: 60 })
  planNameEn: string;

  @Column({ name: 'plan_name_ar', type: 'varchar', length: 60 })
  planNameAr: string;

  @Column({ type: 'int' })
  seats: number;

  @Column({ type: 'int' })
  months: QuotationMonths;

  @Column({ name: 'starts_on', type: 'date' })
  startsOn: string;

  @Column({ name: 'ends_on', type: 'date' })
  endsOn: string;

  @Column({ type: 'varchar', length: 3 })
  currency: BillingCurrency;

  @Column(decimal('fx_rate', true))
  fxRate: number | null;

  @Column({ name: 'fx_date', type: 'date', nullable: true })
  fxDate: string | null;

  @Column(decimal('unit_price'))
  unitPrice: number;

  @Column(decimal('subtotal'))
  subtotal: number;

  @Column({
    name: 'discount_kind',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  discountKind: DiscountKind | null;

  @Column(decimal('discount_value', true))
  discountValue: number | null;

  @Column(decimal('discount_amount'))
  discountAmount: number;

  @Column(decimal('vat_rate'))
  vatRate: number;

  @Column(decimal('vat_amount'))
  vatAmount: number;

  @Column(decimal('total'))
  total: number;

  @Column(decimal('total_egp'))
  totalEgp: number;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'jsonb' })
  seller: DocumentParty & Record<string, unknown>;

  @Column({ type: 'jsonb' })
  buyer: DocumentParty;

  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn: string | null;

  @Column(decimal('amount_received', true))
  amountReceived: number | null;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  paymentMethod: PaymentMethod | null;

  @Column({
    name: 'payment_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  paymentReference: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
