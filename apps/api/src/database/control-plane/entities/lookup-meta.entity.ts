import { Column, Entity, PrimaryColumn } from 'typeorm';
import { LookupEntity } from '@repo/types/lookups';

export { LookupEntity };

// One row per entity (see LookupEntity), not a single global row —
// `version` is bumped by the bump_lookup_version() trigger attached to
// every lookup table, parametrized per table to update only its own
// row (see the migration). Never written directly from application
// code.
@Entity('lookup_meta')
export class LookupMeta {
  @PrimaryColumn({
    type: 'enum',
    enum: LookupEntity,
    enumName: 'lookup_entity',
  })
  id: LookupEntity;

  @Column({ type: 'integer', default: 1 })
  version: number;
}
