import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { CombinationItemKind, GlassGapType } from '@repo/types/lookups';
import { CompanyGlassCombination } from './company-glass-combination.entity';
import { CompanyGlass } from './company-glass.entity';
import { CompanyColor } from './company-color.entity';
import { decimalTransformer } from '../../control-plane/entities/decimal.transformer';

/**
 * The ordered, polymorphic build-up for a `CompanyGlassCombination` —
 * the same composite-PK child-table shape as the platform's
 * `GlassCombinationItem`, with one structural difference: each of its
 * three references (glass, colour, gap colour) is a platform/company
 * pair rather than a single column, since a company combination may mix
 * platform-owned and company-owned glass/colours freely
 * (docs/company_lookups_planing.md, "Cross-scope references"). Exactly
 * one side of each pair is set, enforced by the migration's
 * `CK_company_glass_combination_item_shape` CHECK — same rule the
 * platform table enforces via a single NOT NULL column.
 *
 * `kind`/`gapType` are plain `varchar`, not the platform's Postgres enum
 * types — the tenant search_path excludes `public`, where those types
 * live. Zod (`@repo/types/lookups`) is the real enforcement point for
 * the shape these strings take, same as it already is for the platform
 * table's `system_type`/`profile_type`.
 */
@Entity('company_glass_combination_item')
export class CompanyGlassCombinationItem {
  @PrimaryColumn({ name: 'combination_id', type: 'uuid' })
  combinationId: string;

  @ManyToOne(() => CompanyGlassCombination, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'combination_id' })
  combination?: CompanyGlassCombination;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({ type: 'varchar', length: 10 })
  kind: CombinationItemKind;

  @Column({ name: 'platform_glass_id', type: 'uuid', nullable: true })
  platformGlassId: string | null;

  @Column({ name: 'company_glass_id', type: 'uuid', nullable: true })
  companyGlassId: string | null;

  @ManyToOne(() => CompanyGlass, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_glass_id' })
  companyGlass?: CompanyGlass;

  @Column({ name: 'platform_color_id', type: 'uuid', nullable: true })
  platformColorId: string | null;

  @Column({ name: 'company_color_id', type: 'uuid', nullable: true })
  companyColorId: string | null;

  @ManyToOne(() => CompanyColor, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_color_id' })
  companyColor?: CompanyColor;

  @Column({ name: 'gap_type', type: 'varchar', length: 10, nullable: true })
  gapType: GlassGapType | null;

  @Column({
    name: 'gap_thickness',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  gapThickness: number | null;

  @Column({ name: 'platform_gap_color_id', type: 'uuid', nullable: true })
  platformGapColorId: string | null;

  @Column({ name: 'company_gap_color_id', type: 'uuid', nullable: true })
  companyGapColorId: string | null;

  @ManyToOne(() => CompanyColor, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_gap_color_id' })
  companyGapColor?: CompanyColor;

  @Column({ name: 'is_georgian', type: 'boolean', nullable: true })
  isGeorgian: boolean | null;

  @Column({ name: 'columns_count', type: 'integer', nullable: true })
  columnsCount: number | null;

  @Column({ name: 'rows_count', type: 'integer', nullable: true })
  rowsCount: number | null;
}
