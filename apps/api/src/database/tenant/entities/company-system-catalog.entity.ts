import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SystemType } from '@repo/types/lookups';
import { CompanySystemBrand } from './company-system-brand.entity';

/**
 * A system catalogue this company defined itself, for a brand that may
 * be either the platform's shared `SystemBrand` or one of this
 * company's own `CompanySystemBrand` rows — exactly one of
 * `platformBrandId` / `companyBrandId` is set (migration's
 * `CK_company_system_catalog_one_brand`). See
 * `CompanyPaintingPrice`'s doc comment for why `platformBrandId` carries
 * no foreign key.
 *
 * `systemType` is `varchar`, not the platform's Postgres enum — see
 * `CompanyGlassCombinationItem`'s doc comment.
 */
@Entity('company_system_catalog')
export class CompanySystemCatalog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'platform_brand_id', type: 'uuid', nullable: true })
  platformBrandId: string | null;

  @Column({ name: 'company_brand_id', type: 'uuid', nullable: true })
  companyBrandId: string | null;

  @ManyToOne(() => CompanySystemBrand, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_brand_id' })
  companyBrand?: CompanySystemBrand;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'system_type', type: 'varchar', length: 20 })
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
