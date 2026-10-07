import { GlassKind, HeadShape, SectionKind, type WindowDividerInput, type WindowPanelInput, type WindowSectionInput } from '@repo/types/windows'
import type { ScopedRef } from '@repo/types/company-lookups'
import type { PointMm } from '@/lib/arch-geometry'
import { pointInPolygon } from '@/lib/curves'
import {
  anchorOn,
  applyDelete,
  castRay,
  frameGeometry,
  resolveDividers,
  sortDividers,
  stretchPanel,
  type FrameGeometry,
} from '@/lib/dividers'
import { buildLightGraph, sidesOf, type Light, type LightGraph } from '@/lib/light-graph'
import type { PanelSide } from '@/lib/window-geometry'
import type { ProfileMetrics } from '@/lib/profile-metrics'

// A panel's lights, kept in step with its stored sections —
// docs/free_dividers_planing.md §5.3 and §8. Pure. Every divider edit in
// the editor ends here so the form's `sections` always has exactly one
// entry per light, in display order, keyed by `faceKey`; the drawing and
// the issues can then trust `sections[i]` to be light `i`.

/** What the light maths needs from a panel. `doorSill`: a hinged door,
 * whose opening runs to the panel's real bottom edge. */
export interface PanelLightsContext {
  metrics: Pick<ProfileMetrics, 'frameFace' | 'dividerFace'>
  doorSill: boolean
}

type PanelShape = Pick<WindowPanelInput, 'widthMm' | 'heightMm' | 'headShape' | 'headRiseMm' | 'dividers'>

export function panelGeometry(panel: PanelShape, ctx: PanelLightsContext): FrameGeometry {
  return frameGeometry({
    widthMm: panel.widthMm,
    heightMm: panel.heightMm,
    headShape: panel.headShape,
    headRiseMm: panel.headRiseMm,
    frameFace: ctx.metrics.frameFace,
    doorSill: ctx.doorSill,
    springOffsetMm: ctx.metrics.dividerFace / 2,
  })
}

export function panelLights(panel: PanelShape, ctx: PanelLightsContext): { geo: FrameGeometry; graph: LightGraph } {
  const geo = panelGeometry(panel, ctx)
  // Every divider draws with the panel's placeholder face today; a
  // divider's own profile (Q12) reaches here once profiles carry real
  // metrics (`resolveProfileMetrics`).
  const graph = buildLightGraph(geo, panel.dividers, () => ctx.metrics.dividerFace / 2)
  return { geo, graph }
}

/** An arch light other than the whole-arch one can only be fixed (Q7). */
export function isFixedOnlyLight(light: Light): boolean {
  return light.zone === 'arch' && !light.head
}

function asFixed(section: WindowSectionInput): WindowSectionInput {
  if (section.kind === SectionKind.FIXED) return section
  return {
    ...section,
    kind: SectionKind.FIXED,
    sashProfile: null,
    // Not picked yet — required to save, `''` means nothing's chosen
    // (same posture as "+ → Transom"'s new light).
    beadProfile: '' as ScopedRef,
    openingType: null,
    hasFlyScreen: false,
    sliding: null,
  }
}

/** A brand-new light nothing covered before (the strip "+" adds): fixed,
 * with the first light's glass — or none picked yet, on a panel that had
 * no section at all. */
function freshLight(source: WindowSectionInput | undefined, faceKey: string): WindowSectionInput {
  return {
    faceKey,
    kind: SectionKind.FIXED,
    sashProfile: null,
    beadProfile: '' as ScopedRef,
    openingType: null,
    glassKind: source?.glassKind ?? GlassKind.SINGLE,
    glass: source?.glass ?? ('' as ScopedRef),
    hasFlyScreen: false,
    sliding: null,
  }
}

function centroidSamples(light: Light, shift: PointMm): PointMm[] {
  const { x, y, width, height } = light.bbox
  const out: PointMm[] = []
  for (let i = 1; i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const p = { x: x + (width * i) / 8, y: y + (height * j) / 8 }
      if (pointInPolygon(p, light.polygon)) out.push({ x: p.x - shift.x, y: p.y - shift.y })
    }
  }
  return out
}

