import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The company's letterhead (docs/company_profile_planing.md, Config ›
 * Company profile): one row, `id = 1`. Not to be confused with aluminium
 * profiles (`CompanySystemProfile`). No row = defaults, see
 * CompanyProfileService.
 */
@Entity('company_profile')
export class CompanyProfileRow {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Column({ name: 'en_name', type: 'varchar', length: 255 })
  enName: string;

  @Column({ name: 'ar_name', type: 'varchar', length: 255, nullable: true })
  arName: string | null;

  @Column({ name: 'en_address', type: 'varchar', length: 500, nullable: true })
  enAddress: string | null;

  @Column({ name: 'ar_address', type: 'varchar', length: 500, nullable: true })
  arAddress: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ name: 'tax_id', type: 'varchar', length: 60, nullable: true })
  taxId: string | null;

  @Column({
    name: 'commercial_register',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  commercialRegister: string | null;

  // A `files` id (control plane), attached through FilesService.
  @Column({ name: 'logo_file_id', type: 'uuid', nullable: true })
  logoFileId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
