import { CombinationItemKind, SystemType } from '@repo/types/lookups'
import { GlassKind, HeadShape, PanelType, type WindowPanelInput } from '@repo/types/windows'
import { formatScopedRef } from '@repo/types/company-lookups'
import {
  useMergedColorsQuery,
  useMergedGlassCombinationsQuery,
  useMergedGlassQuery,
  useMergedSystemCatalogsQuery,
  useMergedSystemProfilesQuery,
  type MergedGlassCombinationSummary,
  type MergedGlassSummary,
  type MergedSystemCatalogSummary,
  type MergedSystemProfileSummary,
} from '@/lib/lookup-merge'
import type { HingedOpeningType, WindowBarInput } from '@repo/types/windows'
import type { PanelPlacement } from '@/lib/window-geometry'

/** The bead allowance subtracted from a sash's max glass thickness to
 * get the largest glass build-up it can actually take. See
 * docs/window_creation_planing.md §5's "The glass rule". */
export const BEAD_ALLOWANCE_MM = 2

/**
 * Everything a drawn panel needs that ISN'T geometry — resolved from the
 * merged catalogue, not stored on the panel. Consumed by both the
 * interactive elevation in the design dialog and the static thumbnail on
 * a canvas card.
 */
export interface PanelRender {
  placement: PanelPlacement
  systemType: SystemType | null
  /** Whether a frame profile has actually been picked. Before that,
   * `systemType` is still just "not sliding", not a real fact about how
   * the panel opens — the hinge symbol stays suppressed even though the
   * sash/glass placeholder pane still draws. */
  hasFrame: boolean
  /** A hinged door has no sill — its frame draws open at the bottom. */
  isDoor: boolean
  openingType: HingedOpeningType | null
  /** Hex of the face being shown. `null` falls back to white. */
  frameHex: string | null
  /** Hex of this panel's glass colour — only a glass COMBINATION has
   * one (a coloured sheet in its build-up); a plain single pane has no
   * colour field at all. */
  glassHex: string | null
  /** A Georgian spacer bar grid embedded in the glass build-up — a real
   * physical grid, not a decorative option, so it's drawn whenever the
   * build-up actually has one. */
  georgianGrid: { columns: number; rows: number } | null
  /** Raw panel fields, not catalogue-resolved — passed straight through
   * so the drawing can build a `HeadOutline` from whichever `WindowPart`
   * actually carries the matching `head` (see window-geometry.ts) and
   * resolve `bars` against it. `[]` on a flat panel, same as stored. */
  headShape: HeadShape
  headRiseMm: number | null
  bars: WindowBarInput[]
}

/** The catalogue facts a panel's own options depend on — the design
 * dialog needs all of these; the thumbnail needs none of them. */
export interface PanelInfo {
  frame: MergedSystemProfileSummary | undefined
  frameCatalog: MergedSystemCatalogSummary | undefined
  sash: MergedSystemProfileSummary | undefined
  systemType: SystemType | null
  /** Door and the opening-type grid are hinged-only; sliding gets its
   * own icon set later, not this one. */
  showDoor: boolean
  showOpeningTypes: boolean
  flyScreenAllowed: boolean
  sashMaxGlassThickness: number | null
  maxGlassAllowed: number | null
  currentGlass: MergedGlassSummary | undefined
  currentCombination: MergedGlassCombinationSummary | undefined
  maxSashWeight: number | null
}

export interface ResolvedPanel {
  info: PanelInfo
  render: PanelRender
}

/**
 * Resolves every panel of an assembly against the merged catalogue.
 *
 * Lives here rather than inside the design dialog because the canvas
 * card draws the same elevation and would otherwise repeat the same
 * lookups with its own subtly different copy. Every one of these used to
 * be computed once for the whole window — an assembly's panels each have
 * their own frame, so each has its own system type, glass ceiling and
 * weight limit.
 *
 * `face` picks which side's colour the drawing is painted in. A panel
 * borrows the other face's colour when only one is set: a window is
 * realistically painted the same on both sides more often than not, so
 * this saves picking it twice. Purely a rendering fallback — the stored
 * fields stay exactly what the user chose.
 */
