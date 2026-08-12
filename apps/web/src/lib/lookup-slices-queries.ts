import { useQuery } from '@tanstack/react-query'
import * as api from '@/lib/lookup-slices-api'

// `['lookups', 'slice', X]`, not `['lookups', X]` — the admin queries in
// lookups-queries.ts already own `['lookups', 'colors']` etc. for their
// own differently-shaped per-entity fetches (a flat ColorSummary[] vs.
// this slice's { versions, data: { colors, brands, prices } }); reusing
// that key here would silently collide the two caches. Both still fall
// under the same `['lookups']` prefix, so the bulk-action invalidation
// in LookupTableSection (`invalidateQueries({ queryKey: ['lookups'] })`)
// still retires this cache too when an admin edits the platform catalogue.
export function useGlassSliceQuery() {
  return useQuery({ queryKey: ['lookups', 'slice', 'glass'], queryFn: api.getGlassSlice })
}
export function useColorsSliceQuery() {
  return useQuery({ queryKey: ['lookups', 'slice', 'colors'], queryFn: api.getColorsSlice })
}
export function useSystemsSliceQuery() {
  return useQuery({ queryKey: ['lookups', 'slice', 'systems'], queryFn: api.getSystemsSlice })
}
