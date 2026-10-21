import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { LookupSlice, staleLookupSlices, type LookupVersion } from '@repo/types/lookups'
import { getLookupVersion } from '@/lib/lookups-api'
import { getCompanyLookupVersion } from '@/lib/company-lookups-api'
import { colorsSliceKey, glassSliceKey, systemsSliceKey } from '@/lib/lookup-slices-queries'
import { companyColorsSliceKey, companyGlassSliceKey, companySystemsSliceKey } from '@/lib/company-lookups-queries'

// docs/lookup_caching_planing.md §6: the lookup slices stay in memory for
// the session; these two small version reads decide when one is out of
// date. At most every 30 min, plus on returning to the tab once that has
// passed (refetchOnWindowFocus only fires on a stale query): the super
// admin edits lookups outside working hours (D4).
const VERSION_CHECK_MS = 30 * 60_000
const versionQuery = { staleTime: VERSION_CHECK_MS, gcTime: Infinity, refetchOnWindowFocus: true } as const

const PLATFORM_SLICE_KEYS = {
  [LookupSlice.GLASS]: glassSliceKey,
  [LookupSlice.COLORS]: colorsSliceKey,
  [LookupSlice.SYSTEMS]: systemsSliceKey,
} as const
const COMPANY_SLICE_KEYS = {
  [LookupSlice.GLASS]: companyGlassSliceKey,
  [LookupSlice.COLORS]: companyColorsSliceKey,
  [LookupSlice.SYSTEMS]: companySystemsSliceKey,
} as const

type SliceKeys = typeof PLATFORM_SLICE_KEYS | typeof COMPANY_SLICE_KEYS

// The versions each held slice came with (every slice response carries them).
function heldVersions(queryClient: QueryClient, keys: SliceKeys) {
  return Object.fromEntries(
    Object.values(LookupSlice).map((slice) => [
      slice,
      queryClient.getQueryData<{ versions: Partial<LookupVersion> }>(keys[slice])?.versions,
    ]),
  )
}

// `cancelRefetch: false`: every component using lookups runs this effect
// on the same answer, and must join a refetch already under way rather
// than restart it.
function refetch(queryClient: QueryClient, keys: SliceKeys, slices: LookupSlice[]) {
  for (const slice of slices) {
    void queryClient.invalidateQueries({ queryKey: keys[slice], exact: true }, { cancelRefetch: false })
  }
}

// Called by every useMerged* hook (lookup-merge.ts); TanStack dedupes the
// two version reads to one pair for the whole tab. Never blocks a render:
// pages show the held slices and a refetch swaps them in when it lands.
export function useLookupFreshness(): void {
  const queryClient = useQueryClient()
  const platform = useQuery({ queryKey: ['lookup-versions', 'platform'], queryFn: getLookupVersion, ...versionQuery })
  const company = useQuery({ queryKey: ['lookup-versions', 'company'], queryFn: getCompanyLookupVersion, ...versionQuery })

  useEffect(() => {
    if (!platform.data) return
    const stale = staleLookupSlices(heldVersions(queryClient, PLATFORM_SLICE_KEYS), platform.data)
    if (stale.length === 0) return
    refetch(queryClient, PLATFORM_SLICE_KEYS, stale)
    // Company slices carry platform names (a company catalogue's platform
    // brand, a combination's platform glass), so any platform change
    // refetches all three. They are small.
    refetch(queryClient, COMPANY_SLICE_KEYS, Object.values(LookupSlice))
  }, [platform.data, queryClient])

  useEffect(() => {
    if (!company.data) return
    refetch(queryClient, COMPANY_SLICE_KEYS, staleLookupSlices(heldVersions(queryClient, COMPANY_SLICE_KEYS), company.data))
  }, [company.data, queryClient])
}
