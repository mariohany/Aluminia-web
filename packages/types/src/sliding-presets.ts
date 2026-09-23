import {
  SlidingDirectionSource,
  layoutFromRails,
  suggestSlidingOpeningType,
  type SlidingLayoutInput,
} from '@repo/types/sliding'

// The 28 named layouts from the prototype
// (~/Downloads/sliding-window-icons/src/slidingPresets.ts), one list
// per sash count 2–8 (decision 2: every count, not just the handoff's
// 2/3/4/6/8). Codes read `SL<sashes>-<rails>T-<shape>` and are stable —
// the editor's preset tiles key on them and the locale files carry
// each one's label (`slidingPresets.<code>`), so this file stays
// English-free.
//
// `sashRails` is rail-per-sash, left → right, 0 = back (outside).
// `rails` is how many rails the preset NEEDS (`max + 1` — no preset
// has an empty rail); the frame profile's own count decides which
// presets are offered (`slidingPresetsFor`), since the count is the
// profile's, not the layout's (planing §11).

export interface SlidingPreset {
  code: string
  sashes: number
  rails: number
  sashRails: readonly number[]
}

const p = (code: string, sashRails: readonly number[]): SlidingPreset => ({
  code,
  sashes: sashRails.length,
  rails: Math.max(...sashRails) + 1,
  sashRails,
})

export const SLIDING_PRESETS: readonly SlidingPreset[] = [
  // 2 sashes
  p('SL2-2T-LB', [0, 1]), // left back / right front — the default (decision 4)
  p('SL2-2T-LF', [1, 0]),

  // 3 sashes
  p('SL3-2T-CB', [1, 0, 1]),
  p('SL3-2T-CF', [0, 1, 0]),
  p('SL3-3T-LB', [0, 1, 2]),
  p('SL3-3T-LF', [2, 1, 0]),

  // 4 sashes
  p('SL4-2T-OB', [0, 1, 1, 0]),
  p('SL4-2T-OF', [1, 0, 0, 1]),
  p('SL4-2T-AB', [0, 1, 0, 1]),
  p('SL4-2T-AF', [1, 0, 1, 0]),
  p('SL4-4T-LB', [0, 1, 2, 3]),
  p('SL4-4T-LF', [3, 2, 1, 0]),

  // 5 sashes
  p('SL5-2T-AB', [0, 1, 0, 1, 0]),
  p('SL5-2T-AF', [1, 0, 1, 0, 1]),
  p('SL5-3T-CF', [0, 1, 2, 1, 0]),
  p('SL5-3T-CB', [2, 1, 0, 1, 2]),

  // 6 sashes
  p('SL6-2T-AB', [0, 1, 0, 1, 0, 1]),
  p('SL6-2T-MB', [0, 1, 0, 0, 1, 0]),
  p('SL6-3T-CF', [0, 1, 2, 2, 1, 0]),
  p('SL6-3T-CB', [2, 1, 0, 0, 1, 2]),

  // 7 sashes
  p('SL7-2T-AB', [0, 1, 0, 1, 0, 1, 0]),
  p('SL7-2T-AF', [1, 0, 1, 0, 1, 0, 1]),
  p('SL7-4T-CF', [0, 1, 2, 3, 2, 1, 0]),
  p('SL7-4T-CB', [3, 2, 1, 0, 1, 2, 3]),

  // 8 sashes
  p('SL8-2T-AB', [0, 1, 0, 1, 0, 1, 0, 1]),
  p('SL8-2T-MB', [0, 1, 0, 1, 1, 0, 1, 0]),
  p('SL8-4T-CF', [0, 1, 2, 3, 3, 2, 1, 0]),
  p('SL8-4T-CB', [3, 2, 1, 0, 0, 1, 2, 3]),
]

/** Every sash can slide — true for all 28 above; kept as the one place
 * a future preset gets checked against decision 7. */
export const isBuildableLayout = (sashRails: readonly number[]): boolean =>
  sashRails.every((_, i) => suggestSlidingOpeningType(sashRails, i) !== null)

/** The presets for a sash count that fit on a frame with `frameRails`
 * rails — a 2-rail preset on a 3-rail frame is buildable (it just
 * leaves a rail empty, the `emptyRail` warning), a 3-rail preset on a
 * 2-rail frame is not. No `frameRails` → every preset for the count. */
export const slidingPresetsFor = (sashes: number, frameRails?: number): SlidingPreset[] =>
  SLIDING_PRESETS.filter((preset) => preset.sashes === sashes && (frameRails === undefined || preset.rails <= frameRails))

export const slidingPresetLayout = (preset: SlidingPreset): SlidingLayoutInput => layoutFromRails(preset.sashRails)

/**
 * The preset a layout IS, or `null` when it's custom (decision 3): the
 * same rail per sash and every sash `auto` — a manual direction
 * override makes a layout custom by definition, even if the override
 * happens to equal the suggestion. The frame's rail count doesn't
 * enter into it: `SL2-2T-LB` on a 3-rail frame is still that preset.
 */
export function slidingPresetMatching(layout: SlidingLayoutInput): SlidingPreset | null {
  if (layout.sashes.some((s) => s.directionSource !== SlidingDirectionSource.AUTO)) return null
  return (
    SLIDING_PRESETS.find(
      (preset) =>
        preset.sashes === layout.sashes.length &&
        preset.sashRails.every((rail, i) => layout.sashes[i]?.rail === rail),
    ) ?? null
  )
}
