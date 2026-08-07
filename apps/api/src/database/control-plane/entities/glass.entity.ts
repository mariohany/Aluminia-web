import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from './decimal.transformer';

// A single glass product — priced and weighed per square metre, not
// per linear metre (that's the profile system's unit, not glass's).
@Entity('glass')
export class Glass {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'integer' })
  thickness: number;

  @Column({ name: 'weight_per_sqm', type: 'real' })
  weightPerSqm: number;

  @Column({
    name: 'price_per_sqm',
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  pricePerSqm: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
