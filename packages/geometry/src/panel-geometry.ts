import { SystemType } from '@repo/types/lookups'
import type { WindowPanelInput } from '@repo/types/windows'
import { withAlignedSections } from './panel-lights.ts'
import { resolveProfileMetrics, type ProfileMetrics } from './profile-metrics.ts'
import type { AssemblyPanelInput } from './window-geometry.ts'

/** The catalogue facts the geometry needs about a panel's frame — the
 * only lookups shape depends on. The web resolves them from the merged
 * catalogue queries, the API from the same rows read server-side. */
export interface PanelFrameFacts {
  /** The frame profile's catalogue system type; `null` until a frame is
   * picked. */
  systemType: SystemType | null
  flyScreenAllowed: boolean
}

export interface PanelGeometry<T extends WindowPanelInput> {
  /** The panel with `sections[i]` re-matched to light `i` — what every
   * drawing and the cut list read. */
  panel: T
  metrics: ProfileMetrics
  /** Only a hinged frame can be a door; a door has no sill. */
  showDoor: boolean
}

/**
 * The one place a stored panel becomes drawable shape: its band widths
 * and its sections aligned to its lights. `useResolvedPanels` (web) and
 * the report's cut list (API) both go through here, so the editor and a
 * report can't disagree about a window's shape
 * (docs/reports_planing.md §5).
 */
export function resolvePanelGeometry<T extends WindowPanelInput>(given: T, systemType: SystemType | null): PanelGeometry<T> {
  const showDoor = systemType === SystemType.HINGED
  const metrics = resolveProfileMetrics(given.frameProfile)
  const panel = withAlignedSections(null, given, { metrics, doorSill: given.isDoor && showDoor })
  return { panel, metrics, showDoor }
}

/** `buildAssemblyLayout`'s input for one stored panel — the same fields
 * the canvas thumbnail feeds it. */
export function panelLayoutInput(given: WindowPanelInput, facts: PanelFrameFacts): AssemblyPanelInput {
  const { panel, metrics } = resolvePanelGeometry(given, facts.systemType)
  return {
    xMm: panel.xMm,
    yMm: panel.yMm,
    widthMm: panel.widthMm,
    heightMm: panel.heightMm,
    systemType: facts.systemType,
    flyScreenAllowed: facts.flyScreenAllowed,
    isDoor: panel.isDoor,
    headShape: panel.headShape,
    headRiseMm: panel.headRiseMm ?? null,
    metrics,
    dividers: panel.dividers,
    sections: panel.sections.map((section) => ({
      faceKey: section.faceKey,
      kind: section.kind,
      hasSash: !!section.sashProfile,
      openingType: section.openingType ?? null,
      hasFlyScreen: section.hasFlyScreen,
      sliding: section.sliding ?? null,
    })),
  }
}
