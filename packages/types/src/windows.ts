import { z } from 'zod'
import { scopedRefSchema } from '@repo/types/company-lookups'

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

// `panelType` is a plain string literal, not reusing `HeadShape`-style
// naming — deliberately not called `kind`, which already means
// something different (`WindowPart['kind']` in
// apps/web/src/lib/window-geometry.ts, the *drawn component* within a
// panel — 'frame'/'sash'/'glass'/'flyScreen'). This is a new,
// panel-level discriminator one level up from that.
export const PanelType = {
  WINDOW: 'window',
  TRANSOM: 'transom',
} as const
export type PanelType = (typeof PanelType)[keyof typeof PanelType]

// Shared by both branches below — everything a panel needs regardless
// of what it actually is. Not itself a schema (a bare object literal,
// spread into each branch) so each branch's own `z.object` stays the
// single source of truth for its own shape; a wrapping `.extend()`
// would work too but reads less plainly at the two call sites.
const basePanelFields = {
  xMm: z.number().int().min(0).max(MAX_DIMENSION_MM),
  yMm: z.number().int().min(0).max(MAX_DIMENSION_MM),
  widthMm: z.number().int().min(1).max(MAX_DIMENSION_MM),
  heightMm: z.number().int().min(1).max(MAX_DIMENSION_MM),
  glassKind: z.enum([GlassKind.SINGLE, GlassKind.COMBINATION]),
  glass: scopedRefSchema,
  interiorColor: scopedRefSchema.nullable().optional(),
  exteriorColor: scopedRefSchema.nullable().optional(),
}

/**
 * One panel of an assembly — a whole window unit with its own frame all
 * the way round, not a light within a shared frame. (Two lights sharing
 * one frame is what the fixed-mullion opening types already do; see
 * `splitRectWithMullion` in apps/web/src/lib/window-geometry.ts.)
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
    ...basePanelFields,
    panelType: z.literal(PanelType.WINDOW),
    frameProfile: scopedRefSchema,
    sashProfile: scopedRefSchema,
    hasFlyScreen: z.boolean(),
    isDoor: z.boolean(),
    openingType: z.enum(hingedOpeningTypeValues).nullable().optional(),
    // Required, no `.default()` — matches `hasFlyScreen`/`isDoor` right
    // above: every panel field the client can vary is required, so the
    // whole object is always a complete, self-describing panel. (A
    // `.default()` here would also fight react-hook-form's zodResolver,
    // whose input/output types genuinely disagree once a field can be
    // omitted on write but never absent on read — not worth the
    // complexity for the one caller that would ever omit it.)
    headShape: z.enum(headShapeValues),
    headRiseMm: z.number().int().min(1).max(MAX_DIMENSION_MM).nullable().optional(),
    bars: z.array(windowBarSchema).max(200),
  })
  // `.strict()` — a window panel carrying a `transomProfile` (or any
  // other stray key) is rejected outright rather than silently
  // stripped. Without it, Zod's default (strip unknown keys) would
  // undercut the whole point of the discriminated union: a client
  // could send both `sashProfile` and `transomProfile` on a `window`
  // body and get 201 back with the extra field quietly dropped,
  // masking a real client-side bug instead of surfacing it at the wire
  // boundary where it's cheap to fix.
  .strict()
  // Four cross-field rules from docs/arch_windows_planing.md §3, none of
  // which a single field's own `.min()`/`.max()` can express. NOT
  // reimplemented in windows.service.ts — these are single-panel field
  // checks the global ZodValidationPipe already fully enforces on
  // every write, and nothing calls WindowsService outside the HTTP
  // path (confirmed while building Step 6, see docs/arch_windows_
  // tasks.md's own correction there); a `validatePanelHead` was
  // planned but never written for exactly that reason. Compare
  // windows.service.ts's `normalizeHeads`, which DOES duplicate work
  // here — but that one CORRECTS a value (round's rise, and every
  // shape's rise clamped below its own height), which a validator
  // can only reject, not fix.
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
  })
export type WindowPanelWindowInput = z.infer<typeof windowPanelSchema>

/**
 * A transom — a profile plus glass, no sash, no opening leaf. See
 * docs/transom_planing.md decision 1: closer to a fixed light than a
 * shrunk window, but its "frame" is a `ProfileType.TRANSOM` profile,
 * not a `ProfileType.FRAME` one. No `hasFlyScreen`/`isDoor`/
 * `openingType` at all — not merely unset, structurally absent, since
 * a fly screen mounts to a sash and a door is a sash that swings, and
 * a transom has no sash. No `headShape`/`headRiseMm`/`bars` either —
 * arched transoms are deliberately deferred (planing doc §7); every
 * transom is flat this phase, so there is nothing for those fields to
 * describe yet.
 */
export const transomPanelSchema = z
  .object({
    ...basePanelFields,
    panelType: z.literal(PanelType.TRANSOM),
    transomProfile: scopedRefSchema,
  })
  // See windowPanelSchema's own `.strict()` just above for why: a
  // transom body carrying a `sashProfile`/`hasFlyScreen`/etc. is
  // rejected, not silently ignored.
  .strict()
export type WindowPanelTransomInput = z.infer<typeof transomPanelSchema>

// The wire/storage shape for one panel, either kind. `panelType` is
// what every downstream caller narrows on before reaching for a
// branch-only field (`sashProfile`, `transomProfile`, ...) — the
// union makes the illegal combination (a transom carrying a
// `sashProfile`, a window carrying a `transomProfile`) a compile
// error rather than merely unvalidated.
export const windowPanelInputSchema = z.discriminatedUnion('panelType', [windowPanelSchema, transomPanelSchema])
export type WindowPanelInput = z.infer<typeof windowPanelInputSchema>

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
  panels: z.array(windowPanelInputSchema).min(1),
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
  panels: z.array(windowPanelInputSchema).min(1).optional(),
  location: optionalText,
  notes: optionalText,
})
export type UpdateWindowInput = z.infer<typeof updateWindowSchema>

// Shared by both branches below — mirrors `basePanelFields` above, but
// as the READ shape (colours resolved to `string | null`, not the
// input's `ScopedRef | null | undefined`).
interface PanelDetailBase {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  glassKind: GlassKind
  glass: string
  interiorColor: string | null
  exteriorColor: string | null
}

/**
 * One panel as read back — the input shape plus nothing, since every
 * field on it is already client-resolvable. A union for the same
 * reason `WindowPanelInput` is: `panel.panelType === 'window'` narrows
 * which of `sashProfile`/`transomProfile` (etc.) is actually there,
 * same as on the way in. Named per-branch, same as the input side
 * (`WindowPanelWindowInput`/`WindowPanelTransomInput`), for every
 * caller that's window-only for now (docs/transom_tasks.md Steps 3-4,
 * 6-7 haven't landed yet) to say so directly instead of intersecting
 * `WindowPanelDetail` with `{ panelType: 'window' }` inline each time.
 */
export type WindowPanelWindowDetail = PanelDetailBase & {
  panelType: typeof PanelType.WINDOW
  frameProfile: string
  sashProfile: string
  hasFlyScreen: boolean
  isDoor: boolean
  openingType: HingedOpeningType | null
  headShape: HeadShape
  headRiseMm: number | null
  bars: WindowBarInput[]
}
export type WindowPanelTransomDetail = PanelDetailBase & {
  panelType: typeof PanelType.TRANSOM
  transomProfile: string
}
export type WindowPanelDetail = WindowPanelWindowDetail | WindowPanelTransomDetail

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
