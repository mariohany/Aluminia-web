import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WindowPanel } from './window-panel.entity';
import type { SlidingLayoutInput } from '@repo/types/sliding';

/**
 * One light of a panel — a closed area its frame and dividers make —
 * either fixed (bead + glass straight off the frame/divider) or opening
 * (sash + opening type + glass). See docs/free_dividers_planing.md.
 * `face_key` is the light's identity (the sorted ids of the members
 * around it, so moving a divider never loses its settings); `position`
 * is the editor's display order. A panel with no dividers still has
 * exactly one of these.
 *
 * What varies per light (sash, opening type, glass, fly screen,
 * sliding layout) lives here; the frame profile, the default divider
 * profile, the dividers themselves and the head stay on the panel.
 */
@Entity('window_sections')
export class WindowSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'panel_id', type: 'uuid' })
  panelId: string;

  @ManyToOne(() => WindowPanel, (panel) => panel.sections, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'panel_id' })
  panel?: WindowPanel;

  /** 0-based, row-major within one panel. */
  /** Display order (top to bottom, then left to right) as the editor
   * sent it — docs/free_dividers_planing.md §4.2. */
  @Column({ type: 'integer' })
  position: number;

  /** The light's identity: sorted ids of the members around it. */
  @Column({ name: 'face_key', type: 'varchar', length: 400 })
  faceKey: string;

  // 'fixed' | 'opening' — see packages/types/src/windows.ts's
  // SectionKind. Plain varchar, same posture as glassKind/openingType
  // elsewhere on this table family.
  @Column({ name: 'section_kind', type: 'varchar', length: 10 })
  sectionKind: string;

  // Required exactly when `sectionKind === 'opening'` — enforced by
  // the migration's `CK_window_sections_sash_by_kind`.
  @Column({ name: 'sash_platform_profile_id', type: 'uuid', nullable: true })
  sashPlatformProfileId: string | null;

  @Column({ name: 'sash_company_profile_id', type: 'uuid', nullable: true })
  sashCompanyProfileId: string | null;

  // Required exactly when `sectionKind === 'fixed'` by Zod
  // (packages/types/src/windows.ts) — but NOT by a DB CHECK on this
  // pair the way the sash one above is, since rows written before this
  // column existed are still `NULL` here and must keep loading. See
  // the AddSectionBeadProfile migration's own comment.
  @Column({ name: 'bead_platform_profile_id', type: 'uuid', nullable: true })
  beadPlatformProfileId: string | null;

  @Column({ name: 'bead_company_profile_id', type: 'uuid', nullable: true })
  beadCompanyProfileId: string | null;

  // 'top_hung' | 'side_hung_left' | ... — see
  // packages/types/src/windows.ts's HingedOpeningType. Null iff fixed.
  @Column({ name: 'opening_type', type: 'varchar', length: 30, nullable: true })
  openingType: string | null;

  // 'single' | 'combination' — see packages/types/src/windows.ts's
  // GlassKind.
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

  // Fixed-only-by-Zod, not by a DB CHECK — see the migration's own
  // comment for why (a fixed section can't have one, but that rule
  // crosses no rows and the ZodValidationPipe already fully enforces
  // it on every write).
  @Column({ name: 'has_fly_screen', type: 'boolean', default: false })
  hasFlyScreen: boolean;

  // A sliding section's sashes — docs/sliding_windows_planing.md §12
  // (on the panel until 2026-09-20; moved here so a sliding panel can
  // be divided). jsonb for the same reason as the panel's `bars`: its
  // rules relate sashes to each other and to the frame's rail count,
  // which a CHECK can't express, so they live in `slidingLayoutSchema`
  // and the migration's CHECK only guards the shape. NULL for every
  // non-sliding section, for a FIXED sliding light (decision 6), and
  // for every sliding section written before the column existed —
  // those are flagged in the editor, never backfilled (decision 5).
  @Column({ type: 'jsonb', nullable: true })
  sliding: SlidingLayoutInput | null;
}