// The full `WindowPanelInput` union, not just the window branch — a
// transom can genuinely be in `panels` now (docs/transom_tasks.md
// Step 5 lets the "+" flow create one). Its own resolution branch below
// resolves exactly what a transom's own real UI needs (Step 6's options
// form, the glass ceiling) and leaves everything else — `frame`/
// `systemType`/`flyScreenAllowed`/`maxSashWeight` — honestly `null`/
// `undefined`/`false`, since a transom genuinely has none of those
// concepts (not "not built yet", but "not applicable").
export function useResolvedPanels(
  panels: WindowPanelInput[],
  face: 'interior' | 'exterior',
): ResolvedPanel[] {
  const profilesQuery = useMergedSystemProfilesQuery()
  const catalogsQuery = useMergedSystemCatalogsQuery()
  const glassQuery = useMergedGlassQuery()
  const combinationsQuery = useMergedGlassCombinationsQuery()
  const colorsQuery = useMergedColorsQuery()

  const hexFor = (ref: string | null | undefined): string | null =>
    ref ? (colorsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === ref)?.hex ?? null) : null

  return panels.map((panel) => {
    // Glass/colour resolution is identical for both branches — a
    // transom's glass is a plain single/combination pane exactly like
    // a window's own (`basePanelFields`, packages/types/src/windows.ts).
    const currentGlass =
      panel.glassKind === GlassKind.SINGLE
        ? glassQuery.data?.find((g) => formatScopedRef(g.scope, g.id) === panel.glass)
        : undefined
    const currentCombination =
      panel.glassKind === GlassKind.COMBINATION
        ? combinationsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === panel.glass)
        : undefined

    // Only a combination's sheets can reference a real Color — reflect
    // whichever sheet in the build-up has one set (first found).
    const coloredSheet = currentCombination?.items.find(
      (item) => item.kind === CombinationItemKind.SHEET && item.colorCode,
    )
    let georgianGrid: { columns: number; rows: number } | null = null
    for (const item of currentCombination?.items ?? []) {
      if (item.kind === CombinationItemKind.GAP && item.isGeorgian && item.columnsCount && item.rowsCount) {
        georgianGrid = { columns: item.columnsCount, rows: item.rowsCount }
        break
      }
    }

    const shown = face === 'interior' ? panel.interiorColor : panel.exteriorColor
    const other = face === 'interior' ? panel.exteriorColor : panel.interiorColor
    const frameHex = hexFor(shown ?? other)
    const glassHex = coloredSheet
      ? (colorsQuery.data?.find((c) => c.code === coloredSheet.colorCode)?.hex ?? null)
      : null

    if (panel.panelType !== PanelType.WINDOW) {
      // A transom's own profile plays a sash's role for both the glass
      // ceiling AND the weight formula (docs/transom_planing.md §6:
      // `computeSashWeightKg({ ..., sashProfile: transomProfile })` is
      // literally the same call a window's sash already uses) — `info.
      // sash` holds it under that name deliberately, not by accident,
      // so window-dialog.tsx's already-panel-type-agnostic
      // `glassOptions`/`glassValue` derivation (built once, keyed off
      // `activeInfo.maxGlassAllowed`) works for a transom with no
      // separate code path. `frame`/`systemType`/`showDoor`/
      // `flyScreenAllowed`/`maxSashWeight` stay genuinely not
      // applicable — a transom has none of those concepts.
      const transom = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === panel.transomProfile)
      const transomMaxGlassThickness = transom?.maxGlassThickness ?? null
      return {
        info: {
          frame: undefined,
          frameCatalog: undefined,
          sash: transom,
          systemType: null,
          showDoor: false,
          showOpeningTypes: false,
          flyScreenAllowed: false,
          sashMaxGlassThickness: transomMaxGlassThickness,
          maxGlassAllowed: transomMaxGlassThickness !== null ? transomMaxGlassThickness - BEAD_ALLOWANCE_MM : null,
          currentGlass,
          currentCombination,
          maxSashWeight: null,
        },
        render: {
          placement: panel,
          systemType: null,
          hasFrame: false,
          isDoor: false,
          openingType: null,
          frameHex,
          glassHex,
          georgianGrid,
          headShape: HeadShape.FLAT,
          headRiseMm: null,
          bars: [],
        },
      }
    }

    const frame = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === panel.frameProfile)
    const frameCatalog = catalogsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === frame?.catalog)
    const sash = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === panel.sashProfile)
    const systemType = frameCatalog?.systemType ?? null
    const showDoor = systemType === SystemType.HINGED
    const flyScreenAllowed = frame?.acceptsFlyScreen ?? false
    const sashMaxGlassThickness = sash?.maxGlassThickness ?? null

    return {
      info: {
        frame,
        frameCatalog,
        sash,
        systemType,
        showDoor,
        showOpeningTypes: showDoor,
        flyScreenAllowed,
        sashMaxGlassThickness,
        maxGlassAllowed: sashMaxGlassThickness !== null ? sashMaxGlassThickness - BEAD_ALLOWANCE_MM : null,
        currentGlass,
        currentCombination,
        maxSashWeight: frameCatalog?.maxSashWeight ?? null,
      },
      render: {
        placement: panel,
        systemType,
        hasFrame: !!frame,
        isDoor: panel.isDoor,
        openingType: panel.openingType ?? null,
        frameHex,
        glassHex,
        georgianGrid,
        headShape: panel.headShape,
        headRiseMm: panel.headRiseMm ?? null,
        bars: panel.bars,
      },
    }
  })
}
