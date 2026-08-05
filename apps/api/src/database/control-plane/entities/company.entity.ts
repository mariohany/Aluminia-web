import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CompanyStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

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

  @Column({ type: 'varchar', length: 100 })
  plan: string;

  @Column({ name: 'max_users', type: 'integer' })
  maxUsers: number;

  @Column({ name: 'schema_name', type: 'varchar', length: 63, unique: true })
  schemaName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
