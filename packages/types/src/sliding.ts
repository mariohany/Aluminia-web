import { z } from 'zod'

// A sliding frame's rails and sashes — docs/sliding_windows_planing.md
// §1. Transcribed from the prototype Mario handed over
// (~/Downloads/sliding-window-icons/src/slidingGeometry.ts, HANDOFF.md)
// with its names mapped onto this codebase's: "track" → rail, the
// four build-check codes → the issue keys the editor already speaks.
//
// Pure and framework-free on purpose: the API runs `slidingLayoutSchema`
// on every write, the editor runs `checkSlidingBuildable` live, and a
// PDF renderer can lift the same rule later (planing §10). Its own
// subpath (`@repo/types/sliding`) rather than a relative import from
// windows.ts — see windows.ts's header comment for the runtime-value
// cross-file trap.
//
// Orientation, fixed by decision 4: rail 0 is the BACK rail (outside),
// `rails - 1` the FRONT rail (inside). Sashes are ordered left → right
// as drawn on screen, index 0 leftmost; the elevation never mirrors.
//
// The frame's rail COUNT is not stored here (planing §11, decision 13,
// 2026-09-20): it's a fact about the frame extrusion, carried by the
// frame profile (`SystemProfileSummary.slidingRails`). A layout is only
// the sashes; every function that needs the count takes it as an
// argument, and the schema can only bound a sash's rail by the global
// `SLIDING_MAX_RAILS` — the editor checks it against the real profile.

// "Fixed" is deliberately NOT a value here — a fixed sliding frame is
// the section's `kind: 'fixed'` with `sliding: null` (decision 6), not
// a sash that doesn't move.
export const SlidingOpeningType = {
  LEFT: 'sliding_left',
  RIGHT: 'sliding_right',
  FREE: 'free_sliding',
} as const
export type SlidingOpeningType = (typeof SlidingOpeningType)[keyof typeof SlidingOpeningType]
const slidingOpeningTypeValues = Object.values(SlidingOpeningType) as [SlidingOpeningType, ...SlidingOpeningType[]]

// `auto`: the stored `openingType` is whatever `suggestSlidingOpeningType`
// says for the current rails, and is rewritten whenever any rail moves.
// `manual`: the user picked it; it survives rail changes (and can
// therefore become wrong — that's what the build check is for).
export const SlidingDirectionSource = {
  AUTO: 'auto',
  MANUAL: 'manual',
} as const
export type SlidingDirectionSource = (typeof SlidingDirectionSource)[keyof typeof SlidingDirectionSource]

export const SLIDING_MIN_SASHES = 2
export const SLIDING_MAX_SASHES = 8
export const SLIDING_MIN_RAILS = 2
export const SLIDING_MAX_RAILS = 4

/**
 * Suggested opening type for sash `i`: it slides toward any neighbour
 * that sits on a DIFFERENT rail (a same-rail neighbour is a wall).
 * `null` means blocked on both sides — a build error, never a silent
 * fixed sash (decision 7).
 */
export function suggestSlidingOpeningType(rails: readonly number[], i: number): SlidingOpeningType | null {
  const left = i > 0 && rails[i - 1] !== rails[i]
  const right = i < rails.length - 1 && rails[i + 1] !== rails[i]
  if (left && right) return SlidingOpeningType.FREE
  if (left) return SlidingOpeningType.LEFT
  if (right) return SlidingOpeningType.RIGHT
  return null
}

export const movesLeft = (t: SlidingOpeningType | null): boolean =>
  t === SlidingOpeningType.LEFT || t === SlidingOpeningType.FREE
export const movesRight = (t: SlidingOpeningType | null): boolean =>
  t === SlidingOpeningType.RIGHT || t === SlidingOpeningType.FREE

// One sash. `openingType` is ALWAYS stored, even when `auto` — a reader
// (the drawing, a quote) never has to re-derive it; the schema below
// instead checks that an `auto` sash's stored value agrees with the
// rule, so the two can't drift.
export const slidingSashSchema = z
  .object({
    rail: z.number().int().min(0).max(SLIDING_MAX_RAILS - 1),
    openingType: z.enum(slidingOpeningTypeValues),
    directionSource: z.enum([SlidingDirectionSource.AUTO, SlidingDirectionSource.MANUAL]),
  })
  .strict()
export type SlidingSashInput = z.infer<typeof slidingSashSchema>

