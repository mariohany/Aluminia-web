import { LookupSlice } from '@repo/types/lookups'
import type { ColorLookups, GlassLookups, LookupVersion, SystemLookups } from '@repo/types/lookups'
import { apiFetch } from '@/lib/api-client'

// GET /lookups/:slice — the read-only union any authenticated user can
// call (lookups.controller.ts has no @Roles guard and no tenant
// routing), unlike lookups-api.ts's admin.* fetchers, which hit
// /admin/lookups/* and 403 for anyone but SUPER_ADMIN. This is the
// workspace Data section's only read path.
export interface LookupSliceResponse<T> {
  versions: Partial<LookupVersion>
  data: T
}

export function getGlassSlice(): Promise<LookupSliceResponse<GlassLookups>> {
  return apiFetch(`/lookups/${LookupSlice.GLASS}`)
}
export function getColorsSlice(): Promise<LookupSliceResponse<ColorLookups>> {
  return apiFetch(`/lookups/${LookupSlice.COLORS}`)
}
export function getSystemsSlice(): Promise<LookupSliceResponse<SystemLookups>> {
  return apiFetch(`/lookups/${LookupSlice.SYSTEMS}`)
}
