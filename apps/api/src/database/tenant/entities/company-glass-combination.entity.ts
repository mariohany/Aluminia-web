import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A glass build-up this company defined itself, alongside the
 * platform's shared `GlassCombination` catalogue. Lives in the TENANT
 * schema. `totalThickness` is deliberately not a column here, same as
 * the platform version — it's the sum of this combination's items,
 * computed on read.
 */
@Entity('company_glass_combination')
export class CompanyGlassCombination {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
