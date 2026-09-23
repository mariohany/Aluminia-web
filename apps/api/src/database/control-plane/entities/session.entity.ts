import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

export interface GraceToken {
  hash: string;
  // Stored as an ISO string: this rides inside jsonb, which has no date
  // type of its own, so it comes back as text however it went in.
  expiresAt: string;
}

// Backs refresh-token rotation and the one-active-session-per-user rule
// (see docs/initial_plan.md's open question, resolved as: strictly one
// session — a new login replaces this row). The `user_id` unique
// constraint is what enforces that at the database level, not just in
// application code.
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 255 })
  refreshTokenHash: string;

  // Hashes this session held before the last few rotations, each still
  // accepted until its own `expiresAt`. Without them, tabs refreshing at
  // the same moment leave all but one holding a token the row no longer
  // stores — see AuthService.refresh, REFRESH_GRACE_MS and
  // REFRESH_GRACE_DEPTH. Newest first.
  @Column({ name: 'grace_tokens', type: 'jsonb', default: () => "'[]'::jsonb" })
  graceTokens: GraceToken[];

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
