import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from './project.entity';

/**
 * One report's solve per project × report kind
 * (docs/browser_solve_planing.md §6): the plans every language's PDF is
 * printed from. `result` (a `SolveResult` of piece-line numbers),
 * `summary` and `windowStamps` were made from inputs hashing to
 * `solveFingerprint`; a different hash today means solve again. The solve
 * being made keeps its state on the same row, so the last good one stays
 * printable meanwhile: `solveState` solving/failed, `solveToken` the
 * browser allowed to write, `solveProgress` per member group, and
 * `updatedAt` as its heartbeat.
 */
@Entity('report_solve')
@Index('UQ_report_solve_project_kind', ['projectId', 'reportKind'], {
  unique: true,
})
export class ReportSolve {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'report_kind', type: 'varchar', length: 30 })
  reportKind: string;

  @Column({
    name: 'solve_fingerprint',
    type: 'char',
    length: 64,
    nullable: true,
  })
  solveFingerprint: string | null;

  @Column({ name: 'window_stamps', type: 'jsonb', nullable: true })
  windowStamps: Record<string, string> | null;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @Column({ type: 'jsonb', nullable: true })
  summary: unknown;

  @Column({ name: 'solved_at', type: 'timestamptz', nullable: true })
  solvedAt: Date | null;

  @Column({ name: 'solved_by_user_id', type: 'uuid', nullable: true })
  solvedByUserId: string | null;

  @Column({ name: 'solve_state', type: 'varchar', length: 10, nullable: true })
  solveState: 'solving' | 'failed' | null;

  @Column({ name: 'solve_token', type: 'uuid', nullable: true })
  solveToken: string | null;

  @Column({
    name: 'solve_pending_fingerprint',
    type: 'char',
    length: 64,
    nullable: true,
  })
  solvePendingFingerprint: string | null;

  @Column({ name: 'solve_progress', type: 'jsonb', nullable: true })
  solveProgress: unknown;

  @Column({ name: 'solve_started_at', type: 'timestamptz', nullable: true })
  solveStartedAt: Date | null;

  @Column({ name: 'solve_started_by_user_id', type: 'uuid', nullable: true })
  solveStartedByUserId: string | null;

  @Column({ name: 'solve_error', type: 'text', nullable: true })
  solveError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
