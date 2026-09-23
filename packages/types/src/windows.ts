import { z } from 'zod'
import { scopedRefSchema } from '@repo/types/company-lookups'
import { slidingLayoutSchema, type SlidingLayoutInput } from '@repo/types/sliding'

// Not a relative './company-lookups' import — packages/types has no
// build step, and a relative cross-file import to a sibling that
// exports real runtime values (not just types) breaks `nest start
// --watch` with ERR_MODULE_NOT_FOUND while check-types stays green.
// See docs/window_creation_planing.md Section 1's trap and
// .wolf/cerebrum.md's Do-Not-Repeat, 2026-08-12 and 2026-08-15.

const optionalText = z.string().trim().min(1).nullable().optional()

// A window's glass is either a single sheet or a build-up combination —
// see docs/window_creation_planing.md Section 2's "why glass is four
// columns" for the storage-layer reason this needs to be known at all;
// at the wire boundary it's just this discriminator plus one ScopedRef.
export const GlassKind = {
  SINGLE: 'single',
  COMBINATION: 'combination',
} as const
export type GlassKind = (typeof GlassKind)[keyof typeof GlassKind]

// How a hinged window's sash actually opens (or doesn't) — drawn on the
// elevation (apps/web/src/components/workspace/window-drawing.tsx) from
// the icon the user picked in the Design step's "Type" grid. Only
// meaningful for `systemType === 'hinged'`; sliding/curtain_wall windows
// leave this `null` (sliding gets its own icon set later, not this
// one — see docs/window_design_planing.md). Values mirror the 16 source
// icons 1:1, not a smaller derived set, even though a few pairs render
// identically today (double_door_french_a/b and double_door_handles_a/b
// are byte-identical source SVGs) and single_door_hinge_left/right draw
// with the exact same symbol as side_hung_left/right — "Is door" already
// handles the sill difference, so this field doesn't duplicate it.
export const HingedOpeningType = {
  TOP_HUNG: 'top_hung',
  FIXED_CLOSED: 'fixed_closed',
  SIDE_HUNG_LEFT: 'side_hung_left',
  SIDE_HUNG_RIGHT: 'side_hung_right',
  TILT_TURN_LEFT: 'tilt_turn_left',
  TILT_TURN_RIGHT: 'tilt_turn_right',
  PIVOT_BOTTOM: 'pivot_bottom',
  PIVOT_SIDE: 'pivot_side',
  DOUBLE_DOOR_FRENCH_A: 'double_door_french_a',
  DOUBLE_DOOR_FRENCH_B: 'double_door_french_b',
  SINGLE_DOOR_HINGE_LEFT: 'single_door_hinge_left',
  SINGLE_DOOR_HINGE_RIGHT: 'single_door_hinge_right',
  DOUBLE_DOOR_HANDLES_A: 'double_door_handles_a',
  DOUBLE_DOOR_HANDLES_B: 'double_door_handles_b',
  FIXED_VERTICAL_MULLION: 'fixed_vertical_mullion',
  FIXED_HORIZONTAL_MULLION: 'fixed_horizontal_mullion',
} as const
export type HingedOpeningType = (typeof HingedOpeningType)[keyof typeof HingedOpeningType]
const hingedOpeningTypeValues = Object.values(HingedOpeningType) as [HingedOpeningType, ...HingedOpeningType[]]

// The largest single dimension any panel (and therefore any assembly)
// may claim. Shared by every mm field below so a resize and a create
// can't disagree about the ceiling.
const MAX_DIMENSION_MM = 100000

