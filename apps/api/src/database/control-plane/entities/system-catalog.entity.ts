import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SystemType } from '@repo/types/lookups';
import { SystemBrand } from './system-brand.entity';

export { SystemType };

// One series from a brand. `maxGlassThickness`/`maxSashWeight` are the
// limits a chosen glass combination and sash have to be checked against
// when window designs land — that check is application-level validation,
// not expressible as a foreign key, so it lives in code, not here.
@Entity('system_catalog')
export class SystemCatalog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'brand_id', type: 'uuid' })
  brandId: string;

  @ManyToOne(() => SystemBrand, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'brand_id' })
  brand?: SystemBrand;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    name: 'system_type',
    type: 'enum',
    enum: SystemType,
    enumName: 'system_type',
  })
  systemType: SystemType;

  @Column({ name: 'max_glass_thickness', type: 'integer' })
  maxGlassThickness: number;

  @Column({ name: 'max_sash_weight', type: 'integer' })
  maxSashWeight: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
