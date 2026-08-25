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
 * A single window design within a project — profiles, size, quantity,
 * glass, options, colours. See docs/window_creation_planing.md.
 *
 * Every lookup reference is a nullable platform/company uuid PAIR,
 * `ScopedRef`-converted at the API boundary (`resolveScopedRef`/
 * `formatScopedRef`) — same convention as `CompanySystemProfile` etc.
 * Unlike `Project`'s own preference pairs (soft, no CHECK, no FK), these
 * are structural: the migration enforces exactly one half set (`CHECK
 * num_nonnulls(...) = 1`) and a real FK on the company half. Glass is
 * four columns, not two — see the migration's header comment for why a
 * single company-side column can't carry an FK to two different tables
 * depending on `glassKind`.
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

  @Column({ name: 'frame_platform_profile_id', type: 'uuid', nullable: true })
  framePlatformProfileId: string | null;

  @Column({ name: 'frame_company_profile_id', type: 'uuid', nullable: true })
  frameCompanyProfileId: string | null;

  @Column({ name: 'sash_platform_profile_id', type: 'uuid', nullable: true })
  sashPlatformProfileId: string | null;

  @Column({ name: 'sash_company_profile_id', type: 'uuid', nullable: true })
  sashCompanyProfileId: string | null;

  @Column({ name: 'width_mm', type: 'integer' })
  widthMm: number;

  @Column({ name: 'height_mm', type: 'integer' })
  heightMm: number;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Column({ name: 'has_fly_screen', type: 'boolean', default: false })
  hasFlyScreen: boolean;

  @Column({ name: 'is_door', type: 'boolean', default: false })
  isDoor: boolean;

  // 'single' | 'combination' — see packages/types/src/windows.ts's
  // GlassKind. Plain varchar, not a Postgres enum: the platform enums
  // live in `public`, which the tenant search_path excludes.
  @Column({ name: 'glass_kind', type: 'varchar', length: 20 })
  glassKind: string;

  @Column({ name: 'glass_platform_single_id', type: 'uuid', nullable: true })
  glassPlatformSingleId: string | null;

  @Column({ name: 'glass_company_single_id', type: 'uuid', nullable: true })
  glassCompanySingleId: string | null;

  @Column({
    name: 'glass_platform_combination_id',
    type: 'uuid',
    nullable: true,
  })
  glassPlatformCombinationId: string | null;

  @Column({
    name: 'glass_company_combination_id',
    type: 'uuid',
    nullable: true,
  })
  glassCompanyCombinationId: string | null;

  @Column({ name: 'interior_color_platform_id', type: 'uuid', nullable: true })
  interiorColorPlatformId: string | null;

  @Column({ name: 'interior_color_company_id', type: 'uuid', nullable: true })
  interiorColorCompanyId: string | null;

  @Column({ name: 'exterior_color_platform_id', type: 'uuid', nullable: true })
  exteriorColorPlatformId: string | null;

  @Column({ name: 'exterior_color_company_id', type: 'uuid', nullable: true })
  exteriorColorCompanyId: string | null;

  // 'top_hung' | 'side_hung_left' | ... — see
  // packages/types/src/windows.ts's HingedOpeningType. Plain varchar for
  // the same reason glassKind above is — the platform enum type lives in
  // `public`, outside the tenant search_path. Nullable: only meaningful
  // once the window's frame resolves to a hinged system, and stays unset
  // until the user actually picks an icon in the Design step.
  @Column({ name: 'opening_type', type: 'varchar', length: 30, nullable: true })
  openingType: string | null;

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
