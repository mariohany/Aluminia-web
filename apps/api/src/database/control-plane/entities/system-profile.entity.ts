import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProfileType } from '@repo/types/lookups';
import { SystemCatalog } from './system-catalog.entity';

export { ProfileType };

// A single extrusion in a catalogue. `image` is a URL — file storage
// doesn't exist in this project yet, so this column is written now but
// left unusable until that lands (Section 4, open question 5).
@Entity('system_profile')
export class SystemProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'catalog_id', type: 'uuid' })
  catalogId: string;

  @ManyToOne(() => SystemCatalog, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'catalog_id' })
  catalog?: SystemCatalog;

  @Column({ name: 'profile_no', type: 'varchar', length: 100 })
  profileNo: string;

  @Column({
    name: 'profile_type',
    type: 'enum',
    enum: ProfileType,
    enumName: 'profile_type',
  })
  profileType: ProfileType;

  @Column({ name: 'max_glass_thickness', type: 'integer' })
  maxGlassThickness: number;

  @Column({ type: 'real' })
  weight: number;

  @Column({ type: 'integer' })
  perimeter: number;

  @Column({ name: 'inertia_ix', type: 'real' })
  inertiaIx: number;

  @Column({ name: 'inertia_iy', type: 'real' })
  inertiaIy: number;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  image: string | null;

  @Column({ name: 'accepts_fly_screen', type: 'boolean', default: false })
  acceptsFlyScreen: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
