import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per tenant schema, recording which company that schema belongs
 * to. Three jobs:
 *
 *  1. Gives the tenant migration track a real table to create, so
 *     provisioning is verifiable rather than a no-op.
 *  2. Defence in depth for tenant isolation: code that resolves a schema
 *     can cross-check this `companyId` against the JWT's claim. If they
 *     ever disagree, something is badly wrong and the request should
 *     fail closed rather than serve another manufacturer's data.
 *  3. Gives Phase 6's isolation test genuinely distinguishable per-tenant
 *     data to assert against.
 */
@Entity('tenant_info')
export class TenantInfo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid', unique: true })
  companyId: string;

  // Denormalised copy of the control-plane name — purely so someone
  // poking at a schema directly can tell whose it is without a join.
  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({
    name: 'provisioned_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  provisionedAt: Date;
}
