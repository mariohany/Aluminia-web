/**
 * What `TenantGuard` resolves a request's tenant claim down to, before
 * any handler runs. Deliberately excludes anything not needed to run a
 * query — no billing, no seat counts, just enough to pick a schema.
 */
export interface ResolvedTenant {
  companyId: string;
  companyName: string;
  schemaName: string;
}
