import { CombinationItemKind, SystemType } from '@repo/types/lookups'
import { GlassKind, HeadShape, SectionKind, type WindowPanelInput } from '@repo/types/windows'
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
import type { WindowDividerInput, WindowPanelDetail, WindowSectionInput } from '@repo/types/windows'
import type { SlidingLayoutInput } from '@repo/types/sliding'
import {
  buildAssemblyLayout,
  touchesTopEdge,
  type AssemblyPanelInput,
  type PanelPlacement,
  type WindowPart,
  type WindowSectionLayoutInput,
} from '@/lib/window-geometry'
import { resolveProfileMetrics, type ProfileMetrics } from '@/lib/profile-metrics'
import { collectPanelIssues, collectWindowIssues, type WindowIssue } from '@/lib/window-weight'
import { headBendRadiusMm } from '@/lib/arch-geometry'
import { dividerProblems, resolveDividers } from '@/lib/dividers'
import { radiusFromSag } from '@/lib/divider-draw'
import { isFixedOnlyLight, lightPitch, panelLights, withAlignedSections } from '@/lib/panel-lights'
import type { IssueLight } from '@/lib/window-weight'

/** The bead allowance subtracted from a sash's max glass thickness to
 * get the largest glass build-up it can actually take. See
 * docs/window_creation_planing.md §5's "The glass rule". */
export const BEAD_ALLOWANCE_MM = 2

/** One light's catalogue-resolved facts, on top of what
 * `WindowSectionLayoutInput` already gives `buildWindowLayout` — a
 * `SectionRender` IS a `WindowSectionLayoutInput`, so it can be passed
 * straight into `buildWindowLayout`'s `sections[]` without remapping. */
export interface SectionRender extends WindowSectionLayoutInput {
  /** Hex of this section's glass colour — only a glass COMBINATION has
   * one (a coloured sheet in its build-up); a plain single pane has no
   * colour field at all. */
  glassHex: string | null
  /** A Georgian spacer bar grid embedded in the glass build-up — a real
   * physical grid, not a decorative option, so it's drawn whenever the
   * build-up actually has one. */
  georgianGrid: { columns: number; rows: number } | null
}

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
  /** Hex of the face being shown. `null` falls back to white — used for
   * the frame AND every divider (decision 10: a divider fills in
   * `frameFill`, the same face colour, not a colour of its own). */
  frameHex: string | null
  /** The panel's dividers, passed straight to `buildWindowLayout`. */
  dividers: WindowDividerInput[]
  /** One per light, in display order (panel-lights.ts). */
  sections: SectionRender[]
  /** Raw panel fields, not catalogue-resolved — passed straight through
   * to `buildWindowLayout`. */
  headShape: HeadShape
  headRiseMm: number | null
  /** The frame PROFILE's rail count (planing §11) — what the sliding
   * painters and the icon's plan strip draw depth against. `null` until
   * a frame is picked, or for a profile that has none. */
  slidingRails: number | null
  /** Which side this render was resolved for — the same `face`
   * `useResolvedPanels` picked the colour by. The painters need it for
   * sliding sashes (which rail is nearer the viewer, which edge is
   * hidden — window-shapes.tsx's sliding helpers), so it travels with
   * the render rather than being threaded in a second time. */
  face: 'interior' | 'exterior'
  /** The band widths this panel is built and painted with — resolved
   * here, once, from its frame profile, so the geometry builder and
   * both painters read the same object. */
  metrics: ProfileMetrics
}

/** One grid cell's own catalogue facts — the design dialog's Section
 * block needs all of these; the thumbnail needs none of them. */
export interface SectionInfo {
  sash: MergedSystemProfileSummary | undefined
  sashMaxGlassThickness: number | null
  /** A fixed section's own profile — a sash's fixed-light counterpart,
   * since its glass sits straight in a bead rather than a leaf. */
  bead: MergedSystemProfileSummary | undefined
  beadMaxGlassThickness: number | null
  /** The active one of `sashMaxGlassThickness`/`beadMaxGlassThickness`,
   * less `BEAD_ALLOWANCE_MM`, whichever this section's `kind` actually
   * has — `null` (and so the glass picker disabled) until that profile
   * is picked, an opening section's `bead`/an OPENING section's own
   * `sash` never being the source. */
  maxGlassAllowed: number | null
  currentGlass: MergedGlassSummary | undefined
  currentCombination: MergedGlassCombinationSummary | undefined
}

/** The catalogue facts a panel's own options depend on — the design
 * dialog needs all of these; the thumbnail needs none of them. What
 * used to be one sash/glass/opening-type per PANEL is now one per
 * SECTION (`sections` below); frame/divider profile, system type, and
 * the door/fly-screen/weight ceilings stay panel-level (docs/
 * sections_planing.md decision 7). */
