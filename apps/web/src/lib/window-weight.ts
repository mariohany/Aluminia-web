import { CombinationItemKind, GlassGapType, SystemType } from '@repo/types/lookups'
import { GlassKind, HeadShape, SectionKind } from '@repo/types/windows'
import { formatScopedRef } from '@repo/types/company-lookups'
import { checkSlidingBuildable, type SlidingLayoutInput } from '@repo/types/sliding'
import type { MergedGlassSummary, MergedGlassCombinationSummary, MergedSystemProfileSummary } from '@/lib/lookup-merge'
import { MIN_GLAZED_PITCH_MM, type RectMm } from '@/lib/window-geometry'
import { outlinePerimeterMm, type HeadOutline } from '@/lib/arch-geometry'

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
 * rather than assumed — see arch_windows_tasks.md's Step 12 entry).
 * Dividers are frame members, never part of a sash, so they add nothing
 * here (glazing bars used to).
 */
export function computeSashWeightKg(args: {
  rectMm: RectMm
  glassWeightPerSqm: number
  sashProfile: MergedSystemProfileSummary | undefined
  /** The sash's own arch, if any — `undefined`/`null` (a flat sash, or
   * one this feature never touches) draws exactly the pre-existing
   * rectangular perimeter. */
  head?: { shape: HeadShape; riseMm: number } | null
}): number {
  const areaM2 = (args.rectMm.width / 1000) * (args.rectMm.height / 1000)
  const outline: HeadOutline = args.head
    ? { rect: args.rectMm, shape: args.head.shape, riseMm: args.head.riseMm }
    : { rect: args.rectMm, shape: HeadShape.FLAT, riseMm: 0 }
  const perimeterM = outlinePerimeterMm(outline) / 1000
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
  /** This section's own `kind` — decides whether a missing/present
   * `sashProfile` or `beadProfile` is what actually matters below
   * (an opening section's bead and a fixed section's sash are both
   * structurally impossible, so neither is ever checked). */
  sectionKind: SectionKind
  sashProfile: MergedSystemProfileSummary | undefined
  beadProfile: MergedSystemProfileSummary | undefined
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
  /** For `archBendRadius` (spec §5 V7): the frame head's bend radius
   * (`headBendRadiusMm`, `null` when flat) against the profile's
   * minimum. A warning while the minimum is a placeholder — the limit
   * is a guess, so a near-limit arch is "unvalidated", not "rejected";
   * an error once the profile carries its own number. */
  headBendRadiusMm: number | null
  minBendRadiusMm: number
  metricsSource: 'PLACEHOLDER' | 'PROFILE'
  /** This section's light (window-render.ts `panelIssueLights`): its
   * pitch for V2 `sectionTooSmall`, whether it can be glazed at all
   * (`lightTooSmall`), whether it may only be fixed (`archLightOpening`,
   * Q7) and whether it is the whole-arch light (V10 `archOnOpening`).
   * `null` when the panel has no real size yet. */
  light: IssueLight | null
  /** True iff this section is opening, the panel's frame resolves to a
   * HINGED system, and no `openingType` has been picked — sliding/
   * curtain-wall sections are genuinely opening with `openingType`
   * always `null` (bug-034), so the caller must already know the
   * resolved systemType before setting this; this function has no way
   * to tell the two cases apart on its own. */
  openingTypeRequired: boolean
}): WindowIssue[] {
  const issues: WindowIssue[] = []

  if (!args.frameProfile) {
    issues.push({ partId: 'frame', severity: 'error', messageKey: 'frameRequired' })
  }
  // Which profile actually governs this section depends on its kind —
  // an opening section's sash and a fixed section's bead, never the
  // other. Each has its own "missing" issue below, keyed to a part this
  // exact section actually draws — a fixed light draws no separate bead
  // PART, so bug-055 used to fall back to `framePartId` the same way
  // `sashRequired` does, but a panel's frame spans every section in it:
  // the glyph landed on the whole panel's outer corner instead of the
  // one troubled section, and the strip/part-panel below only ever read
  // sash/glass ids, so the message had nowhere to render at all. A fixed
  // section always draws its own glass part(s) even with no bead chosen
  // (window-geometry.ts's `isFixed` branch), so that's the fallback here
  // instead — keeps the error inside that one section's own footprint.
  const hasKindProfile = args.sectionKind === SectionKind.OPENING ? !!args.sashProfile : !!args.beadProfile
  if (args.frameProfile && args.sectionKind === SectionKind.OPENING && !args.sashProfile) {
    for (const partId of args.sashPartIds.length > 0 ? args.sashPartIds : [args.framePartId]) {
      issues.push({ partId, severity: 'error', messageKey: 'sashRequired' })
    }
  }
  if (args.frameProfile && args.sectionKind === SectionKind.FIXED && !args.beadProfile) {
    for (const partId of args.glassPartIds.length > 0 ? args.glassPartIds : [args.framePartId]) {
      issues.push({ partId, severity: 'error', messageKey: 'beadRequired' })
    }
  }
  // A hinged sash with no hinge style picked has nothing telling
  // hardware/BOM which way it opens — closes a gap the plan always
  // intended (see the `openingTypeRequired` doc comment above) but
  // that bug-034's fix only removed (it was written too broadly, for
  // every system type, and broke on real sliding data), never re-added
  // in its correct, narrower form. `warning`, not `error`: unlike
  // `frameRequired`/`sashRequired` above, `openingType` is nullable in
  // the Zod schema with no cross-field rule requiring it (the schema
  // has no way to resolve whether `frameProfile` is hinged — that's
  // exactly why bug-034's version was wrong) — so nothing today
  // actually rejects a save missing it, client or server. `error` here
  // would claim a rejection that doesn't happen; revisit once a
  // service-level check (§6) actually enforces it.
  if (args.openingTypeRequired) {
    for (const partId of args.sashPartIds.length > 0 ? args.sashPartIds : [args.framePartId]) {
      issues.push({ partId, severity: 'warning', messageKey: 'openingTypeRequired' })
    }
  }
  if (hasKindProfile && !args.hasGlass) {
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
  if (args.hasArchedHead && args.headBendRadiusMm !== null && args.headBendRadiusMm < args.minBendRadiusMm) {
    issues.push({
      partId: args.framePartId,
      severity: args.metricsSource === 'PLACEHOLDER' ? 'warning' : 'error',
      messageKey: 'archBendRadius',
      values: { radius: Math.round(args.headBendRadiusMm), min: args.minBendRadiusMm },
    })
  }
  // V2: a pitch under MIN_GLAZED_PITCH_MM is too narrow to glaze,
  // whichever axis it's on — checked against this section's own
  // boundary-to-boundary width, never the drawn clear size (which
  // already nets out the frame/divider face and would flag a false
  // positive on an otherwise-fine pitch). The same constant clamps
  // every live drag that can shrink a pitch (window-geometry.ts's
  // `moveDivider`/`resizePanelEdge`/`resizeSectionEdge`), so a drag can
  // no longer produce a state that immediately fails this check.
  const pitchW = args.light?.pitchWidthMm ?? null
  const pitchH = args.light?.pitchHeightMm ?? null
  if (pitchW !== null && pitchH !== null && (pitchW < MIN_GLAZED_PITCH_MM || pitchH < MIN_GLAZED_PITCH_MM)) {
    for (const partId of args.glassPartIds) {
      issues.push({
        partId,
        severity: 'error',
        messageKey: 'sectionTooSmall',
        values: { pitch: Math.round(Math.min(pitchW, pitchH)) },
      })
    }
  }
  // An arch light squeezed so tight its glass outline collapses — it
  // draws no glass part at all, so the issue lands on the frame. No
  // angle rule (Q16): only "can't be glazed" is an error.
  if (args.light && !args.light.glazable) {
    issues.push({ partId: args.framePartId, severity: 'error', messageKey: 'lightTooSmall' })
  }
  // Q7: arch lights other than the whole-arch one are fixed only.
  if (args.light?.fixedOnly && args.sectionKind === SectionKind.OPENING) {
    for (const partId of args.glassPartIds.length > 0 ? args.glassPartIds : [args.framePartId]) {
      issues.push({ partId, severity: 'error', messageKey: 'archLightOpening' })
    }
  }
  // V10: an opening sash under the springing line has to clear the
  // curve above it — flagged as a warning on the sash itself, not
  // blocking Save (the fabricator's call, same posture as archObstructed).
  if (args.light?.wholeArch && args.sectionKind === SectionKind.OPENING) {
    for (const partId of args.sashPartIds.length > 0 ? args.sashPartIds : [args.framePartId]) {
      issues.push({ partId, severity: 'warning', messageKey: 'archOnOpening' })
    }
  }

  return issues
}

/**
 * Panel-level rules that don't vary per section (spec §6 V1, V8,
 * divider and light rules, `slidingRailsRequired`) plus every section's own
 * sliding-layout rules (docs/sliding_windows_planing.md §8, per section
 * since §12) — computed once per panel by the caller, unlike
 * `collectWindowIssues` above which runs once per SECTION (calling the
 * panel-level ones from there would push one duplicate per section
 * onto the same `framePartId`).
 */
export function collectPanelIssues(args: {
  dividerProfile: string | null
  dividerCount: number
  /** Dividers that don't resolve or slant below the springing line
   * (Q2), as assembly part ids. */
  dividerProblemPartIds: string[]
  /** Every curved divider's radius, by assembly part id, against the
   * profile's minimum bend — same posture as `archBendRadius`. */
  dividerBends: { partId: string; radiusMm: number }[]
  minBendRadiusMm: number
  metricsSource: 'PLACEHOLDER' | 'PROFILE'
  /** The stored sections don't match the lights one to one — normally
   * impossible, the editor re-aligns on every edit (§5.3). */
  lightsMismatch: boolean
  /** The panel still carries a `migrated:` light — saved glazing bars
   * converted to transoms whose new lights the user hasn't checked
   * (docs/free_dividers_planing.md §2 step 4). */
  lightsChanged: boolean
  systemType: SystemType | null
  framePartId: string
  /** Whether a frame profile is actually picked — until it is,
   * `systemType` is merely "not sliding", not a fact to flag a stray
   * layout against. */
  hasFrame: boolean
  /** One entry per section, in index order (`window-render.ts`'s
   * `slidingSectionArgs`): its kind; its own stored sliding layout —
   * `null` on every non-sliding section, on a fixed sliding light, and
   * on a sliding row saved before the field existed (that last one is
   * what `slidingLayoutRequired` flags — decision 5); its sash part ids
   * in SASH INDEX order, so a per-sash build issue lands on that sash's
   * own glyph and row; and where a section-level sliding issue lands
   * (`null` → the frame). */
  sections: { kind: SectionKind; sliding: SlidingLayoutInput | null; sashPartIds: string[]; partId: string | null }[]
  /** The frame PROFILE's rail count (planing §11) — `null` when no
   * frame is picked or the profile has none (a hand-nulled row, or a
   * frame in a mis-tagged catalogue: `slidingRailsRequired`). Drives
   * `railOutOfRange` and `emptyRail`. */
  slidingRails: number | null
}): WindowIssue[] {
  const issues: WindowIssue[] = []
  // V1: a panel with dividers needs its default transom profile — also
  // a schema rule, repeated here so it highlights on the drawing.
  if (args.dividerCount > 0 && args.dividerProfile == null) {
    issues.push({ partId: args.framePartId, severity: 'error', messageKey: 'dividerProfileRequired' })
  }
  if (args.lightsMismatch) {
    issues.push({ partId: args.framePartId, severity: 'error', messageKey: 'lightsMismatch' })
  }
  if (args.lightsChanged) {
    issues.push({ partId: args.framePartId, severity: 'warning', messageKey: 'lightsChanged' })
  }
  for (const partId of args.dividerProblemPartIds) {
    issues.push({ partId, severity: 'error', messageKey: 'dividerNotSquare' })
  }
  for (const bend of args.dividerBends) {
    if (bend.radiusMm >= args.minBendRadiusMm) continue
    issues.push({
      partId: bend.partId,
      severity: args.metricsSource === 'PLACEHOLDER' ? 'warning' : 'error',
      messageKey: 'dividerBendRadius',
      values: { radius: Math.round(bend.radiusMm), min: args.minBendRadiusMm },
    })
  }

  // Sliding layouts (docs/sliding_windows_planing.md §8), one per
  // OPENING section since §12 (a sliding panel may be divided — a
  // fixed transom light above the sashes, two sliding openings side by
  // side). Presence is the EDITOR's rule (the API can't resolve a frame
  // to its system — planing's deferred-server-rule assumption); a
  // layout's own buildability is the same `checkSlidingBuildable` the
  // schema runs on save, so an error here is exactly what the API
  // would reject.
  const isSlidingFrame = args.systemType === SystemType.SLIDING
  const anyOpening = args.sections.some((s) => s.kind === SectionKind.OPENING)
  // slidingRailsRequired (planing §11): the frame profile carries the
  // rail count; a sliding frame whose profile has none can't be laid
  // out at all. Only reachable for a profile someone nulled by hand
  // (the API writes 2 by default) — flagged rather than guessed. Once
  // per panel, on the frame — it's the frame's fault, not a section's.
  if (isSlidingFrame && args.hasFrame && anyOpening && args.slidingRails == null) {
    issues.push({ partId: args.framePartId, severity: 'error', messageKey: 'slidingRailsRequired' })
  }
  for (const section of args.sections) {
    const sectionPartId = section.partId ?? args.framePartId
    if (isSlidingFrame && section.kind === SectionKind.OPENING && section.sliding == null) {
      issues.push({ partId: sectionPartId, severity: 'error', messageKey: 'slidingLayoutRequired' })
    }
    if (section.sliding != null && args.hasFrame && !isSlidingFrame) {
      issues.push({ partId: sectionPartId, severity: 'error', messageKey: 'slidingOnHinged' })
    }
    if (section.sliding == null || !isSlidingFrame) continue
    for (const issue of checkSlidingBuildable(section.sliding, args.slidingRails ?? undefined)) {
      const partId = issue.sash >= 0 ? (section.sashPartIds[issue.sash] ?? sectionPartId) : sectionPartId
      if (issue.code === 'emptyRail') {
        const empty = issue.emptyRails ?? []
        issues.push({
          partId,
          severity: 'warning',
          messageKey: 'slidingEmptyRail',
          values: { rails: empty.map((r) => r + 1).join(', '), count: empty.length, used: (issue.rails ?? 0) - empty.length },
        })
        continue
      }
      if (issue.code === 'railOutOfRange') {
        // The profile's count was lowered after this layout was saved
        // (an admin edit, planing §11 decision 13): the sash is on a
        // rail the frame no longer has. Move it, or pick a preset.
        issues.push({
          partId,
          severity: 'error',
          messageKey: 'slidingRailOutOfRange',
          values: { sash: issue.sash + 1, rail: (section.sliding.sashes[issue.sash]?.rail ?? 0) + 1, rails: issue.rails ?? 0 },
        })
        continue
      }
      issues.push({
        partId,
        severity: 'error',
        messageKey:
          issue.code === 'blocked' ? 'slidingBlocked' : issue.code === 'slidesIntoFrame' ? 'slidingIntoFrame' : 'slidingIntoNeighbour',
        values: { sash: issue.sash + 1, neighbour: (issue.neighbour ?? 0) + 1 },
      })
    }
  }

  return issues
}

/** What `collectWindowIssues` needs to know about a section's light —
 * built by window-render.ts's `panelIssueLights`. */
export interface IssueLight {
  /** Boundary-to-boundary size; `null` for a shaped arch light. */
  pitchWidthMm: number | null
  pitchHeightMm: number | null
  glazable: boolean
  fixedOnly: boolean
  wholeArch: boolean
}
