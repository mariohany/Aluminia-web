import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '@repo/types/auth';
import { Company } from './company.entity';

export { UserRole };

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

// Identity lives here in the shared control-plane DB, never in a tenant
// schema. A super admin belongs to no company; every other role must.
@Entity('users')
@Check(
  'CK_users_super_admin_has_no_company',
  `(role = 'super_admin' AND company_id IS NULL) OR (role != 'super_admin' AND company_id IS NOT NULL)`,
)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  role: UserRole;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id' })
  company?: Company;

  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status',
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  // Carried in the access token as `ver`; every change to what this user
  // may do (role, company, deactivation, password reset, ended session,
  // company archived) adds 1, and JwtAuthGuard refuses a token whose
  // `ver` is behind — so the change takes effect on the next request,
  // not when the token expires (stability S3, AuthVersionService).
  // Deactivated by the company's drop to Free (B13); a paid plan
  // reactivates exactly these (B14). Any manual (de)activation clears it.
  @Column({ name: 'plan_deactivated', type: 'boolean', default: false })
  planDeactivated: boolean;

  @Column({ name: 'auth_version', type: 'int', default: 0 })
  authVersion: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
