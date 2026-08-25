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

// `projectId` is create-only, deliberately — a window cannot be moved
// between projects once it exists, for the same reason a project can't
// be moved between clients (createProjectSchema's own comment): window
// designs and paperwork hang off it and would silently travel with it.
// It is absent from `updateWindowSchema` below, not merely ignored.
export const createWindowSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(255),
  frameProfile: scopedRefSchema,
  sashProfile: scopedRefSchema,
  widthMm: z.number().int().min(1).max(100000),
  heightMm: z.number().int().min(1).max(100000),
  quantity: z.number().int().min(1),
  hasFlyScreen: z.boolean(),
  isDoor: z.boolean(),
  glassKind: z.enum([GlassKind.SINGLE, GlassKind.COMBINATION]),
  glass: scopedRefSchema,
  openingType: z.enum(hingedOpeningTypeValues).nullable().optional(),
  interiorColor: scopedRefSchema.nullable().optional(),
  exteriorColor: scopedRefSchema.nullable().optional(),
  location: optionalText,
  notes: optionalText,
})
export type CreateWindowInput = z.infer<typeof createWindowSchema>

// Every field optional so the same endpoint serves a rename, a resize,
// a profile/glass change, or an options flip — no `projectId`, see
// above.
export const updateWindowSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  frameProfile: scopedRefSchema.optional(),
  sashProfile: scopedRefSchema.optional(),
  widthMm: z.number().int().min(1).max(100000).optional(),
  heightMm: z.number().int().min(1).max(100000).optional(),
  quantity: z.number().int().min(1).optional(),
  hasFlyScreen: z.boolean().optional(),
  isDoor: z.boolean().optional(),
  glassKind: z.enum([GlassKind.SINGLE, GlassKind.COMBINATION]).optional(),
  glass: scopedRefSchema.optional(),
  openingType: z.enum(hingedOpeningTypeValues).nullable().optional(),
  interiorColor: scopedRefSchema.nullable().optional(),
  exteriorColor: scopedRefSchema.nullable().optional(),
  location: optionalText,
  notes: optionalText,
})
export type UpdateWindowInput = z.infer<typeof updateWindowSchema>

/**
 * What a canvas card needs, and nothing more.
 */
export interface WindowSummary {
  id: string
  name: string
  widthMm: number
  heightMm: number
  quantity: number
  // Enough for a canvas card without a second round trip for the
  // detail view: the frame's profile number and the glass's name, both
  // resolved client-side against the merged catalogue the card grid
  // already subscribes to (same posture as WindowDetail below — the
  // API never resolves a display name itself).
  frameProfile: string
  glassKind: GlassKind
  glass: string
  hasFlyScreen: boolean
  isDoor: boolean
}

/**
 * `GET /windows/:id` — everything the (future) design step and the
 * canvas card's expanded view show.
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
  frameProfile: string
  sashProfile: string
  hasFlyScreen: boolean
  isDoor: boolean
  glassKind: GlassKind
  glass: string
  openingType: HingedOpeningType | null
  interiorColor: string | null
  exteriorColor: string | null
  location: string | null
  notes: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
}
