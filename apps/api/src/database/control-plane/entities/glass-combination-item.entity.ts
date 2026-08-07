import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CombinationItemKind, GlassGapType } from '@repo/types/lookups';
import { GlassCombination } from './glass-combination.entity';
import { Glass } from './glass.entity';
import { Color } from './color.entity';
import { decimalTransformer } from './decimal.transformer';

export { CombinationItemKind, GlassGapType };

// The ordered, polymorphic build-up as a real child table (composite PK
// on combinationId+position) rather than a jsonb column — that's what
// makes glassId/colorId/gapColorId enforced foreign keys (ON DELETE
// RESTRICT), not just advisory. `position` is 0-based and is itself part
// of the data: swapping two rows changes the physical unit. The two
// CHECK constraints in the migration (sheet vs. gap shape, Georgian
// fields only under `spacer`) mean an invalid row can't exist in the
// database even if application code has a bug.
@Entity('glass_combination_item')
export class GlassCombinationItem {
  @PrimaryColumn({ name: 'combination_id', type: 'uuid' })
  combinationId: string;

  @ManyToOne(() => GlassCombination, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'combination_id' })
  combination?: GlassCombination;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({
    type: 'enum',
    enum: CombinationItemKind,
    enumName: 'combination_item_kind',
  })
  kind: CombinationItemKind;

  @Column({ name: 'glass_id', type: 'uuid', nullable: true })
  glassId: string | null;

  @ManyToOne(() => Glass, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'glass_id' })
  glass?: Glass;

  @Column({ name: 'color_id', type: 'uuid', nullable: true })
  colorId: string | null;

  @ManyToOne(() => Color, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'color_id' })
  color?: Color;

  @Column({
    name: 'gap_type',
    type: 'enum',
    enum: GlassGapType,
    enumName: 'glass_gap_type',
    nullable: true,
  })
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

  @Column({ name: 'gap_color_id', type: 'uuid', nullable: true })
  gapColorId: string | null;

  @ManyToOne(() => Color, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'gap_color_id' })
  gapColor?: Color;

  @Column({ name: 'is_georgian', type: 'boolean', nullable: true })
  isGeorgian: boolean | null;

  @Column({ name: 'columns_count', type: 'integer', nullable: true })
  columnsCount: number | null;

  @Column({ name: 'rows_count', type: 'integer', nullable: true })
  rowsCount: number | null;
}
