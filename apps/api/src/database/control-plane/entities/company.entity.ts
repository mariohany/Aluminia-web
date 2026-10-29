import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CompanyStatus } from '@repo/types/companies';
import type { BillingCurrency } from '@repo/types/subscriptions';
import { Plan } from './plan.entity';
import { decimalTransformer } from './decimal.transformer';

export { CompanyStatus };

// A manufacturer (tenant). Created only by a super admin — see
// CLAUDE.md's multi-tenancy model. `schemaName` is this company's
// Postgres schema, derived and provisioned in Phase 5; never taken
// directly from user input.
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: CompanyStatus,
    enumName: 'company_status',
    default: CompanyStatus.ACTIVE,
  })
  status: CompanyStatus;

  // B20: the super admin's Arabic name. Null only on rows made before it.
  @Column({ name: 'name_ar', type: 'varchar', length: 255, nullable: true })
  nameAr: string | null;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => Plan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan?: Plan;

  // The seat limit: the plan's seats by default, overridable (B2).
  @Column({ name: 'max_users', type: 'integer' })
  maxUsers: number;

  // Null on Free. 23:59:59 Cairo of the end date (B9).
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ name: 'is_trial', type: 'boolean', default: false })
  isTrial: boolean;

  @Column({ type: 'char', length: 3, default: 'EGP' })
  currency: BillingCurrency;

  @Column({
    name: 'vat_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 14,
    transformer: decimalTransformer,
  })
  vatRate: number;

  // B13: the one tenant project still editable on Free (no FK: it lives
  // in the tenant schema). Null = not picked yet, or not on Free.
  @Column({ name: 'free_project_id', type: 'uuid', nullable: true })
  freeProjectId: string | null;

  @Column({ name: 'schema_name', type: 'varchar', length: 63, unique: true })
  schemaName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
