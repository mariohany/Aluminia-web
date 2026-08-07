import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ColorBrand } from './color-brand.entity';
import { decimalTransformer } from './decimal.transformer';

// Flat pricing, deliberately not keyed by a specific Color: every RAL
// from a brand costs the same at a given finish (Section 4 decision).
// `type` stays a free string, not an enum — the actual finish values
// are still an open question, so encoding a guessed enum here would
// bake in an unconfirmed assumption.
@Entity('color_price')
export class ColorPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'brand_id', type: 'uuid' })
  brandId: string;

  @ManyToOne(() => ColorBrand, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'brand_id' })
  brand?: ColorBrand;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
