import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { WindowPanel } from './window-panel.entity';

/**
 * One window ASSEMBLY within a project — a composition of coupled
 * panels, ordered as one job line. See docs/window_assembly_planing.md.
 *
 * This row is only the header. Everything describing how the unit is
 * built — frame, sash, glass, colours, opening type, fly screen, door —
 * lives on `WindowPanel`, one row per panel, because an assembly has no
 * single frame or glass to speak of.
 *
 * `widthMm`/`heightMm` are DERIVED from the panels' bounding box and
 * written by `WindowsService` on every save. They are stored rather than
 * computed on read so a canvas card (and, later, a quote line) can print
 * a size without joining panels. Nothing outside the service should
 * write them.
 */
@Entity('windows')
export class Window {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @OneToMany(() => WindowPanel, (panel) => panel.window, { cascade: true })
  panels?: WindowPanel[];

  /** Derived — the bounding box of `panels`. See the class comment. */
  @Column({ name: 'width_mm', type: 'integer' })
  widthMm: number;

  /** Derived — the bounding box of `panels`. See the class comment. */
  @Column({ name: 'height_mm', type: 'integer' })
  heightMm: number;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  location: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // No FK, deliberately — `users` lives in the control-plane schema, and
  // tenant tables never reach across into it. See project.entity.ts's
  // comment on `createdByUserId` for the full rule.
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
