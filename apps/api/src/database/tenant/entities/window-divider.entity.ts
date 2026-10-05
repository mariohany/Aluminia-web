import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WindowPanel } from './window-panel.entity';

/**
 * One divider (mullion/transom, straight or curved) inside a panel —
 * docs/free_dividers_planing.md §2. Ends are anchors, not coordinates:
 * `*_on` names a side of the clear opening or another divider of the same
 * panel (`divider_key`), `*_at` is mm or a fraction depending on that
 * host. `position` is the array order, which is also the acyclicity order
 * (every end lands on a side or an EARLIER divider). The `cut_*` columns
 * are the editor's own derived saw cuts, stored for the cutting-order
 * report — never read back into geometry.
 */
@Entity('window_dividers')
export class WindowDivider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'panel_id', type: 'uuid' })
  panelId: string;

  @ManyToOne(() => WindowPanel, (panel) => panel.dividers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'panel_id' })
  panel?: WindowPanel;

  @Column({ type: 'integer' })
  position: number;

  @Column({ name: 'divider_key', type: 'varchar', length: 40 })
  dividerKey: string;

  @Column({ name: 'from_on', type: 'varchar', length: 40 })
  fromOn: string;

  @Column({ name: 'from_at', type: 'double precision' })
  fromAt: number;

  @Column({ name: 'to_on', type: 'varchar', length: 40 })
  toOn: string;

  @Column({ name: 'to_at', type: 'double precision' })
  toAt: number;

  @Column({ name: 'sag_mm', type: 'integer', default: 0 })
  sagMm: number;

  @Column({ name: 'profile_platform_id', type: 'uuid', nullable: true })
  profilePlatformId: string | null;

  @Column({ name: 'profile_company_id', type: 'uuid', nullable: true })
  profileCompanyId: string | null;

  @Column({ name: 'cut_length_mm', type: 'double precision', default: 0 })
  cutLengthMm: number;

  @Column({ name: 'cut_from_left_deg', type: 'double precision', default: 0 })
  cutFromLeftDeg: number;

  @Column({ name: 'cut_from_right_deg', type: 'double precision', default: 0 })
  cutFromRightDeg: number;

  @Column({ name: 'cut_to_left_deg', type: 'double precision', default: 0 })
  cutToLeftDeg: number;

  @Column({ name: 'cut_to_right_deg', type: 'double precision', default: 0 })
  cutToRightDeg: number;
}
