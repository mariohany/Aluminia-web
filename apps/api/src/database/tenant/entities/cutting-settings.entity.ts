import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { decimalTransformer } from '../../control-plane/entities/decimal.transformer';

/**
 * The company's saw settings for the bar optimiser — one row, id 1
 * (docs/reports_planing.md §6, D7–D9). No row = `DEFAULT_CUTTING_SETTINGS`.
 * 6000/6500 are always tried and never stored; `extraLengthsMm` is only
 * what the user added. `updatedAt` is part of every report's fingerprint,
 * so saving settings makes every project's report stale.
 */
@Entity('cutting_settings')
export class CuttingSettingsRow {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Column({
    name: 'kerf_mm',
    type: 'numeric',
    precision: 3,
    scale: 1,
    default: 4,
    transformer: decimalTransformer,
  })
  kerfMm: number;

  @Column({ name: 'end_trim_mm', type: 'integer', default: 10 })
  endTrimMm: number;

  @Column({
    name: 'extra_lengths_mm',
    type: 'integer',
    array: true,
    default: () => "'{}'",
  })
  extraLengthsMm: number[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