/**
 * The sections for `next`'s lights, in display order: a light whose key
 * already has a section keeps it; a new light takes the settings of the
 * old light that covered most of it (`prefer` breaks ties — the side the
 * user kept when deleting, Q18), else of a `migrated:` section (§2 step
 * 4), else is a fresh fixed light. `shift` is how far the old contents
 * moved in panel coordinates (a strip added on the top or left). Arch
 * lights are forced fixed (Q7).
 */
export function alignSections(
  sections: WindowSectionInput[],
  next: LightGraph,
  prev: LightGraph | null,
  options: { prefer?: ReadonlySet<string>; shift?: PointMm } = {},
): WindowSectionInput[] {
  const byKey = new Map(sections.map((s) => [s.faceKey, s]))
  const migrated = sections.find((s) => s.faceKey.startsWith('migrated:'))
  const shift = options.shift ?? { x: 0, y: 0 }
  const prefer = options.prefer ?? new Set<string>()
  const first = sections[0]

  return next.lights.map((light) => {
    let source = byKey.get(light.key)
    if (!source && prev) {
      const counts = new Map<string, number>()
      for (const p of centroidSamples(light, shift)) {
        for (const old of prev.lights) if (pointInPolygon(p, old.polygon)) counts.set(old.key, (counts.get(old.key) ?? 0) + 1)
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const pick = ranked.find(([key]) => prefer.has(key)) ?? ranked[0]
      if (pick) source = byKey.get(pick[0])
      else return freshLight(first, light.key)
    }
    source ??= migrated ?? first
    if (!source) return freshLight(first, light.key)
    const keyed = { ...source, faceKey: light.key }
    return isFixedOnlyLight(light) ? asFixed(keyed) : keyed
  })
}

/** Re-aligns a panel's sections after its dividers (or size, or head)
 * changed from `before`. */
export function withAlignedSections<T extends WindowPanelInput>(before: T | null, after: T, ctx: PanelLightsContext, options: { prefer?: ReadonlySet<string>; shift?: PointMm } = {}): T {
  if (!Number.isFinite(after.widthMm) || !Number.isFinite(after.heightMm)) return after
  const nextGraph = panelLights(after, ctx).graph
  const prevGraph = before && Number.isFinite(before.widthMm) && Number.isFinite(before.heightMm) ? panelLights(before, ctx).graph : null
  return { ...after, sections: alignSections(after.sections, nextGraph, prevGraph, options) }
}

// ---- Dividers in request shape ----------------------------------------------

const ZERO_CUT = { lengthMm: 0, fromLeftDeg: 0, fromRightDeg: 0, toLeftDeg: 0, toRightDeg: 0 }

export function newDivider(id: string, from: WindowDividerInput['from'], to: WindowDividerInput['to']): WindowDividerInput {
  return { id, from, to, sagMm: 0, profile: null, cut: ZERO_CUT }
}

/** The next free plain id (`d1`, `d2`, …) — ids never reuse a frame
 * side's name, nor a base whose pieces (`d1a`, `d1b`) still exist. */
export function nextDividerId(dividers: readonly { id: string }[]): string {
  const taken = new Set(dividers.map((d) => d.id.replace(/(?<=^d\d+)[a-z]+$/, '')))
  for (let i = 1; ; i++) if (!taken.has(`d${i}`)) return `d${i}`
}

/** Fills every divider's `cut` from the light graph — the report cache
 * (Q10/Q19), refreshed on every save. */
export function withCuts(panel: WindowPanelInput, ctx: PanelLightsContext): WindowPanelInput {
  if (panel.dividers.length === 0 || !Number.isFinite(panel.widthMm) || !Number.isFinite(panel.heightMm)) return panel
  const { graph } = panelLights(panel, ctx)
  const bands = new Map(graph.bands.map((b) => [b.dividerId, b]))
  return {
    ...panel,
    dividers: panel.dividers.map((d) => {
      const band = bands.get(d.id)
      if (!band) return d
      return {
        ...d,
        cut: {
          lengthMm: band.lengthMm,
          fromLeftDeg: band.ends[0].leftDeg,
          fromRightDeg: band.ends[0].rightDeg,
          toLeftDeg: band.ends[1].leftDeg,
          toRightDeg: band.ends[1].rightDeg,
        },
      }
    }),
  }
}

// ---- Panel-level operations (§8) ----------------------------------------------

/** The point where a vertical line at `x` first meets the top of the
 * opening (the head or the flat top), going up from the sill. */
function topAnchorAt(geo: FrameGeometry, x: number): WindowDividerInput['from'] | null {
  const hit = castRay(geo.members, { x, y: geo.bottomY + 0.01 }, { x: 0, y: -1 }).find((h) => h.memberId === 'head' || h.memberId === 'top')
  return hit ? anchorOn(geo, geo.members.get(hit.memberId)!, hit.point) : null
}

/**
 * "+ → Transom / Mullion" (Q20): the panel grows by `sizeMm` on `side`
 * (the caller moves it in the assembly) and one divider runs frame to
 * frame across the new strip; everything that used to land on that side
 * of the frame now lands on the new divider, so the strip is one light
 * across. Returns the new panel (sections aligned, the strip a fresh
 * fixed light) or `null` if the geometry doesn't resolve.
 */
export function addEdgeDivider<T extends WindowPanelInput>(panel: T, side: PanelSide, sizeMm: number, ctx: PanelLightsContext): T | null {
  const size = Math.round(sizeMm)
  const horizontal = side === 'top' || side === 'bottom'
  const before = panel
  const oldGeo = panelGeometry(panel, ctx)
  // Anchors are mm from the LEFT and BOTTOM: growing on those sides
  // moves every existing divider by the strip.
  let dividers = panel.dividers
  if (side === 'left') dividers = stretchPanel(oldGeo, dividers, 'x', -1, size)
  if (side === 'bottom') dividers = stretchPanel(oldGeo, dividers, 'y', -1, size)
  // A strip on top of an arched panel holds the arch: it springs from the
  // new transom's top face, today's convention (a round head can't take
  // a free rise, so it becomes segmental).
  const archOnTop = side === 'top' && panel.headShape !== HeadShape.FLAT
  const grown: T = {
    ...panel,
    widthMm: horizontal ? panel.widthMm : panel.widthMm + size,
    heightMm: horizontal ? panel.heightMm + size : panel.heightMm,
    dividers,
    ...(archOnTop
      ? {
          headShape: panel.headShape === HeadShape.ROUND ? HeadShape.SEGMENTAL : panel.headShape,
          headRiseMm: Math.max(Math.round(size - ctx.metrics.dividerFace / 2), 1),
        }
      : {}),
  }
  const geo = panelGeometry(grown, ctx)
  const id = nextDividerId(dividers)
  const frameSide = side === 'top' ? (grown.headShape === HeadShape.FLAT ? 'top' : 'head') : side === 'bottom' ? 'sill' : side
  let created: WindowDividerInput
  if (horizontal) {
    const at = side === 'top' ? panel.heightMm : size
    created = newDivider(id, { on: 'left', at }, { on: 'right', at })
  } else {
    const x = side === 'left' ? size : panel.widthMm
    const to = topAnchorAt(geo, x)
    if (!to) return null
    created = newDivider(id, { on: 'sill', at: x }, to)
  }
  // Re-anchor what stood on the old frame side onto the new divider. A
  // head anchor (a fraction) can't carry over to a straight transom —
  // those dividers are re-aimed from their other end.
  const resolvedBefore = resolveDividers(geo, dividers)
  const moved = dividers.map((d) => {
    let next = d
    for (const end of ['from', 'to'] as const) {
      if (d[end].on !== frameSide) continue
      if (frameSide === 'head') {
        const r = resolvedBefore.get(d.id)
        const p = r ? (end === 'from' ? r.from : r.to) : null
        next = p ? { ...next, [end]: { on: id, at: p.x } } : next
      } else next = { ...next, [end]: { on: id, at: d[end].at } }
    }
    return next
  })
  const sorted = sortDividers([created, ...moved])
  if (!sorted) return null
  const after: T = { ...grown, dividers: sorted }
  if (resolveDividers(geo, sorted).size !== sorted.length) return null
  const shift = { x: side === 'left' ? size : 0, y: side === 'top' ? size : 0 }
  return withAlignedSections(before, after, ctx, { shift })
}

/**
 * A panel edge moved by `delta` mm (a drag or a size input). Dividers
 * keep their place in the window: dragging the LEFT or BOTTOM edge
 * shifts the mm anchors so the lights on that side absorb it; the right
 * and top edges move nothing (Q13).
 */
export function stretchForEdge<T extends WindowPanelInput>(before: T, after: T, side: PanelSide, ctx: PanelLightsContext): T {
  if (!Number.isFinite(before.widthMm) || !Number.isFinite(before.heightMm)) return withAlignedSections(null, after, ctx)
  const geo = panelGeometry(before, ctx)
  let dividers = after.dividers
  if (side === 'left') dividers = stretchPanel(geo, dividers, 'x', -1, after.widthMm - before.widthMm)
  if (side === 'bottom') dividers = stretchPanel(geo, dividers, 'y', -1, after.heightMm - before.heightMm)
  const shift = { x: side === 'left' ? after.widthMm - before.widthMm : 0, y: side === 'top' ? after.heightMm - before.heightMm : 0 }
  return withAlignedSections(before, { ...after, dividers }, ctx, { shift })
}

/** The boundary-to-boundary size of a rectangular light: between the
 * centrelines of its dividers, or the panel's outer edge on a frame side
 * (what `sectionTooSmall` and the light's size inputs read). */
export function lightPitch(light: Light, panel: Pick<WindowPanelInput, 'widthMm' | 'heightMm'>, ctx: PanelLightsContext): { x0: number; x1: number; y0: number; y1: number } | null {
  if (!light.rect) return null
  const f = ctx.metrics.frameFace
  const h = ctx.metrics.dividerFace / 2
  const { x, y, width, height } = light.rect
  const x0 = x <= f + 0.5 ? 0 : x - h
  const x1 = x + width >= panel.widthMm - f - 0.5 ? panel.widthMm : x + width + h
  const y0 = y <= f + 0.5 ? 0 : y - h
  const y1 = y + height >= panel.heightMm - (ctx.doorSill ? 0 : f) - 0.5 ? panel.heightMm : y + height + h
  return { x0, x1, y0, y1 }
}

/**
 * A rectangular light's width or height typed in (Q14): the panel grows
 * by the difference at that light's own right/top edge — every divider
 * beyond it moves, nothing else does. The caller resizes the placement
 * (`resizePanel`, left/bottom anchored) to the returned size.
 */
export function resizeLight<T extends WindowPanelInput>(panel: T, light: Light, axis: 'x' | 'y', sizeMm: number, ctx: PanelLightsContext): T | null {
  const pitch = lightPitch(light, panel, ctx)
  if (!pitch) return null
  const current = axis === 'x' ? pitch.x1 - pitch.x0 : pitch.y1 - pitch.y0
  const delta = Math.round(sizeMm) - current
  if (delta === 0) return panel
  const geo = panelGeometry(panel, ctx)
  // x from the left: the light's right boundary; y up from the bottom:
  // its top boundary.
  const line = axis === 'x' ? pitch.x1 - 0.5 : panel.heightMm - pitch.y0 - 0.5
  const dividers = stretchPanel(geo, panel.dividers, axis, line, delta)
  const after = {
    ...panel,
    dividers,
    widthMm: axis === 'x' ? panel.widthMm + delta : panel.widthMm,
    heightMm: axis === 'y' ? panel.heightMm + delta : panel.heightMm,
  }
  return withAlignedSections(panel, after, ctx, { shift: { x: 0, y: axis === 'y' ? delta : 0 } })
}

/**
 * Switching head shape (§8). To flat: every divider standing on the head
 * re-lands on the flat top if it is a straight vertical (a mullion into
 * the arch), otherwise it goes, with whatever stood on it extended. To
 * arched: dividers on the flat top re-land on the head where their line
 * meets it.
 */
export function changeHeadShape<T extends WindowPanelInput>(panel: T, shape: HeadShape, riseMm: number | null, ctx: PanelLightsContext): T {
  const after0: T = { ...panel, headShape: shape, headRiseMm: riseMm }
  const plan = headShapePlan(panel, shape, riseMm, ctx)
  if (!plan) return withAlignedSections(panel, after0, ctx)
  const kept = plan.doomed.length > 0 ? applyDelete(plan.newGeo, plan.dividers, plan.doomed, 'extend') : plan.dividers
  return withAlignedSections(panel, { ...after0, dividers: kept }, ctx)
}

/** The dividers a head change removes — what the editor's confirmation
 * lists before `changeHeadShape` (§8). Empty when nothing goes. */
export function headShapeDoomed(panel: WindowPanelInput, shape: HeadShape, riseMm: number | null, ctx: PanelLightsContext): string[] {
  return headShapePlan(panel, shape, riseMm, ctx)?.doomed ?? []
}

// Flat ⇄ arched: a straight vertical divider on the old top/head re-lands
// on the new one; anything else touching it, and anything left in the
// arch zone of a head going flat, is doomed. `null` when the head stays
// arched (or flat) and only its shape or rise changes.
function headShapePlan(panel: WindowPanelInput, shape: HeadShape, riseMm: number | null, ctx: PanelLightsContext) {
  if ((panel.headShape === HeadShape.FLAT) === (shape === HeadShape.FLAT)) return null
  const oldGeo = panelGeometry(panel, ctx)
  const newGeo = panelGeometry({ ...panel, headShape: shape, headRiseMm: riseMm }, ctx)
  const oldResolved = resolveDividers(oldGeo, panel.dividers)
  const from = shape === HeadShape.FLAT ? 'head' : 'top'
  const to = shape === HeadShape.FLAT ? 'top' : 'head'

  const doomed: string[] = []
  const dividers = panel.dividers.map((d) => {
    let next = d
    for (const end of ['from', 'to'] as const) {
      if (d[end].on !== from) continue
      const r = oldResolved.get(d.id)
      if (!r || r.axis !== 'v') {
        doomed.push(d.id)
        continue
      }
      const anchor = topAnchorAt(newGeo, r.from.x)
      if (!anchor || anchor.on !== to) doomed.push(d.id)
      else next = { ...next, [end]: anchor }
    }
    return next
  })
  // Anything left in the arch zone can't survive a flat head.
  if (shape === HeadShape.FLAT) {
    for (const r of oldResolved.values()) if (r.axis === null) doomed.push(r.id)
  }
  return { newGeo, dividers, doomed: [...new Set(doomed)] }
}

/** The lights on each side of a divider (Q18's two choices), by key. */
export function dividerSides(panel: PanelShape, dividerId: string, ctx: PanelLightsContext): { left: string[]; right: string[] } {
  const { geo, graph } = panelLights(panel, ctx)
  return sidesOf(graph, geo, panel.dividers, dividerId)
}

/** True when every light on both sides of a divider carries the same
 * settings (everything but its `faceKey`) — then it doesn't matter which
 * side the merged light takes after, so the delete dialog skips asking. */
export function sidesMatch(panel: WindowPanelInput, sides: { left: string[]; right: string[] }): boolean {
  const config = (key: string) => {
    const section = panel.sections.find((s) => s.faceKey === key)
    if (!section) return null
    const { faceKey: _faceKey, ...rest } = section
    return canonical(rest)
  }
  const configs = [...sides.left, ...sides.right].map(config)
  return configs.length > 0 && configs.every((c) => c !== null && c === configs[0])
}

/** JSON with object keys sorted, so equal settings compare equal
 * whatever order their keys were written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

/** Deletes dividers (Q11/Q18): `mode` is what happens to the dividers
 * standing on them; the merged lights take the settings of the lights
 * in `keep` — the side the user kept. */
export function deleteDividers<T extends WindowPanelInput>(panel: T, ids: string[], ctx: PanelLightsContext, mode: 'delete' | 'extend' = 'extend', keep?: ReadonlySet<string>): T {
  const geo = panelGeometry(panel, ctx)
  const dividers = applyDelete(geo, panel.dividers, ids, mode)
  return withAlignedSections(panel, { ...panel, dividers }, ctx, { prefer: keep })
}