export interface PanelInfo {
  frame: MergedSystemProfileSummary | undefined
  frameCatalog: MergedSystemCatalogSummary | undefined
  /** `undefined` iff the panel has no divider yet (a 1×1 grid). */
  dividerProfile: MergedSystemProfileSummary | undefined
  systemType: SystemType | null
  /** Door and the opening-type grid are hinged-only; sliding gets its
   * own icon set later, not this one. */
  showDoor: boolean
  showOpeningTypes: boolean
  flyScreenAllowed: boolean
  maxSashWeight: number | null
  sections: SectionInfo[]
}

export interface ResolvedPanel {
  /** The panel as given, with its sections aligned one per light in
   * display order (panel-lights.ts) — what `info.sections` and
   * `render.sections` index. Equal to the input for an editor panel,
   * which is always kept aligned; differs only for a saved panel that
   * still carries a `migrated:` light (docs/free_dividers_planing.md §2). */
  panel: WindowPanelInput
  info: PanelInfo
  render: PanelRender
}

/** The grid cell a part belongs to, or `undefined` for a panel-level
 * part (frame, divider) — both painters (window-drawing.tsx,
 * window-thumbnail.tsx) look up a sash/glass/fly-screen's own section
 * this way instead of repeating the `sectionIndex !== null` guard. */
/** `collectPanelIssues`' per-section sliding inputs (planing §12) — one
 * entry per section in index order: its kind, its own layout, its sash
 * part ids in SASH INDEX order (so a per-sash build issue lands on that
 * sash's own glyph and row), and where a section-level sliding issue
 * lands (its first glass part — the light the user clicks — or nothing,
 * so the caller falls back to the frame). Shared by the editor's own
 * issue pass and the read-path `useWindowIssues` below. */
export function slidingSectionArgs(
  sections: Pick<WindowSectionInput, 'kind' | 'sliding'>[],
  panelParts: WindowPart[],
): { kind: SectionKind; sliding: SlidingLayoutInput | null; sashPartIds: string[]; partId: string | null }[] {
  return sections.map((section, sectionIndex) => {
    const own = panelParts.filter((p) => p.sectionIndex === sectionIndex)
    return {
      kind: section.kind,
      sliding: section.sliding ?? null,
      sashPartIds: own
        .filter((p) => p.kind === 'sash')
        .sort((a, b) => a.index - b.index)
        .map((p) => p.id),
      partId: own.find((p) => p.kind === 'glass')?.id ?? null,
    }
  })
}

