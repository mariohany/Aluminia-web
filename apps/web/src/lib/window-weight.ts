import { CombinationItemKind, GlassGapType } from '@repo/types/lookups'
import { GlassKind } from '@repo/types/windows'
import { formatScopedRef } from '@repo/types/company-lookups'
import type { MergedGlassSummary, MergedGlassCombinationSummary, MergedSystemProfileSummary } from '@/lib/lookup-merge'
import type { RectMm } from '@/lib/window-geometry'

// A sheet whose glassId no longer resolves against the merged catalogue
// (a deleted lookup) falls back to this per-mm-per-sqm estimate rather
// than dropping the sheet's weight entirely — an estimate, not a spec
// value, same posture as the sash weight check below.
const FALLBACK_KG_PER_SQM_PER_MM = 2.5
const LAMINATED_GAP_FACTOR = 1.1

export function resolveGlassWeightPerSqm(
  glassKind: GlassKind,
  glass: MergedGlassSummary | undefined,
  combination: MergedGlassCombinationSummary | undefined,
  allGlass: MergedGlassSummary[],
): number {
  if (glassKind === GlassKind.SINGLE) {
    return glass?.weightPerSqm ?? 0
  }
  if (!combination) return 0
  return combination.items.reduce((total, item) => {
    if (item.kind === CombinationItemKind.SHEET) {
      const resolved = allGlass.find((g) => formatScopedRef(g.scope, g.id) === item.glass)
      const fallback = item.glassThickness !== null ? item.glassThickness * FALLBACK_KG_PER_SQM_PER_MM : 0
      return total + (resolved?.weightPerSqm ?? fallback)
    }
    if (item.gapType === GlassGapType.LAMINATED) {
      return total + item.gapThickness * FALLBACK_KG_PER_SQM_PER_MM * LAMINATED_GAP_FACTOR
    }
    return total
  }, 0)
}

export function computeSashWeightKg(args: {
  rectMm: RectMm
  glassWeightPerSqm: number
  sashProfile: MergedSystemProfileSummary | undefined
}): number {
  const areaM2 = (args.rectMm.width / 1000) * (args.rectMm.height / 1000)
  const perimeterM = (2 * (args.rectMm.width + args.rectMm.height)) / 1000
  const profileWeightKgPerM = args.sashProfile?.weight ?? 0
  return areaM2 * args.glassWeightPerSqm + perimeterM * profileWeightKgPerM
}

export type WindowIssueSeverity = 'error' | 'warning'

export interface WindowIssue {
  partId: string
  severity: WindowIssueSeverity
  messageKey: string
  values?: Record<string, number | string>
}

/** An issue after its `messageKey`/`values` have been run through `t()` — what the drawing and the part panel actually render. `messageKey` survives translation so a consumer that already renders a given rule elsewhere (the sash panel's own weight line, for `sashWeightExceeded`) can filter it back out rather than show it twice. */
export interface TranslatedIssue {
  severity: WindowIssueSeverity
  messageKey: string
  message: string
}

/**
 * Re-expresses rules that today only exist as Step 1 helper text or
 * disabled state (frame/sash/glass required, glass thickness limit,
 * fly-screen gating) plus the new sash-weight check, keyed by the
 * drawing part they belong to. Weight is a `warning` — the sash
 * turns amber but Save still works, since it's an estimate built on
 * nominal face widths, not a spec value.
 */
export function collectWindowIssues(args: {
  frameProfile: MergedSystemProfileSummary | undefined
  sashProfile: MergedSystemProfileSummary | undefined
  hasGlass: boolean
  glassThickness: number | null
  maxGlassAllowed: number | null
  sashWeightKg: number | null
  maxSashWeight: number | null
  hasFlyScreen: boolean
  flyScreenAllowed: boolean
  sashPartIds: string[]
  glassPartIds: string[]
  flyScreenPartId: string | null
}): WindowIssue[] {
  const issues: WindowIssue[] = []

  if (!args.frameProfile) {
    issues.push({ partId: 'frame', severity: 'error', messageKey: 'frameRequired' })
  }
  if (args.frameProfile && !args.sashProfile) {
    for (const partId of args.sashPartIds) {
      issues.push({ partId, severity: 'error', messageKey: 'sashRequired' })
    }
  }
  if (args.sashProfile && !args.hasGlass) {
    for (const partId of args.glassPartIds) {
      issues.push({ partId, severity: 'error', messageKey: 'glassRequired' })
    }
  }
  if (
    args.glassThickness !== null &&
    args.maxGlassAllowed !== null &&
    args.glassThickness > args.maxGlassAllowed
  ) {
    for (const partId of args.glassPartIds) {
      issues.push({
        partId,
        severity: 'error',
        messageKey: 'glassTooThick',
        values: { thickness: args.glassThickness, max: args.maxGlassAllowed },
      })
    }
  }
  if (args.hasFlyScreen && !args.flyScreenAllowed && args.flyScreenPartId) {
    issues.push({ partId: args.flyScreenPartId, severity: 'error', messageKey: 'flyScreenNotAllowed' })
  }
  if (
    args.sashWeightKg !== null &&
    args.maxSashWeight !== null &&
    args.sashWeightKg > args.maxSashWeight
  ) {
    for (const partId of args.sashPartIds) {
      issues.push({
        partId,
        severity: 'warning',
        messageKey: 'sashWeightExceeded',
        values: { weight: Math.round(args.sashWeightKg * 10) / 10, max: args.maxSashWeight },
      })
    }
  }

  return issues
}
