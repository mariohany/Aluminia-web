import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { WindowBarInput } from '@repo/types/windows';
import { Window } from './window.entity';
import { WindowSection } from './window-section.entity';

/**
 * One panel of a window assembly — a whole unit with its own frame all
 * the way round, coupled to its neighbours along a shared edge. See
 * docs/window_assembly_planing.md and, for the grid inside a panel,
 * docs/sections_planing.md.
 *
 * This holds everything shared by the WHOLE frame — profile, divider,
 * grid, head, is-door, colours; `Window` keeps only the header (name,
 * quantity, location, notes, and the derived overall size). What
 * varies per-light (sash, opening type, glass, fly screen) lives on
 * `sections`, one row per grid cell — see `WindowSection`. Every
 * lookup reference is the same nullable platform/company uuid pair
 * `Window` used to carry, with the same strict posture — CHECK that at
 * most/exactly one half is set, real FK on the company half — because a
 * panel whose profile vanished is broken data, not a stale preference.
 *
 * `xMm`/`yMm` place the panel in the assembly's own mm space, origin at
 * the bounding box's top-left. The remaining assembly invariants (no
 * overlap, every panel edge-connected) live in `WindowsService`, not in
 * a CHECK: they are relationships between rows, which a row-scoped
 * constraint cannot see. Likewise the grid's own cross-row rules
 * (`columnWidths`/`rowHeights` summing to `widthMm`/`heightMm`, every
 * cell covered by exactly one section) live in Zod's
 * `windowPanelSchema.superRefine`, re-checked server-side by
 * `validateGrid`.
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

  // One `ProfileType.TRANSOM` profile used by every mullion/transom in
  // this panel (docs/sections_planing.md decision 4). At most one half
  // set (`CK_window_panels_divider_profile`); required iff the grid is
  // bigger than 1×1 is a service rule (`validateGrid`) — a CHECK can't
  // see `columnWidths`/`rowHeights`' jsonb lengths.
  @Column({ name: 'divider_platform_profile_id', type: 'uuid', nullable: true })
  dividerPlatformProfileId: string | null;

  @Column({ name: 'divider_company_profile_id', type: 'uuid', nullable: true })
  dividerCompanyProfileId: string | null;

  // Boundary-to-boundary pitches, row-major, summing to `widthMm`/
  // `heightMm` respectively — NOT clear glass sizes (those derive from
  // `ProfileMetrics` at layout time). jsonb, same posture as `bars`
  // below: an ordered list whose own shape (summing correctly, one
  // section per cell) isn't expressible as a CHECK and lives in
  // `WindowsService.validateGrid` / Zod's `superRefine` instead.
  @Column({
    name: 'column_widths',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  columnWidths: number[];

  @Column({ name: 'row_heights', type: 'jsonb', default: () => "'[]'::jsonb" })
  rowHeights: number[];

  @OneToMany(() => WindowSection, (section) => section.panel, { cascade: true })
  sections?: WindowSection[];

  @Column({ name: 'is_door', type: 'boolean', default: false })
  isDoor: boolean;

  @Column({ name: 'interior_color_platform_id', type: 'uuid', nullable: true })
  interiorColorPlatformId: string | null;

  @Column({ name: 'interior_color_company_id', type: 'uuid', nullable: true })
  interiorColorCompanyId: string | null;

  @Column({ name: 'exterior_color_platform_id', type: 'uuid', nullable: true })
  exteriorColorPlatformId: string | null;

  @Column({ name: 'exterior_color_company_id', type: 'uuid', nullable: true })
  exteriorColorCompanyId: string | null;

  // 'flat' | 'round' | 'segmental' | 'gothic' — see
  // packages/types/src/windows.ts's HeadShape. Plain varchar, not a
  // Postgres enum: the platform enums live in `public`, which the
  // tenant search_path excludes. `headRiseMm` is null iff this is
  // 'flat' — enforced by the migration's CHECK, re-checked in
  // WindowsService.validatePanelHead rather than trusted from either.
  @Column({ name: 'head_shape', type: 'varchar', length: 12, default: 'flat' })
  headShape: string;

  @Column({ name: 'head_rise_mm', type: 'integer', nullable: true })
  headRiseMm: number | null;

  // Freely-drawn bars inside the head — see docs/arch_windows_planing.md
  // §2's "why references, not coordinates". A jsonb column rather than
  // a child table (planing doc decision 10): unlike every profile/glass
  // reference above, a bar's own internal shape (unique ids, anchors
  // only referencing something earlier in the array) can't be expressed
  // as a CHECK, so that validation lives entirely in
  // WindowsService.validatePanelHead.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  bars: WindowBarInput[];

  // The sliding layout (`sliding` jsonb) lived here from
  // AddPanelSlidingLayout until MoveSlidingLayoutToSections — it's on
  // `window_sections` now (docs/sliding_windows_planing.md §12), so a
  // sliding panel can carry dividers.
}
