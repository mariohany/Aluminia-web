import type { ScopedRef } from '@repo/types/company-lookups'

/**
 * The drawable cross-section widths the elevation is built from — every
 * band the frame, sash, bead and dividers occupy, in mm.
 *
 * Profiles carry no face-width field yet (`system_profile` has weight,
 * perimeter, inertia — nothing a drawing can inset by), so today these
 * are one placeholder set shared by every panel, and every size derived
 * from them is labelled "indicative" in the UI. This object is the ONE
 * seam the real numbers will come through later (docs/
 * elevation_detail_planing.md §1 and §8, Tier 2): callers resolve it
 * once per panel and pass it down, so wiring real per-profile widths in
 * means filling `resolveProfileMetrics`'s body, not touching a caller.
 */
export interface ProfileMetrics {
  /** Outer frame face, outside edge to the sash/bead. */
  frameFace: number
  /** Sash face, its outer edge to the glass — includes the bead strip. */
  sashFace: number
  /** Glazing bead, the strip holding the glass in a fixed section. */
  beadFace: number
  /** An in-frame mullion/transom's face — docs/sections_planing.md;
   * consumed by window-geometry.ts's divider parts and
   * `sectionClearRect`. */
  dividerFace: number
  /** The static bar a FIXED_*_MULLION opening type splits one sash's
   * glass with — a structural member between two lights, not the
   * decorative Georgian grid. */
  sashBarFace: number
  /** How far a sliding window's two leaves overlap at the meeting stile. */
  slidingInterlock: number
  /** Tightest radius the profile can be rolled to for an arched head. */
  minBendRadius: number
  /** Drawn hardware sizes, mm — barrel hinges and the handle. Nested so
   * a real profile set (Tier 2) can fill the bands and leave these
   * alone; hardware is a separate catalogue question. */
  hardware: {
    /** Barrel hinge along the hinge stile: length and visible width. */
    hingeLength: number
    hingeWidth: number
    /** Handle backplate, and the lever hanging off its centre. */
    handlePlateWidth: number
    handlePlateHeight: number
    handleLeverLength: number
  }
  /** Where the numbers came from — `PLACEHOLDER` until profiles carry
   * their own, so the UI can caption the drawing honestly. */
  source: 'PLACEHOLDER' | 'PROFILE'
}

// The set every panel draws with today — the working numbers from
// docs/transom_docs/WINDOW_GEOMETRY_SPEC.md (typical for a mid-range
// thermally-broken aluminium system), so the drawing reads like a real
// elevation: a slim outer frame and a visibly heavier sash, with a
// narrow bead strip on a fixed section. The sash-bar and interlock
// widths carry over from before the spec; nothing in it contradicts
// them.
export const PLACEHOLDER_METRICS: ProfileMetrics = {
  frameFace: 52,
  sashFace: 70,
  beadFace: 18,
  dividerFace: 82,
  sashBarFace: 50,
  slidingInterlock: 30,
  minBendRadius: 300,
  hardware: { hingeLength: 120, hingeWidth: 16, handlePlateWidth: 32, handlePlateHeight: 150, handleLeverLength: 100 },
  source: 'PLACEHOLDER',
}

/**
 * The metrics a panel with this frame (or transom) profile draws with.
 * Ignores the ref today and returns the one placeholder set — the
 * parameter exists so every call site already hands over the profile it
 * has, and the future per-profile lookup lands here alone.
 */
export function resolveProfileMetrics(_profile?: ScopedRef | null): ProfileMetrics {
  return PLACEHOLDER_METRICS
}