// Where the build check reports. `sash` is the 0-based sash index, or
// -1 for a frame-level issue (`emptyRail`). Codes are the handoff's
// four, spelled as this codebase's issue keys (planing §8) — the
// editor prefixes them with `sliding`; the API's Zod issue messages
// spell them out.
export type SlidingBuildIssueCode = 'blocked' | 'slidesIntoFrame' | 'slidesIntoNeighbour' | 'emptyRail' | 'railOutOfRange'
export interface SlidingBuildIssue {
  level: 'error' | 'warning'
  sash: number
  code: SlidingBuildIssueCode
  /** For `slidesIntoNeighbour`: the 0-based index of the sash it would hit. For `emptyRail`: unused. */
  neighbour?: number
  /** For `emptyRail`: the 0-based indexes of the rails nothing sits on. */
  emptyRails?: number[]
  /** For `emptyRail` / `railOutOfRange`: the frame's rail count the check ran against. */
  rails?: number
}

/**
 * The build check (decision 8). Errors must block a save/quote; the
 * one warning must not. Pure over the layout's own fields, so the same
 * call runs in the editor's issue layer and in `slidingLayoutSchema`.
 *
 * `frameRails` is the frame profile's rail count. With it, two more
 * checks run: `railOutOfRange` (error — a sash on a rail the frame
 * doesn't have, e.g. after an admin lowered the profile's count) and
 * `emptyRail` (warning). Without it — the API, which doesn't resolve
 * the profile (planing §11, decision 13) — only the neighbour rules.
 *
 * Reads each sash's STORED `openingType` (manual or auto alike) — an
 * `auto` sash whose stored value disagrees with the rule is caught by
 * the schema's own separate check, not here.
 */
export function checkSlidingBuildable(
  layout: { sashes: readonly { rail: number; openingType: SlidingOpeningType }[] },
  frameRails?: number,
): SlidingBuildIssue[] {
  const out: SlidingBuildIssue[] = []
  const rails = layout.sashes.map((s) => s.rail)
  const n = rails.length
  if (frameRails !== undefined) {
    // Reported first and on its own: a sash that isn't even on the
    // frame can't meaningfully be judged against its neighbours.
    for (let i = 0; i < n; i++) {
      if ((rails[i] ?? 0) >= frameRails) out.push({ level: 'error', sash: i, code: 'railOutOfRange', rails: frameRails })
    }
    if (out.length > 0) return out
  }
  for (let i = 0; i < n; i++) {
    if (suggestSlidingOpeningType(rails, i) === null) {
      out.push({ level: 'error', sash: i, code: 'blocked' })
      continue
    }
    const t = layout.sashes[i]?.openingType ?? null
    const canLeft = i > 0 && rails[i - 1] !== rails[i]
    const canRight = i < n - 1 && rails[i + 1] !== rails[i]
    if (movesLeft(t) && !canLeft) {
      out.push(
        i === 0
          ? { level: 'error', sash: i, code: 'slidesIntoFrame' }
          : { level: 'error', sash: i, code: 'slidesIntoNeighbour', neighbour: i - 1 },
      )
    } else if (movesRight(t) && !canRight) {
      out.push(
        i === n - 1
          ? { level: 'error', sash: i, code: 'slidesIntoFrame' }
          : { level: 'error', sash: i, code: 'slidesIntoNeighbour', neighbour: i + 1 },
      )
    }
  }
  if (frameRails !== undefined) {
    const used = new Set(rails)
    if (used.size < frameRails) {
      const emptyRails: number[] = []
      for (let r = 0; r < frameRails; r++) if (!used.has(r)) emptyRails.push(r)
      out.push({ level: 'warning', sash: -1, code: 'emptyRail', emptyRails, rails: frameRails })
    }
  }
  return out
}

