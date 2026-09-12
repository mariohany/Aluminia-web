import { CombinationItemKind, GlassGapType } from '@repo/types/lookups'
import { GlassKind, HeadShape, type WindowBarInput } from '@repo/types/windows'
import { formatScopedRef } from '@repo/types/company-lookups'
import type { MergedGlassSummary, MergedGlassCombinationSummary, MergedSystemProfileSummary } from '@/lib/lookup-merge'
import type { RectMm } from '@/lib/window-geometry'
import { outlinePerimeterMm, type HeadOutline } from '@/lib/arch-geometry'
import { barLengthMm } from '@/lib/arch-bars'

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

/**
 * A real correction, not just an addition (arch_windows_planing.md
 * §7): the old `2 · (width + height) / 1000` perimeter is simply wrong
 * once a head is arched — the curve is longer than the two rect edges
 * it replaces. `outlinePerimeterMm` folds that in (and reduces to
 * exactly the old formula for a `flat` head, verified explicitly
 * rather than assumed — see arch_windows_tasks.md's Step 12 entry),
 * plus the sum of every bar's own `barCutLengthMm` — a glazing bar is
 * cut from the same kind of extrusion as the sash, so it goes into the
 * same per-metre weight rather than needing a rate of its own.
 */
export function computeSashWeightKg(args: {
  rectMm: RectMm
  glassWeightPerSqm: number
  sashProfile: MergedSystemProfileSummary | undefined
  /** The sash's own arch, if any — `undefined`/`null` (a flat sash, or
   * one this feature never touches) draws exactly the pre-existing
   * rectangular perimeter. */
  head?: { shape: HeadShape; riseMm: number } | null
  bars?: WindowBarInput[]
}): number {
  const areaM2 = (args.rectMm.width / 1000) * (args.rectMm.height / 1000)
  const outline: HeadOutline = args.head
    ? { rect: args.rectMm, shape: args.head.shape, riseMm: args.head.riseMm }
    : { rect: args.rectMm, shape: HeadShape.FLAT, riseMm: 0 }
  const bars = args.bars ?? []
  const barsMm = bars.reduce((total, bar) => total + (barLengthMm(bar, bars, outline) ?? 0), 0)
  const perimeterM = (outlinePerimeterMm(outline) + barsMm) / 1000
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

/** Collapses issues that already read identically (a fly-screen and a
 * glass rule that both happen to translate to the same sentence, say)
 * to one line — a plain data utility, not a component, so it lives
 * here rather than in `window-part-panel.tsx` alongside the section
 * components that call it (that file also exports React components;
 * co-exporting a non-component value there trips oxlint's
 * `react-refresh/only-export-components`). */
export function dedupeIssues(issues: TranslatedIssue[]): TranslatedIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    if (seen.has(issue.message)) return false
    seen.add(issue.message)
    return true
  })
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
  /** For `archObstructed` — the real `p{panelIndex}:frame` id (not the
   * bare `'frame'` `frameRequired` uses above; that's a pre-existing
   * quirk this feature doesn't touch), so the issue is navigable to
   * the actual panel it's about. */
  framePartId: string
  hasArchedHead: boolean
  /** Precomputed by the caller — this function has no visibility into
   * OTHER panels' placement, only this one's own fields. */
  hasPanelOnTop: boolean
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
  // §7: a panel resting on an arched panel's own curved head carves a
  // void inside the assembly rather than at its outline. Amber, Save
  // stays enabled — same posture as `irregularOutline`: a legal thing
  // to fabricate, and the fabricator's call, not the software's.
  if (args.hasArchedHead && args.hasPanelOnTop) {
    issues.push({ partId: args.framePartId, severity: 'warning', messageKey: 'archObstructed' })
  }

  return issues
}

/**
 * The transom counterpart to `collectWindowIssues` — deliberately a
 * SEPARATE function, not a branch merged into that one (docs/
 * transom_planing.md §6): the subset of the four window-panel rules
 * that actually apply to a transom — profile required, glass required,
 * glass too thick. No sash/fly-screen/opening-type/weight-exceeded
 * rules, because a transom has none of those fields (or a
 * `maxSashWeight` ceiling — that comes from the FRAME catalogue, which
 * a transom has none of) to be wrong about.
 *
 * `glassPartId` is singular, not an array — unlike a window (whose
 * fixed-mullion opening types can split one sash's glass into two
 * panes), `buildTransomLayout` always emits exactly one `glass-0` part.
 *
 * `transomProfileRequired`'s issue uses the same fixed `'frame'`
 * partId `collectWindowIssues`'s own `frameRequired` does, for the
 * same reason: it's a whole-panel requirement with no single drawn
 * part id that's obviously "the" one before a profile is even picked.
 * Still shows in the issue strip below the drawing; just isn't
 * click-to-select navigable, same pre-existing quirk, not a new one.
 */
export function collectTransomIssues(args: {
  transomProfile: MergedSystemProfileSummary | undefined
  hasGlass: boolean
  glassThickness: number | null
  maxGlassAllowed: number | null
  glassPartId: string
}): WindowIssue[] {
  const issues: WindowIssue[] = []

  if (!args.transomProfile) {
    issues.push({ partId: 'frame', severity: 'error', messageKey: 'transomProfileRequired' })
  }
  if (args.transomProfile && !args.hasGlass) {
    issues.push({ partId: args.glassPartId, severity: 'error', messageKey: 'transomGlassRequired' })
  }
  if (args.glassThickness !== null && args.maxGlassAllowed !== null && args.glassThickness > args.maxGlassAllowed) {
    issues.push({
      partId: args.glassPartId,
      severity: 'error',
      messageKey: 'transomGlassTooThick',
      values: { thickness: args.glassThickness, max: args.maxGlassAllowed },
    })
  }

  return issues
}
