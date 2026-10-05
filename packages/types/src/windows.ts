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

// A divider is one member of transom profile inside a frame — straight,
// or (in the arch only) a circular arc — drawn point to point
// (docs/free_dividers_planing.md §1). Each end names what it lands on: a
// side of the clear opening, or a divider EARLIER in the same panel's
// `dividers` array (that ordering is the whole acyclicity guarantee).
// `at` is mm on a straight vertical/horizontal member — from the panel's
// LEFT edge on a horizontal one, UP FROM ITS BOTTOM edge on a vertical one,
// so a resize keeps dividers where they were — and a 0..1 fraction of
// length on the head or on a slanted/curved divider. Which of the two it
// is follows from the host, which is why it's one number, not a union.
export const FrameMember = {
  LEFT: 'left',
  RIGHT: 'right',
  SILL: 'sill',
  TOP: 'top',
  HEAD: 'head',
} as const
export type FrameMember = (typeof FrameMember)[keyof typeof FrameMember]
const frameMemberValues = Object.values(FrameMember) as string[]

export const dividerAnchorSchema = z
  .object({
    on: z.string().min(1).max(40),
    at: z.number().min(0).max(MAX_DIMENSION_MM),
  })
  .strict()
export type DividerAnchorInput = z.infer<typeof dividerAnchorSchema>

// The saw cuts and length the editor derived on save — a cache for the
// cutting-order report (Q10/Q19), never read back into geometry. Per end
// AND per side: a fan hub end is a mitre on one side and the transom face
// on the other.
export const dividerCutSchema = z
  .object({
    lengthMm: z.number().min(0).max(MAX_DIMENSION_MM * 2),
    fromLeftDeg: z.number().min(0).max(90),
    fromRightDeg: z.number().min(0).max(90),
    toLeftDeg: z.number().min(0).max(90),
    toRightDeg: z.number().min(0).max(90),
  })
  .strict()
export type DividerCutInput = z.infer<typeof dividerCutSchema>

export const windowDividerSchema = z
  .object({
    id: z.string().min(1).max(40),
    from: dividerAnchorSchema,
    to: dividerAnchorSchema,
    // `0` = straight. Signed bow (sagitta) of the arc, never a radius —
    // it stays finite as a divider flattens. Same convention arch bars
    // had, so converted bars keep their exact shape.
    sagMm: z.number().int().min(-MAX_DIMENSION_MM).max(MAX_DIMENSION_MM),
    // `null` = the panel's `dividerProfile` (Q12).
    profile: scopedRefSchema.nullable(),
    cut: dividerCutSchema,
  })
  .strict()
export type WindowDividerInput = z.infer<typeof windowDividerSchema>

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

// One light of a panel — a closed area its frame and dividers make. It is
// identified by `faceKey`: the sorted ids of the members around it,
// joined by `|` (apps/web/src/lib/light-graph.ts), so moving a divider
// never loses a light's settings. Everything that varies per light lives
// here; everything shared by the whole frame stays on the panel.
export const windowSectionSchema = z
  .object({
    faceKey: z.string().min(1).max(400),
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
    // The panel's default transom profile — required iff it has any
    // divider; each divider may override it (Q12).
    dividerProfile: scopedRefSchema.nullable(),
    dividers: z.array(windowDividerSchema).max(200),
    sections: z.array(windowSectionSchema).min(1).max(200),
    isDoor: z.boolean(),
    interiorColor: scopedRefSchema.nullable().optional(),
    exteriorColor: scopedRefSchema.nullable().optional(),
    headShape: z.enum(headShapeValues),
    headRiseMm: z.number().int().min(1).max(MAX_DIMENSION_MM).nullable().optional(),
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

    // Dividers: unique ids; every end on a side of THIS head shape's
    // opening (`top` only when flat, `head` only when arched) or on an
    // EARLIER divider — the ordering rule is what makes the graph a DAG.
    // Geometry (that an end really lies on its host, that the rect zone
    // is square) needs the arch maths only apps/web has; the editor
    // checks it (docs/free_dividers_planing.md's assumptions).
    const sides = new Set<string>([FrameMember.LEFT, FrameMember.RIGHT, FrameMember.SILL, panel.headShape === HeadShape.FLAT ? FrameMember.TOP : FrameMember.HEAD])
    const earlierIds = new Set<string>()
    panel.dividers.forEach((divider, index) => {
      if (earlierIds.has(divider.id) || frameMemberValues.includes(divider.id)) {
        ctx.addIssue({ code: 'custom', path: ['dividers', index, 'id'], message: `Divider id "${divider.id}" is a duplicate or a frame side's name.` })
      }
      for (const end of ['from', 'to'] as const) {
        const anchor = divider[end]
        if (!sides.has(anchor.on) && !earlierIds.has(anchor.on)) {
          ctx.addIssue({
            code: 'custom',
            path: ['dividers', index, end, 'on'],
            message: `Divider "${divider.id}" lands on "${anchor.on}", which is not a side of this opening or an earlier divider.`,
          })
        }
      }
      earlierIds.add(divider.id)
    })
    if (panel.dividers.length > 0 && panel.dividerProfile == null) {
      ctx.addIssue({ code: 'custom', path: ['dividerProfile'], message: 'A panel with dividers needs a default transom profile.' })
    }

    // Sections: one per light, keyed by the members around it. Every
    // token must be a side or a divider of this panel; that the keys
    // match the lights one-to-one is the editor's `lightsMismatch`.
    const seenKeys = new Set<string>()
    panel.sections.forEach((section, index) => {
      if (seenKeys.has(section.faceKey)) {
        ctx.addIssue({ code: 'custom', path: ['sections', index, 'faceKey'], message: `Duplicate light "${section.faceKey}".` })
      }
      seenKeys.add(section.faceKey)
      for (const token of section.faceKey.split('#')[0].split('|')) {
        if (!sides.has(token) && !earlierIds.has(token)) {
          ctx.addIssue({ code: 'custom', path: ['sections', index, 'faceKey'], message: `Light "${section.faceKey}" names "${token}", which is not in this panel.` })
        }
      }
    })

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
  faceKey: string
  kind: SectionKind
  sashProfile: string | null
  beadProfile: string | null
  openingType: HingedOpeningType | null
  glassKind: GlassKind
  glass: string
  hasFlyScreen: boolean
  sliding: SlidingLayoutInput | null
}

/** One divider as read back — the input shape, profile as a raw ref. */
export interface WindowDividerDetail {
  id: string
  from: DividerAnchorInput
  to: DividerAnchorInput
  sagMm: number
  profile: string | null
  cut: DividerCutInput
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
  dividers: WindowDividerDetail[]
  sections: WindowSectionDetail[]
  isDoor: boolean
  interiorColor: string | null
  exteriorColor: string | null
  headShape: HeadShape
  headRiseMm: number | null
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
