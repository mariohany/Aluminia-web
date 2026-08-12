import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A colour this company added itself, alongside the platform's shared
 * RAL catalogue (`Color`, control-plane). Lives in the TENANT schema —
 * one company's own list, invisible to every other company.
 *
 * No `lookup_meta`/version machinery, unlike the platform table — that
 * exists only to invalidate a shared Redis cache, and this is read live
 * every time (docs/company_lookups_planing.md, "Versioning").
 */
@Entity('company_color')
export class CompanyColor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 7 })
  hex: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
