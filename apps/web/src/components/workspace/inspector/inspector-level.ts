import type { WindowPartKind } from '@repo/geometry/window-geometry'

export type InspectorLevel = 'panel' | 'section' | 'divider'

/** Which inspector level a selection shows (planing §3). */
export function inspectorLevel(selectedKind: WindowPartKind | null, dividerSelected: boolean): InspectorLevel {
  if (dividerSelected) return 'divider'
  if (selectedKind === 'sash' || selectedKind === 'glass' || selectedKind === 'flyScreen') return 'section'
  return 'panel'
}