// What a panel's top edge does — see docs/arch_windows_planing.md §1.
// `flat` is every panel this product could draw before this feature;
// `round` is a true semicircle (its rise gets normalised to
// `widthMm / 2` server-side, so a client sending anything else for
// `round` doesn't get a second, disagreeing shape); `segmental` is the
// same construction with a free rise; `gothic` is two arcs meeting at
// a point. apps/web/src/lib/arch-geometry.ts imports this rather than
// keeping its own copy — one source of truth for the four strings,
// same posture as `HingedOpeningType` below.
export const HeadShape = {
  FLAT: 'flat',
  ROUND: 'round',
  SEGMENTAL: 'segmental',
  GOTHIC: 'gothic',
} as const
export type HeadShape = (typeof HeadShape)[keyof typeof HeadShape]
const headShapeValues = Object.values(HeadShape) as [HeadShape, ...HeadShape[]]

// An endpoint names what it's attached to, not a coordinate — the
// head curve (`'arch'`), the springing line (`'sill'`), or an earlier
// bar in the same panel's `bars` array (its id). `at` is a `0..1`
// fraction along whichever of those it is, always measured the same
// way regardless of anchor kind, so one field means "how far along"
// no matter what's being measured. See §2's "why references, not
// coordinates" — this is the one modelling choice a dependent
// following its parent, and a delete cascading, both hang off.
export const barAnchorSchema = z.object({
  on: z.string().min(1),
  at: z.number().min(0).max(1),
})
export type BarAnchorInput = z.infer<typeof barAnchorSchema>

// A bar is a line or a circular arc — never a free-form curve, since a
// spline has no single bend radius and so no cut length a work order
// can print. `sagMm` is what's stored rather than radius: it stays
// finite and well-behaved as a bar flattens (a straight bar is simply
// `0`), where radius runs to infinity there. See
// arch-geometry.ts's `radiusFromSag`/`sagFromRadius` for the two-way
// binding the UI shows the user.
export const windowBarSchema = z.object({
  id: z.string().min(1).max(40),
  from: barAnchorSchema,
  to: barAnchorSchema,
  sagMm: z.number().int().min(-MAX_DIMENSION_MM).max(MAX_DIMENSION_MM),
})
export type WindowBarInput = z.infer<typeof windowBarSchema>

// A section is fixed (bead + glass straight off the frame/divider) or
// opening (sash + opening type + glass) — see
// docs/sections_planing.md's vocabulary. Not reusing `PanelType`'s old
// two-value shape: this discriminates a *cell inside a panel's grid*,
// not a panel itself — `PanelType` (and the coupled-transom panel it
// named) is gone; see docs/sections_planing.md decision 3.
export const SectionKind = {
  FIXED: 'fixed',
  OPENING: 'opening',
} as const
export type SectionKind = (typeof SectionKind)[keyof typeof SectionKind]

// One cell of a panel's grid (`row`/`col`, both 0-based, row-major —
// see windowPanelSchema's `columnWidths`/`rowHeights`). Everything that
// varies per-light lives here now; everything shared by the whole
// frame (profile, divider, grid, head, colours) stays on the panel —
// docs/sections_planing.md decision 7.
export const windowSectionSchema = z
  .object({
    row: z.number().int().min(0),
    col: z.number().int().min(0),
    kind: z.enum([SectionKind.FIXED, SectionKind.OPENING]),
    sashProfile: scopedRefSchema.nullable(),
    // A fixed light's glass sits straight in a glazing bead rather than
    // a sash — required exactly when `kind === 'fixed'`, the mirror
    // image of `sashProfile`'s "required exactly when opening" rule
    // below. Existing rows from before this field existed can still
    // have `null` here (the DB CHECK tolerates it — see the
    // AddSectionBeadProfile migration's own comment); this schema is
    // what actually blocks a SAVE until one is picked.
    beadProfile: scopedRefSchema.nullable(),
    openingType: z.enum(hingedOpeningTypeValues).nullable(),
    glassKind: z.enum([GlassKind.SINGLE, GlassKind.COMBINATION]),
    glass: scopedRefSchema,
    hasFlyScreen: z.boolean(),
    // A sliding section's sashes — docs/sliding_windows_planing.md §12
    // (moved here from the panel 2026-09-20 so a sliding panel can be
    // divided: a transom light above a sliding opening, two sliding
    // openings side by side — each section is fixed or sliding on its
    // own). Non-null exactly when this section is an opening light in
    // a SLIDING system; null for every hinged / curtain-wall section
    // AND for a fixed sliding light (decision 6 — "fixed" is the kind,
    // not a layout). Whether a sliding opening section is REQUIRED to
    // carry one is the editor's rule (it needs the frame profile's
    // systemType, same deferral as the hinged openingType rule); this
    // schema only checks the blob's own shape and that it isn't on a
    // fixed section. Legacy sliding sections from before this field
    // read back `null` and are flagged, not backfilled (decision 5).
    sliding: slidingLayoutSchema.nullable(),
  })
  .strict()
