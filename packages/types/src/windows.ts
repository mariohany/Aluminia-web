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
export const windowPanelSchema = z.object({
  xMm: z.number().int().min(0).max(MAX_DIMENSION_MM),
  yMm: z.number().int().min(0).max(MAX_DIMENSION_MM),
  widthMm: z.number().int().min(1).max(MAX_DIMENSION_MM),
  heightMm: z.number().int().min(1).max(MAX_DIMENSION_MM),
  frameProfile: scopedRefSchema,
  sashProfile: scopedRefSchema,
  hasFlyScreen: z.boolean(),
  isDoor: z.boolean(),
  glassKind: z.enum([GlassKind.SINGLE, GlassKind.COMBINATION]),
  glass: scopedRefSchema,
  openingType: z.enum(hingedOpeningTypeValues).nullable().optional(),
  interiorColor: scopedRefSchema.nullable().optional(),
  exteriorColor: scopedRefSchema.nullable().optional(),
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
 * One panel as read back — the input shape plus nothing, since every
 * field on it is already client-resolvable.
 */
export type WindowPanelDetail = Required<
  Pick<
    WindowPanelInput,
    'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'frameProfile' | 'sashProfile' | 'hasFlyScreen' | 'isDoor' | 'glassKind' | 'glass'
  >
> & {
  openingType: HingedOpeningType | null
  interiorColor: string | null
  exteriorColor: string | null
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
