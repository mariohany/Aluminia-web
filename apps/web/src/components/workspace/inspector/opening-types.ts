import { HingedOpeningType } from '@repo/types/windows'
import { DOUBLE_DOOR_OPENING_TYPES } from '@/lib/window-geometry'

/**
 * The opening-type popover's two lists — docs/inspector_redesign_planing.md
 * §6. Fixed leads the windows, the same way it led the old icon grid.
 * `FIXED_VERTICAL_MULLION`/`FIXED_HORIZONTAL_MULLION` are still not
 * offered: a divider does that now (sections_planing.md).
 */
export const WINDOW_OPENING_TYPES: HingedOpeningType[] = [
  HingedOpeningType.FIXED_CLOSED,
  HingedOpeningType.TOP_HUNG,
  HingedOpeningType.SIDE_HUNG_LEFT,
  HingedOpeningType.SIDE_HUNG_RIGHT,
  HingedOpeningType.TILT_TURN_LEFT,
  HingedOpeningType.TILT_TURN_RIGHT,
  HingedOpeningType.PIVOT_BOTTOM,
  HingedOpeningType.PIVOT_SIDE,
]

export const DOOR_OPENING_TYPES: HingedOpeningType[] = [
  HingedOpeningType.SINGLE_DOOR_HINGE_LEFT,
  HingedOpeningType.SINGLE_DOOR_HINGE_RIGHT,
  ...DOUBLE_DOOR_OPENING_TYPES,
]

/** Picking one of these turns the panel's Door on (Mario, 2026-10-12);
 * a window type never turns it off. */
export function isDoorOpeningType(type: HingedOpeningType | null): boolean {
  return type !== null && DOOR_OPENING_TYPES.includes(type)
}