export function sectionRenderFor(panel: Pick<PanelRender, 'sections'>, part: Pick<WindowPart, 'sectionIndex'>): SectionRender | undefined {
  return part.sectionIndex !== null ? panel.sections[part.sectionIndex] : undefined
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
/** The face every elevation is drawn from — the INTERIOR, always, for
 * now (Mario, 2026-09-20: "what we see in drawing is the interior
 * always we dont have another face for now"). The former
 * Interior/Exterior toggle is gone; the `face` plumbing below stays so
 * an exterior view can come back as a real feature later. Decides the
 * frame colour shown (interior colour, exterior as fallback), which
 * sliding sash covers which (planing §5) and the hardware face (§13). */
export const DRAWING_FACE = 'interior' as const

export function useResolvedPanels(
  panels: WindowPanelInput[],
  face: 'interior' | 'exterior' = DRAWING_FACE,
): ResolvedPanel[] {
  const profilesQuery = useMergedSystemProfilesQuery()
  const catalogsQuery = useMergedSystemCatalogsQuery()
  const glassQuery = useMergedGlassQuery()
  const combinationsQuery = useMergedGlassCombinationsQuery()
  const colorsQuery = useMergedColorsQuery()

  const hexFor = (ref: string | null | undefined): string | null =>
    ref ? (colorsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === ref)?.hex ?? null) : null

  return panels.map((given) => {
    const frame = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === given.frameProfile)
    const frameCatalog = catalogsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === frame?.catalog)
    const dividerProfile = given.dividerProfile
      ? profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === given.dividerProfile)
      : undefined
    const systemType = frameCatalog?.systemType ?? null
    const showDoor = systemType === SystemType.HINGED
    const metrics = resolveProfileMetrics(given.frameProfile)
    const panel = withAlignedSections(null, given, { metrics, doorSill: given.isDoor && showDoor })
    const flyScreenAllowed = frame?.acceptsFlyScreen ?? false

    const shown = face === 'interior' ? panel.interiorColor : panel.exteriorColor
    const other = face === 'interior' ? panel.exteriorColor : panel.interiorColor
    const frameHex = hexFor(shown ?? other)

    const sectionInfos: SectionInfo[] = []
    const sectionRenders: SectionRender[] = []

    for (const section of panel.sections) {
      const sash = section.sashProfile
        ? profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === section.sashProfile)
        : undefined
      const sashMaxGlassThickness = sash?.maxGlassThickness ?? null

      const bead = section.beadProfile
        ? profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === section.beadProfile)
        : undefined
      const beadMaxGlassThickness = bead?.maxGlassThickness ?? null

      const kindMaxGlassThickness =
        section.kind === SectionKind.OPENING ? sashMaxGlassThickness : beadMaxGlassThickness

      const currentGlass =
        section.glassKind === GlassKind.SINGLE
          ? glassQuery.data?.find((g) => formatScopedRef(g.scope, g.id) === section.glass)
          : undefined
      const currentCombination =
        section.glassKind === GlassKind.COMBINATION
          ? combinationsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === section.glass)
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
      const glassHex = coloredSheet
        ? (colorsQuery.data?.find((c) => c.code === coloredSheet.colorCode)?.hex ?? null)
        : null

      sectionInfos.push({
        sash,
        sashMaxGlassThickness,
        bead,
        beadMaxGlassThickness,
        maxGlassAllowed: kindMaxGlassThickness !== null ? kindMaxGlassThickness - BEAD_ALLOWANCE_MM : null,
        currentGlass,
        currentCombination,
      })
      sectionRenders.push({
        faceKey: section.faceKey,
        kind: section.kind,
        hasSash: !!section.sashProfile,
        openingType: section.openingType ?? null,
        hasFlyScreen: section.hasFlyScreen,
        // The section's own sliding layout (planing §12), passed
        // straight through — read by the geometry only when the panel's
        // `systemType` is sliding; `null` on every other section and on
        // a not-yet-migrated sliding one (decision 5), which draws the
        // legacy two leaves.
        sliding: section.sliding ?? null,
        glassHex,
        georgianGrid,
      })
    }

    return {
      panel,
      info: {
        frame,
        frameCatalog,
        dividerProfile,
        systemType,
        showDoor,
        showOpeningTypes: showDoor,
        flyScreenAllowed,
        maxSashWeight: frameCatalog?.maxSashWeight ?? null,
        sections: sectionInfos,
      },
      render: {
        placement: panel,
        systemType,
        hasFrame: !!frame,
        isDoor: panel.isDoor,
        frameHex,
        dividers: panel.dividers,
        sections: sectionRenders,
        headShape: panel.headShape,
        headRiseMm: panel.headRiseMm ?? null,
        slidingRails: frame?.slidingRails ?? null,
        face,
        metrics,
      },
    }
  })
}

/**
 * Every `severity: 'error'` issue a SAVED assembly actually has, resolved
 * against the merged catalogue — the same `collectPanelIssues`/
 * `collectWindowIssues` rules the design dialog's own issue strip uses
 * (`window-editor-page.tsx`), run here for the READ path instead: a
 * canvas card has no in-progress form to sanitise (a saved
 * `WindowPanelDetail` never carries the NaN-placeholder sizes a
 * brand-new panel can), so it skips straight to `useResolvedPanels` +
 * `buildAssemblyLayout`, the same two calls `WindowThumbnail` already
 * makes to draw the elevation. Deliberately excludes `warning`-severity
 * issues (sash weight, arch obstruction, etc.) — a card badge means
 * "this won't save as-is," not "worth a second look."
 *
 * `sashWeightKg` is always passed `null`: the one issue it could
 * produce (`sashWeightExceeded`) is a warning, filtered out below
 * anyway, so computing the real estimate here would cost a glass-weight
 * lookup for nothing.
 */
