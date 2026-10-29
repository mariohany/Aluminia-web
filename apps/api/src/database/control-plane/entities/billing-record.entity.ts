import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BillingReason } from '@repo/types/subscriptions';
import { Company } from './company.entity';
import { Plan } from './plan.entity';
import { User } from './user.entity';

// Append-only: every subscription/plan change is a new row, never an
// update to an existing one, so the history stays auditable. `companies`
// holds the current plan/seat count for fast reads; this table is the
// record of how it got there.
@Entity('billing')
export class BillingRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: Company;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => Plan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan?: Plan;

  @Column({ name: 'max_users', type: 'integer' })
  maxUsers: number;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ name: 'is_trial', type: 'boolean', default: false })
  isTrial: boolean;

  @Column({ type: 'varchar', length: 30 })
  reason: BillingReason;

  // The paid quotation behind a `paid` row (billing_documents, step 6).
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  // Null for the system (a trial ending on its own) or a removed account.
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor?: User | null;

  @Column({
    name: 'effective_from',
    type: 'timestamptz',
    default: () => 'now()',
  })
  effectiveFrom: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
