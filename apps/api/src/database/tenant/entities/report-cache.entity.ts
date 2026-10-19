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
 * One printed report: project × report kind × language
 * (docs/reports_planing.md §6). The PDF was printed from the project's
 * solve (`report_solve`, docs/browser_solve_planing.md §6) with inputs
 * hashing to `fingerprint`, the print fingerprint; a different hash today
 * means stale (D14). The print job making the next PDF (B7) keeps its
 * state on the same row, so the previous PDF stays readable meanwhile:
 * `jobState` queued/running/failed, `jobFingerprint` the print it is
 * making, `jobProgress` the solve's progress groups it shows.
 */
@Entity('report_cache')
@Index(
  'UQ_report_cache_project_kind_language',
  ['projectId', 'reportKind', 'language'],
  {
    unique: true,
  },
)
export class ReportCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'report_kind', type: 'varchar', length: 30 })
  reportKind: string;

  @Column({ type: 'varchar', length: 2 })
  language: string;

  @Column({ type: 'char', length: 64, nullable: true })
  fingerprint: string | null;

  @Column({ type: 'bytea', nullable: true, select: false })
  pdf: Buffer | null;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @Column({ name: 'generated_by_user_id', type: 'uuid', nullable: true })
  generatedByUserId: string | null;

  @Column({ name: 'job_state', type: 'varchar', length: 10, nullable: true })
  jobState: 'queued' | 'running' | 'failed' | null;

  @Column({ name: 'job_fingerprint', type: 'char', length: 64, nullable: true })
  jobFingerprint: string | null;

  @Column({ name: 'job_progress', type: 'jsonb', nullable: true })
  jobProgress: unknown;

  @Column({ name: 'job_started_at', type: 'timestamptz', nullable: true })
  jobStartedAt: Date | null;

  @Column({ name: 'job_started_by_user_id', type: 'uuid', nullable: true })
  jobStartedByUserId: string | null;

  @Column({ name: 'job_error', type: 'text', nullable: true })
  jobError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
