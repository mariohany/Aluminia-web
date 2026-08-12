import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CompanyPaintBrand } from './company-paint-brand.entity';
import { decimalTransformer } from '../../control-plane/entities/decimal.transformer';

/**
 * A painting price this company set itself, for a brand that may be
 * either the platform's shared `PaintBrand` or one of this company's own
 * `CompanyPaintBrand` rows — exactly one of `platformBrandId` /
 * `companyBrandId` is set, enforced by the migration's
 * `CK_company_painting_price_one_brand` CHECK.
 *
 * `platformBrandId` carries no foreign key on purpose: a cross-schema FK
 * would let this one tenant, among up to 250, block a super admin's
 * delete of a platform brand. See
 * docs/company_lookups_planing.md's "Accepted risks" #1 — a dangling
 * `platformBrandId` is surfaced on read as unavailable, never prevented.
 */
@Entity('company_painting_price')
export class CompanyPaintingPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'platform_brand_id', type: 'uuid', nullable: true })
  platformBrandId: string | null;

  @Column({ name: 'company_brand_id', type: 'uuid', nullable: true })
  companyBrandId: string | null;

  @ManyToOne(() => CompanyPaintBrand, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_brand_id' })
  companyBrand?: CompanyPaintBrand;

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
