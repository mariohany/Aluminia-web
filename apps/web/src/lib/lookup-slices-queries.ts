import { useQuery } from '@tanstack/react-query'
import * as api from '@/lib/lookup-slices-api'

// `['lookups', 'slice', X]`, not `['lookups', X]` — the admin queries in
// lookups-queries.ts already own `['lookups', 'colors']` etc. for their
// own differently-shaped per-entity fetches (a flat ColorSummary[] vs.
// this slice's { versions, data: { colors, brands, prices } }); reusing
// that key here would silently collide the two caches.
export const glassSliceKey = ['lookups', 'slice', 'glass'] as const
export const colorsSliceKey = ['lookups', 'slice', 'colors'] as const
export const systemsSliceKey = ['lookups', 'slice', 'systems'] as const

// Kept in memory for the whole session and only fetched again when a
// version check says the slice changed (useLookupFreshness,
// docs/lookup_caching_planing.md §6). Logout clears it (auth-context.tsx).
export const lookupSliceCache = { staleTime: Infinity, gcTime: Infinity } as const

export function useGlassSliceQuery() {
  return useQuery({ queryKey: glassSliceKey, queryFn: api.getGlassSlice, ...lookupSliceCache })
}
export function useColorsSliceQuery() {
  return useQuery({ queryKey: colorsSliceKey, queryFn: api.getColorsSlice, ...lookupSliceCache })
}
export function useSystemsSliceQuery() {
  return useQuery({ queryKey: systemsSliceKey, queryFn: api.getSystemsSlice, ...lookupSliceCache })
}
