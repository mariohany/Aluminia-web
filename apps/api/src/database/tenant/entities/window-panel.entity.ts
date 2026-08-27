import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Window } from './window.entity';

/**
 * One panel of a window assembly — a whole unit with its own frame all
 * the way round, coupled to its neighbours along a shared edge. See
 * docs/window_assembly_planing.md.
 *
 * This holds everything that describes how a unit is BUILT; `Window`
 * keeps only the header (name, quantity, location, notes, and the
 * derived overall size). Every lookup reference is the same nullable
 * platform/company uuid pair `Window` used to carry, with the same
 * strict posture — CHECK that exactly one half is set, real FK on the
 * company half — because a panel whose profile vanished is broken data,
 * not a stale preference.
 *
 * `xMm`/`yMm` place the panel in the assembly's own mm space, origin at
 * the bounding box's top-left. The remaining assembly invariants (no
 * overlap, every panel edge-connected) live in `WindowsService`, not in
 * a CHECK: they are relationships between rows, which a row-scoped
 * constraint cannot see.
 */
@Entity('window_panels')
export class WindowPanel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'window_id', type: 'uuid' })
  windowId: string;

  @ManyToOne(() => Window, (window) => window.panels, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'window_id' })
  window?: Window;

  /** 0-based, gap-free within one window. Index 0 is the panel
   * `WindowSummary` reports as "the" frame/glass. */
  @Column({ type: 'integer' })
  position: number;

  @Column({ name: 'x_mm', type: 'integer', default: 0 })
  xMm: number;

  @Column({ name: 'y_mm', type: 'integer', default: 0 })
  yMm: number;

  @Column({ name: 'width_mm', type: 'integer' })
  widthMm: number;

  @Column({ name: 'height_mm', type: 'integer' })
  heightMm: number;

  @Column({ name: 'frame_platform_profile_id', type: 'uuid', nullable: true })
  framePlatformProfileId: string | null;

  @Column({ name: 'frame_company_profile_id', type: 'uuid', nullable: true })
  frameCompanyProfileId: string | null;

  @Column({ name: 'sash_platform_profile_id', type: 'uuid', nullable: true })
  sashPlatformProfileId: string | null;

  @Column({ name: 'sash_company_profile_id', type: 'uuid', nullable: true })
  sashCompanyProfileId: string | null;

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

  // 'top_hung' | 'side_hung_left' | ... — see
  // packages/types/src/windows.ts's HingedOpeningType. Plain varchar for
  // the same reason glassKind above is. Nullable: only meaningful once
  // this panel's frame resolves to a hinged system, and stays unset
  // until the user actually picks an icon in the Type grid.
  @Column({ name: 'opening_type', type: 'varchar', length: 30, nullable: true })
  openingType: string | null;

  @Column({ name: 'interior_color_platform_id', type: 'uuid', nullable: true })
  interiorColorPlatformId: string | null;

  @Column({ name: 'interior_color_company_id', type: 'uuid', nullable: true })
  interiorColorCompanyId: string | null;

  @Column({ name: 'exterior_color_platform_id', type: 'uuid', nullable: true })
  exteriorColorPlatformId: string | null;

  @Column({ name: 'exterior_color_company_id', type: 'uuid', nullable: true })
  exteriorColorCompanyId: string | null;
}