export const slidingLayoutSchema = z
  .object({
    sashes: z.array(slidingSashSchema).min(SLIDING_MIN_SASHES).max(SLIDING_MAX_SASHES),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const rails = layout.sashes.map((s) => s.rail)
    layout.sashes.forEach((sash, i) => {
      if (sash.directionSource === SlidingDirectionSource.AUTO) {
        const suggested = suggestSlidingOpeningType(rails, i)
        // A blocked auto sash is reported once, by the build check
        // below, not twice.
        if (suggested !== null && sash.openingType !== suggested) {
          ctx.addIssue({
            code: 'custom',
            path: ['sashes', i, 'openingType'],
            message: `Sash ${i + 1} is set to auto but stores "${sash.openingType}" where the rails say "${suggested}".`,
          })
        }
      }
    })

    // Errors only — `emptyRail` is a cost hint the editor shows, not a
    // reason to refuse a save (decision 8).
    for (const issue of checkSlidingBuildable(layout)) {
      if (issue.level !== 'error') continue
      const sashNo = issue.sash + 1
      const message =
        issue.code === 'blocked'
          ? `Sash ${sashNo} cannot slide: ${issue.sash > 0 && issue.sash < layout.sashes.length - 1 ? 'both neighbours are' : 'its neighbour is'} on the same rail.`
          : issue.code === 'slidesIntoFrame'
            ? `Sash ${sashNo} slides into the frame.`
            : `Sash ${sashNo} slides into sash ${(issue.neighbour ?? 0) + 1}, which is on the same rail.`
      ctx.addIssue({ code: 'custom', path: ['sashes', issue.sash, 'openingType'], message })
    }
  })
export type SlidingLayoutInput = z.infer<typeof slidingLayoutSchema>

/** Decision 5: every new sliding panel starts left back / right front
 * — two sashes, which every sliding frame (min 2 rails) can carry. */
export function defaultSlidingLayout(): SlidingLayoutInput {
  return layoutFromRails([0, 1])
}

/**
 * A layout from a rail-per-sash list (the shape every preset is
 * written in), every sash `auto`. A blocked sash keeps a placeholder
 * `openingType` — the schema/build check is what reports it, and the
 * editor can only show the problem if the layout can exist at all.
 */
export function layoutFromRails(sashRails: readonly number[]): SlidingLayoutInput {
  return {
    sashes: sashRails.map((rail, i) => ({
      rail,
      openingType: suggestSlidingOpeningType(sashRails, i) ?? SlidingOpeningType.FREE,
      directionSource: SlidingDirectionSource.AUTO,
    })),
  }
}

/**
 * Rewrites every `auto` sash's `openingType` from the current rails
 * (decision 7) and leaves `manual` sashes alone. The editor calls this
 * on every write so a stored layout always passes the schema's
 * auto-agrees-with-rule check. Returns a new layout; never mutates.
 */
export function resolveSlidingLayout(layout: SlidingLayoutInput): SlidingLayoutInput {
  const rails = layout.sashes.map((s) => s.rail)
  return {
    sashes: layout.sashes.map((sash, i) =>
      sash.directionSource === SlidingDirectionSource.AUTO
        ? { ...sash, openingType: suggestSlidingOpeningType(rails, i) ?? sash.openingType }
        : { ...sash },
    ),
  }
}

/**
 * Fits a layout to a frame with `rails` rails — the editor calls it
 * when the frame profile changes (planing §11, decision 14). Every sash
 * that sat on a rail the new frame doesn't have moves onto its FRONT
 * rail (`rails - 1`), and the call reports which ones so the editor can
 * say so (handoff: "tells the user which sashes moved"). A frame with
 * MORE rails moves nothing — the build check's `emptyRail` warning is
 * the only consequence. `auto` sashes are re-derived afterwards.
 */
export function remapSlidingRails(
  layout: SlidingLayoutInput,
  rails: number,
): { layout: SlidingLayoutInput; moved: number[] } {
  const moved: number[] = []
  const sashes = layout.sashes.map((sash, i) => {
    if (sash.rail < rails) return { ...sash }
    moved.push(i)
    return { ...sash, rail: rails - 1 }
  })
  return { layout: resolveSlidingLayout({ sashes }), moved }
}

/** Sash count change from the per-sash editor (planing §7 step 2):
 * appends new sashes on the frame's front rail (`rails - 1`), or
 * drops from the right. */
export function resizeSlidingSashes(layout: SlidingLayoutInput, count: number, rails: number): SlidingLayoutInput {
  const sashes = layout.sashes.slice(0, count).map((s) => ({ ...s }))
  while (sashes.length < count) {
    sashes.push({
      rail: rails - 1,
      openingType: SlidingOpeningType.FREE,
      directionSource: SlidingDirectionSource.AUTO,
    })
  }
  return resolveSlidingLayout({ sashes })
}

/** How many neighbour pairs sit on different rails — the interlock
 * count a BoM will price (planing §10); here so the number has one
 * definition before it has a consumer. */
export function countSlidingInterlocks(sashRails: readonly number[]): number {
  let count = 0
  for (let i = 1; i < sashRails.length; i++) if (sashRails[i] !== sashRails[i - 1]) count++
  return count
}