export type WindowSectionInput = z.infer<typeof windowSectionSchema>

/**
 * One panel of an assembly — a whole window unit with its own frame all
 * the way round, not a light within a shared frame. A panel with more
 * than one section is exactly what the old coupled fixed-mullion
 * opening types and the old coupled transom panel both used to fake —
 * see docs/sections_planing.md for why this replaces both.
 *
 * `xMm`/`yMm` place the panel in the assembly's own mm space, origin at
 * the bounding box's top-left. The server re-normalises that origin on
 * write, so a client that sends panels offset from (0,0) gets them
 * shifted rather than rejected — there is exactly one stored
 * representation of a given assembly.
 *
 * See docs/window_assembly_planing.md §1 for the four invariants the
 * API enforces over a set of these (at least one panel; no overlap;
 * every panel edge-connected; origin normalised) and for why a
 * *non-rectangular* outline is deliberately legal.
 */
export const windowPanelSchema = z
  .object({
    xMm: z.number().int().min(0).max(MAX_DIMENSION_MM),
    yMm: z.number().int().min(0).max(MAX_DIMENSION_MM),
    widthMm: z.number().int().min(1).max(MAX_DIMENSION_MM),
    heightMm: z.number().int().min(1).max(MAX_DIMENSION_MM),
    frameProfile: scopedRefSchema,
    // Required iff the grid is bigger than 1×1 — one divider profile
    // used by every mullion/transom in this panel (docs/sections_planing.md
    // decision 4, rejecting a per-divider profile).
    dividerProfile: scopedRefSchema.nullable(),
    // Boundary-to-boundary pitches, row-major, summing to `widthMm` /
    // `heightMm` respectively — NOT clear glass sizes, which derive
    // from `ProfileMetrics` at layout time so a placeholder change
    // never moves a stored dimension (decision 8).
    columnWidths: z.array(z.number().int().min(1).max(MAX_DIMENSION_MM)).min(1).max(12),
    rowHeights: z.array(z.number().int().min(1).max(MAX_DIMENSION_MM)).min(1).max(12),
    sections: z.array(windowSectionSchema).min(1).max(144),
    isDoor: z.boolean(),
    interiorColor: scopedRefSchema.nullable().optional(),
    exteriorColor: scopedRefSchema.nullable().optional(),
    headShape: z.enum(headShapeValues),
    headRiseMm: z.number().int().min(1).max(MAX_DIMENSION_MM).nullable().optional(),
    bars: z.array(windowBarSchema).max(200),
    // The sliding layout lives on each SECTION (`windowSectionSchema`),
    // not here — planing §12.
  })
  // A panel carrying a stray key (e.g. a leftover `panelType` from a
  // pre-sections client) is rejected outright rather than silently
  // stripped — same reasoning `windowPanelSchema` always had, just
  // without a union to guard against now.
  .strict()
  // Cross-field rules from docs/sections_planing.md Section 1, none of
  // which a single field's own `.min()`/`.max()` can express. NOT
  // reimplemented in windows.service.ts — these are single-panel field
  // checks the global ZodValidationPipe already fully enforces on
  // every write, and nothing calls WindowsService outside the HTTP
  // path (confirmed while building the arch-windows feature; see
  // docs/arch_windows_tasks.md's own correction there). Compare
  // windows.service.ts's `normalizeHeads`, which DOES duplicate work
  // here — but that one CORRECTS a value (round's rise, and every
  // shape's rise clamped below its own height), which a validator can
  // only reject, not fix.
  .superRefine((panel, ctx) => {
    const hasRise = panel.headRiseMm != null
    if (panel.headShape === HeadShape.FLAT && hasRise) {
      ctx.addIssue({ code: 'custom', path: ['headRiseMm'], message: 'A flat head has no rise.' })
    }
    if (panel.headShape !== HeadShape.FLAT && !hasRise) {
      ctx.addIssue({ code: 'custom', path: ['headRiseMm'], message: 'A non-flat head needs a rise.' })
    }
    if (panel.headShape === HeadShape.FLAT && panel.bars.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['bars'], message: 'Bars only belong on a non-flat head.' })
    }

    // A bar may only reference the head, the springing line, or a bar
    // EARLIER in this same array — that ordering rule is the whole
    // acyclicity guarantee (see arch-bars.ts's `barsAreOrdered`), so
    // this one pass both catches a forward/self reference and proves
    // the rest of the array is a DAG.
    const earlierIds = new Set<string>()
    panel.bars.forEach((bar, index) => {
      if (earlierIds.has(bar.id)) {
        ctx.addIssue({ code: 'custom', path: ['bars', index, 'id'], message: `Duplicate bar id "${bar.id}" in this panel.` })
      }
      for (const end of ['from', 'to'] as const) {
        const anchor = bar[end]
        if (anchor.on !== 'arch' && anchor.on !== 'sill' && !earlierIds.has(anchor.on)) {
          ctx.addIssue({
            code: 'custom',
            path: ['bars', index, end, 'on'],
            message: `Bar "${bar.id}" anchors to "${anchor.on}", which is not the head, the springing line, or an earlier bar in this panel.`,
          })
        }
      }
      earlierIds.add(bar.id)
    })

    // The grid itself: pitches must account for the whole panel, and
    // every cell they imply must have exactly one section describing
    // it — see docs/sections_planing.md's V8 `gridMismatch` (this is
    // that same rule enforced at write time, not just flagged live in
    // the editor).
    const cols = panel.columnWidths.length
    const rows = panel.rowHeights.length
    const widthSum = panel.columnWidths.reduce((sum, w) => sum + w, 0)
    if (widthSum !== panel.widthMm) {
      ctx.addIssue({
        code: 'custom',
        path: ['columnWidths'],
        message: `Column widths sum to ${widthSum}, not the panel width ${panel.widthMm}.`,
      })
    }
    const heightSum = panel.rowHeights.reduce((sum, h) => sum + h, 0)
    if (heightSum !== panel.heightMm) {
      ctx.addIssue({
        code: 'custom',
        path: ['rowHeights'],
        message: `Row heights sum to ${heightSum}, not the panel height ${panel.heightMm}.`,
      })
    }

    if (panel.sections.length !== cols * rows) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `Expected ${cols * rows} sections for a ${cols}×${rows} grid, got ${panel.sections.length}.`,
      })
    } else {
      const seen = new Set<string>()
      panel.sections.forEach((section, index) => {
        if (section.row >= rows || section.col >= cols) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', index],
            message: `Section (${section.row}, ${section.col}) is outside the ${cols}×${rows} grid.`,
          })
          return
        }
        const key = `${section.row}:${section.col}`
        if (seen.has(key)) {
          ctx.addIssue({ code: 'custom', path: ['sections', index], message: `Duplicate section at (${section.row}, ${section.col}).` })
        }
        seen.add(key)
      })
    }

    // A divider profile is required exactly when there's a divider to
    // make (decision 4); a 1×1 panel has none to profile.
    const isGridded = cols > 1 || rows > 1
    if (isGridded && panel.dividerProfile == null) {
      ctx.addIssue({ code: 'custom', path: ['dividerProfile'], message: 'A panel split into more than one section needs a divider profile.' })
    }
    if (!isGridded && panel.dividerProfile != null) {
      ctx.addIssue({ code: 'custom', path: ['dividerProfile'], message: 'A single-section panel has no divider.' })
    }

    // Per-section kind rules (decision 6 / decision 11): opening needs
    // a sash; fixed has neither a sash nor an opening type nor a fly
    // screen. `openingType` is NOT required just because a section is
    // opening — it's a `HingedOpeningType`, meaningful only once this
    // panel's frame resolves to a hinged system (same posture the
    // panel-level field always had: "required iff opening (hinged)",
    // Section 1's own field comment). A sliding or curtain-wall
    // section is genuinely "opening" (it has a sash) with no opening
    // type at all — real data, confirmed the hard way when the
    // sections migration's stricter CHECK rejected exactly this shape
    // for a live tenant (2026-09-13, see .wolf/buglog.json). Whether a
    // HINGED opening section needs one picked is a service-level rule
    // (it needs the resolved frame profile's systemType, which isn't a
    // field on this row), not something this schema can decide.
    panel.sections.forEach((section, index) => {
      if (section.kind === SectionKind.OPENING) {
        if (section.sashProfile == null) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'sashProfile'], message: 'An opening section needs a sash profile.' })
        }
        if (section.beadProfile != null) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'beadProfile'], message: 'An opening section has no glass beading profile.' })
        }
      } else {
        if (section.sashProfile != null) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'sashProfile'], message: 'A fixed section has no sash profile.' })
        }
        if (section.beadProfile == null) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'beadProfile'], message: 'A fixed section needs a glass beading profile.' })
        }
        if (section.openingType != null) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'openingType'], message: 'A fixed section has no opening type.' })
        }
        if (section.hasFlyScreen) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'hasFlyScreen'], message: 'A fixed section cannot have a fly screen.' })
        }
        // A sliding layout describes an OPENING light — a fixed section
        // has no sashes to lay out (sliding decision 6). Since §12 a
        // gridded panel may well be sliding: each section on its own.
        if (section.sliding != null) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'sliding'], message: 'A fixed section has no sliding sashes.' })
        }
      }
    })

    // Arch + grid interaction (decision 5): dividers only run under an
    // arch as transoms, never as mullions, and a Round head's rise is
    // pinned to half the width so it can't survive a second row.
    if (panel.headShape !== HeadShape.FLAT && cols > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['headShape'],
        message: 'An arched head needs a single column — vertical dividers are not supported under an arch.',
      })
    }
    if (panel.headShape === HeadShape.ROUND && rows > 1) {
      ctx.addIssue({ code: 'custom', path: ['headShape'], message: 'A round head needs a single row: its rise is fixed at half the width.' })
    }
    if (rows > 1 && panel.headShape !== HeadShape.FLAT && panel.headRiseMm !== panel.rowHeights[0]) {
      ctx.addIssue({
        code: 'custom',
        path: ['headRiseMm'],
        message: `With more than one row, the stored rise must equal the top row's pitch (${panel.rowHeights[0]}).`,
      })
    }
  })
