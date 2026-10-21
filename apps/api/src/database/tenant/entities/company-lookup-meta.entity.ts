import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { LookupEntity } from '@repo/types/lookups';

/**
 * The version of each of the company's own lookup entities, bumped by a
 * statement trigger on every write to its table (migration
 * 1792460000000-AddCompanyLookupVersions). Read only — never write it
 * from code. docs/lookup_caching_planing.md §5.2.
 */
@Entity('company_lookup_meta')
export class CompanyLookupMeta {
  @PrimaryColumn({ type: 'text' })
  id: LookupEntity;

  @Column({ type: 'integer' })
  version: number;
}
