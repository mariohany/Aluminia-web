import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ProfileType } from '@repo/types/lookups';
import { CompanySystemCatalog } from './company-system-catalog.entity';

/**
 * A single extrusion this company added itself, for a catalogue that
 * may be either the platform's shared `SystemCatalog` or one of this
 * company's own `CompanySystemCatalog` rows — exactly one of
 * `platformCatalogId` / `companyCatalogId` is set (migration's
 * `CK_company_system_profile_one_catalog`). See
 * `CompanyPaintingPrice`'s doc comment for why `platformCatalogId`
 * carries no foreign key.
 *
 * `profileType` is `varchar`, not the platform's Postgres enum — see
 * `CompanyGlassCombinationItem`'s doc comment.
 */
@Entity('company_system_profile')
export class CompanySystemProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'platform_catalog_id', type: 'uuid', nullable: true })
  platformCatalogId: string | null;

  @Column({ name: 'company_catalog_id', type: 'uuid', nullable: true })
  companyCatalogId: string | null;

  @ManyToOne(() => CompanySystemCatalog, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_catalog_id' })
  companyCatalog?: CompanySystemCatalog;

  @Column({ name: 'profile_no', type: 'varchar', length: 100 })
  profileNo: string;

  @Column({ name: 'profile_type', type: 'varchar', length: 20 })
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