export type WindowPanelInput = z.infer<typeof windowPanelSchema>

// `projectId` is create-only, deliberately — a window cannot be moved
// between projects once it exists, for the same reason a project can't
// be moved between clients (createProjectSchema's own comment): window
// designs and paperwork hang off it and would silently travel with it.
// It is absent from `updateWindowSchema` below, not merely ignored.
//
// There is no `widthMm`/`heightMm` here: an assembly's overall size is
// DERIVED from its panels' bounding box, server-side. Accepting one
// would let a client claim a size its own panels contradict, and the
// two would then disagree forever. `WindowSummary` still exposes them,
// because a canvas card shouldn't have to read panels to draw a label.
export const createWindowSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(255),
  quantity: z.number().int().min(1),
  panels: z.array(windowPanelSchema).min(1),
  location: optionalText,
  notes: optionalText,
})
export type CreateWindowInput = z.infer<typeof createWindowSchema>

// Every field optional so the same endpoint serves a rename, a
// re-quantity, or a whole redesign — no `projectId`, see above.
//
// `panels`, when present, REPLACES the entire set rather than merging
// into it. The dialog always submits the complete design, so a partial
// merge would only add a way for the two sides to disagree about which
// panels still exist.
export const updateWindowSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  quantity: z.number().int().min(1).optional(),
  panels: z.array(windowPanelSchema).min(1).optional(),
  location: optionalText,
  notes: optionalText,
})
export type UpdateWindowInput = z.infer<typeof updateWindowSchema>