export function useWindowIssues(panels: WindowPanelDetail[]): WindowIssue[] {
  const resolved = useResolvedPanels(panels)
  const layoutInput: AssemblyPanelInput[] = resolved.map(({ info, render }) => ({
    ...render.placement,
    systemType: render.systemType,
    flyScreenAllowed: info.flyScreenAllowed,
    isDoor: render.isDoor,
    headShape: render.headShape,
    headRiseMm: render.headRiseMm,
    metrics: render.metrics,
    dividers: render.dividers,
    sections: render.sections,
  }))
  const { parts } = buildAssemblyLayout(layoutInput)

  const issues: WindowIssue[] = []
  resolved.forEach(({ panel, info }, i) => {
    const raw = panels[i]
    const panelParts = parts.filter((p) => p.panelIndex === i)
    const framePart = panelParts.find((p) => p.kind === 'frame')
    const hasArchedHeadHere = !!framePart?.head
    const hasPanelOnTop = panels.some((other, j) => j !== i && touchesTopEdge(panel, other))
    const lights = panelIssueLights(panel, resolved[i].render)

    issues.push(
      ...collectPanelIssues({
        dividerProfile: panel.dividerProfile,
        dividerCount: panel.dividers.length,
        dividerProblemPartIds: lights.dividerProblems.map((id) => `p${i}:div-${id}`),
        dividerBends: lights.bends.map((b) => ({ partId: `p${i}:div-${b.id}`, radiusMm: b.radiusMm })),
        minBendRadiusMm: resolved[i].render.metrics.minBendRadius,
        metricsSource: resolved[i].render.metrics.source,
        lightsMismatch: lights.mismatch,
        lightsChanged: raw.sections.some((s) => s.faceKey.startsWith('migrated:')),
        systemType: info.systemType,
        framePartId: framePart?.id ?? `p${i}:frame`,
        slidingRails: info.frame?.slidingRails ?? null,
        hasFrame: !!info.frame,
        sections: slidingSectionArgs(panel.sections, panelParts),
      }),
    )

    panel.sections.forEach((section, sectionIndex) => {
      const sectionInfo = info.sections[sectionIndex]
      const sectionParts = panelParts.filter((p) => p.sectionIndex === sectionIndex)
      const sashPartIds = sectionParts.filter((p) => p.kind === 'sash').map((p) => p.id)
      const glassPartIds = sectionParts.filter((p) => p.kind === 'glass').map((p) => p.id)
      const flyScreenPartId = sectionParts.find((p) => p.kind === 'flyScreen')?.id ?? null

      issues.push(
        ...collectWindowIssues({
          frameProfile: info.frame,
          sectionKind: section.kind,
          sashProfile: sectionInfo?.sash,
          beadProfile: sectionInfo?.bead,
          hasGlass: !!section.glass,
          glassThickness: sectionInfo?.currentGlass?.thickness ?? sectionInfo?.currentCombination?.totalThickness ?? null,
          maxGlassAllowed: sectionInfo?.maxGlassAllowed ?? null,
          sashWeightKg: null,
          maxSashWeight: info.maxSashWeight,
          hasFlyScreen: section.hasFlyScreen,
          flyScreenAllowed: info.flyScreenAllowed,
          sashPartIds,
          glassPartIds,
          flyScreenPartId,
          framePartId: framePart?.id ?? `p${i}:frame`,
          hasArchedHead: hasArchedHeadHere,
          hasPanelOnTop,
          headBendRadiusMm: framePart?.head
            ? headBendRadiusMm({ rect: framePart.rectMm, shape: framePart.head.shape, riseMm: framePart.head.riseMm })
            : null,
          minBendRadiusMm: resolved[i].render.metrics.minBendRadius,
          metricsSource: resolved[i].render.metrics.source,
          light: lights.byKey.get(section.faceKey) ?? null,
          openingTypeRequired: section.kind === SectionKind.OPENING && info.showOpeningTypes && section.openingType == null,
        }),
      )
    })
  })

  return issues.filter((issue) => issue.severity === 'error')
}

/** What the issue rules need to know about a panel's lights: each one's
 * pitch and shape by key, whether the stored sections match them one to
 * one (`lightsMismatch`), and which dividers don't resolve or slant below
 * the springing line. Shared by `useWindowIssues` and the editor's own
 * issue pass. */
export function panelIssueLights(
  panel: Pick<WindowPanelInput, 'widthMm' | 'heightMm' | 'headShape' | 'headRiseMm' | 'dividers' | 'sections' | 'isDoor'>,
  render: Pick<PanelRender, 'metrics' | 'systemType'>,
): { byKey: Map<string, IssueLight>; mismatch: boolean; dividerProblems: string[]; bends: { id: string; radiusMm: number }[] } {
  if (!Number.isFinite(panel.widthMm) || !Number.isFinite(panel.heightMm)) return { byKey: new Map(), mismatch: false, dividerProblems: [], bends: [] }
  const ctx = { metrics: render.metrics, doorSill: panel.isDoor && render.systemType === SystemType.HINGED }
  const { geo, graph } = panelLights(panel, ctx)
  const byKey = new Map<string, IssueLight>()
  for (const light of graph.lights) {
    const pitch = lightPitch(light, panel, ctx)
    byKey.set(light.key, {
      pitchWidthMm: pitch ? pitch.x1 - pitch.x0 : null,
      pitchHeightMm: pitch ? pitch.y1 - pitch.y0 : null,
      glazable: !!light.clear,
      fixedOnly: isFixedOnlyLight(light),
      wholeArch: !!light.head,
    })
  }
  const keys = panel.sections.map((s) => s.faceKey)
  const mismatch = keys.length !== graph.lights.length || graph.lights.some((l) => !keys.includes(l.key))
  const bends: { id: string; radiusMm: number }[] = []
  for (const r of resolveDividers(geo, panel.dividers).values()) {
    const radiusMm = radiusFromSag(Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y), r.divider.sagMm)
    if (radiusMm !== null) bends.push({ id: r.id, radiusMm })
  }
  return { byKey, mismatch, dividerProblems: dividerProblems(geo, panel.dividers).map((p) => p.id), bends }
}
