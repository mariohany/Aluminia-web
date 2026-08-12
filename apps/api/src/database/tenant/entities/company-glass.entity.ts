import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../control-plane/entities/decimal.transformer';

/**
 * A glass product this company added itself, alongside the platform's
 * shared `Glass` catalogue. Lives in the TENANT schema.
 */
@Entity('company_glass')
export class CompanyGlass {
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