/**
 * One section as read back — the input shape plus nothing, since every
 * reference is already client-resolvable (mirrors `windowSectionSchema`,
 * same reasoning `WindowPanelDetail` below has for the panel).
 */
export interface WindowSectionDetail {
  row: number
  col: number
  kind: SectionKind
  sashProfile: string | null
  beadProfile: string | null
  openingType: HingedOpeningType | null
  glassKind: GlassKind
  glass: string
  hasFlyScreen: boolean
  sliding: SlidingLayoutInput | null
}

/**
 * One panel as read back — the input shape plus nothing, since every
 * reference is already client-resolvable. No longer a union:
 * `PanelType`/the coupled transom panel are gone (docs/sections_planing.md
 * decision 3) — every panel is this one shape, with `sections`
 * carrying what used to vary between the two branches.
 */
export interface WindowPanelDetail {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  frameProfile: string
  dividerProfile: string | null
  columnWidths: number[]
  rowHeights: number[]
  sections: WindowSectionDetail[]
  isDoor: boolean
  interiorColor: string | null
  exteriorColor: string | null
  headShape: HeadShape
  headRiseMm: number | null
  bars: WindowBarInput[]
}

/**
 * What a canvas card needs, and nothing more.
 */
export interface WindowSummary {
  id: string
  name: string
  /** Derived from the panels' bounding box — see createWindowSchema. */
  widthMm: number
  heightMm: number
  quantity: number
  /**
   * Every panel, in stored order — the canvas card draws a small static
   * elevation of the whole assembly, which needs the same geometry and
   * references the design dialog uses.
   *
   * Deliberately the full set rather than a `panelCount` plus a lazy
   * per-card fetch: the list query already loads these rows (it has to
   * resolve the first panel's frame and glass anyway), so returning
   * them costs nothing server-side, and the alternative is one detail
   * request per card.
   *
   * There is no separate `panelCount` — it would be `panels.length`
   * written twice, and two copies of one fact can disagree.
   */
  panels: WindowPanelDetail[]
  // Enough for a canvas card without a second round trip for the
  // detail view: the frame's profile number and the glass's name, both
  // resolved client-side against the merged catalogue the card grid
  // already subscribes to (same posture as WindowDetail below — the
  // API never resolves a display name itself).
  //
  // These four are the FIRST PANEL's, not the assembly's — an assembly
  // has no single frame or glass. The card's own elevation is what
  // shows the rest.
  frameProfile: string
  glassKind: GlassKind
  glass: string
  hasFlyScreen: boolean
  isDoor: boolean
}

/**
 * `GET /windows/:id` — everything the design dialog shows.
 *
 * Every reference is a raw `ScopedRef` string, not a resolved display
 * name — same reasoning as `ProjectDetail`: the caller already holds
 * the full merged catalogue (apps/web/src/lib/lookup-merge.ts) for
 * every screen that shows these, so resolving a name here would mean
 * every window read reaching into two schemas for a value the client
 * can already derive for free.
 */
export interface WindowDetail extends WindowSummary {
  projectId: string
  location: string | null
  notes: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
}
