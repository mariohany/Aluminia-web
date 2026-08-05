import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';

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

  @Column({ type: 'varchar', length: 100 })
  plan: string;

  @Column({ name: 'max_users', type: 'integer' })
  maxUsers: number;

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
