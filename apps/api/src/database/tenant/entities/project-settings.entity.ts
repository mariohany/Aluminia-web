import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Config › Project settings: the defaults a NEW project starts with
 * (docs/project_settings_planing.md S2, S3), one row, id 1, seeded by the
 * migration. Copied into the new-project dialog; never applied to an
 * existing project. The system refs are the same soft platform/company
 * pairs as on `projects` (no CHECK, no FK).
 */
@Entity('project_settings')
export class ProjectSettingsRow {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Column({
    name: 'default_system_platform_brand_id',
    type: 'uuid',
    nullable: true,
  })
  defaultSystemPlatformBrandId: string | null;

  @Column({
    name: 'default_system_company_brand_id',
    type: 'uuid',
    nullable: true,
  })
  defaultSystemCompanyBrandId: string | null;

  @Column({
    name: 'default_system_platform_catalog_id',
    type: 'uuid',
    nullable: true,
  })
  defaultSystemPlatformCatalogId: string | null;

  @Column({
    name: 'default_system_company_catalog_id',
    type: 'uuid',
    nullable: true,
  })
  defaultSystemCompanyCatalogId: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
