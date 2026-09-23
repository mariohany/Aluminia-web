import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  GlassKind,
  HeadShape,
  HingedOpeningType,
  SectionKind,
  createWindowSchema,
  type CreateWindowInput,
  type WindowPanelInput,
  type WindowSectionInput,
} from '@repo/types/windows'
import { ProfileType, SystemType } from '@repo/types/lookups'
import {
  SlidingDirectionSource,
  SlidingOpeningType,
  defaultSlidingLayout,
  remapSlidingRails,
  resolveSlidingLayout,
  suggestSlidingOpeningType,
  type SlidingLayoutInput,
} from '@repo/types/sliding'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import { apiErrorMessage } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  useMergedColorsQuery,
  useMergedGlassCombinationsQuery,
  useMergedGlassQuery,
  useMergedSystemCatalogsQuery,
  useMergedSystemProfilesQuery,
} from '@/lib/lookup-merge'
import { useProjectQuery, useUpdateProjectMutation } from '@/lib/projects-queries'
import { useCreateWindowMutation, useUpdateWindowMutation, useWindowQuery } from '@/lib/windows-queries'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { FieldLabel } from '@/components/workspace/field-label'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { WindowDrawing } from '@/components/workspace/window-drawing'
import { slidingSectionArgs, useResolvedPanels, type PanelRender, type SectionRender } from '@/lib/window-render'
import { WindowPartPanel } from '@/components/workspace/window-part-panel'
import { AddPanelCard, type AddPanelRequest } from '@/components/workspace/add-panel-card'
import { AddPanelTypeStep, type AddChoice } from '@/components/workspace/add-panel-type-step'
import { AddDividerCard } from '@/components/workspace/add-divider-card'
import {
  buildAssemblyLayout,
  canHaveArchedHead,
  cumulativeBoundaries,
  findMisalignedDividers,
  freeSidesOf,
  insertColumn,
  insertPanel,
  insertRow,
  moveDivider,
  panelRect,
  panelsConnected,
  parsePartId,
  prefillForSide,
  removeDivider,
  removePanel,
  resizePanel,
  resizePanelEdge,
  resizeSection,
  resizeSectionEdge,
  tilesExactly,
  touchesTopEdge,
  unionRect,
  type AssemblyPanelInput,
  type PanelPlacement,
  type PanelSide,
} from '@/lib/window-geometry'
import { headBendRadiusMm, minGothicRiseMm, normalizeHeadRise, radiusFromSag, sagFromRadius } from '@/lib/arch-geometry'
import { barLengthMm, dependentsOf, removeBarCascade, resolveBar } from '@/lib/arch-bars'
import { outlineOf } from '@/components/workspace/window-shapes'
import { collectPanelIssues, collectWindowIssues, computeSashWeightKg, resolveGlassWeightPerSqm, type TranslatedIssue } from '@/lib/window-weight'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// What an unsized panel is drawn at. A brand-new window's width/height
// are NaN so the number inputs render empty rather than showing a 0
// nobody typed — but the elevation still has to draw something.
const PLACEHOLDER_WIDTH_MM = 1000
const PLACEHOLDER_HEIGHT_MM = 1200

/** The assembly-level issue's part id — it belongs to no drawn part. */
const ASSEMBLY_PART_ID = 'assembly'

/**
 * Route wrapper — `/workspace/projects/:projectId/windows/new` and
 * `/windows/:windowId`. `WindowEditor` is keyed on `windowId` so
 * switching between "new" and any two windows always gets a fresh
 * component instance (React Router reuses the same instance across a
 * param-only change by default; every bit of local editor state below
 * — selection, bar-draw mode, the add-panel flow — is only ever valid
 * for the window it was created for).
 */
export function WindowEditorPage() {
  const { projectId, windowId } = useParams<{ projectId: string; windowId?: string }>()
  // The route always supplies a projectId; this guard only exists to
  // satisfy the type (useParams can't statically prove it's present),
  // and it runs before any hooks below — WindowEditor itself never
  // conditionally skips a hook.
  if (!projectId) return null
  return <WindowEditor key={windowId ?? 'new'} projectId={projectId} windowId={windowId} />
}

/**
 * Create or edit a window ASSEMBLY — one screen, one `useForm`, one
 * submit: a frame profile tree, a clickable elevation of every panel
 * (`window-drawing.tsx`), and an options panel (`window-part-panel.tsx`)
 * that edits whichever panel owns the selected part, and within it
 * whichever SECTION owns the selected sash/glass/fly-screen (docs/
 * sections_planing.md — a panel is now a grid of sections, not always a
 * single light).
 *
 * Hovering a panel puts a "+" on each of its free sides; selecting
 * several panels (ctrl/cmd-click) offers one on the sides of their
 * combined outline. See docs/window_assembly_planing.md.
 *
 * Every field uses the controlled `watch()`/`setValue()` pattern, never
 * `register()` + `setValueAs`, for numeric/select fields — a
 * `register()`-driven numeric input populated via `reset()` and never
 * typed into can silently submit as `null` (bug-011).
 *
 * A full-screen route, not a modal — see docs/window_editor_planing.md.
 * `projectId`/`windowId` come straight off the URL rather than props,
 * so there's nothing above this in the tree that needs to know a window
 * is being edited (unlike the old dialog, which the workspace shell had
 * to own open/close state for).
 */
function WindowEditor({ projectId, windowId }: { projectId: string; windowId?: string }) {
  const navigate = useNavigate()
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const { t: tCommon } = useTranslation('common')
  const isEdit = !!windowId

  const onDone = () => void navigate(`/workspace/projects/${projectId}`)

  // Drawing selection/hover state — owned here (not inside WindowDrawing
  // itself) per docs/window_design_planing.md §3, so it can also drive
  // the options panel's scroll-to-and-highlight behaviour.
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null)
  // Which panel the options column edits, and which panels a new one
  // would attach to. They coincide except while multi-selecting.
  const [activePanelIndex, setActivePanelIndex] = useState(0)
  // Which of the active panel's own sections the Section block shows —
  // docs/sections_planing.md §5. Reset to the panel's first section
  // whenever the active panel itself changes, same posture as
  // barDrawMode below.
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)
  useEffect(() => setActiveSectionIndex(0), [activePanelIndex])
  const [selectedPanelIndices, setSelectedPanelIndices] = useState<number[]>([0])
  // Sticky: set when the pointer enters a panel, cleared only when it
  // leaves the whole drawing. Deriving it from `hoveredPartId` instead
  // made the "+" markers flicker out the moment the pointer crossed
  // onto one of them — the panel's own mouseleave had already fired.
  const [hoveredPanelIndex, setHoveredPanelIndex] = useState<number | null>(null)
  const [addRequest, setAddRequest] = useState<AddPanelRequest | null>(null)
  // `null` while the type-step (Window/Mullion-or-Transom) is still
  // showing — set the instant one is chosen, cleared together with
  // `addRequest` on cancel/confirm.
  const [addChoice, setAddChoice] = useState<AddChoice | null>(null)
  const [addError, setAddError] = useState<string | undefined>(undefined)
  // Bar-drawing toggle — arch_windows_planing.md §6.1/§6.2. Owned here
  // (not inside WindowDrawing) so switching the active panel can turn
  // it off from the outside, same posture as selectedPartId above.
  const [barDrawMode, setBarDrawMode] = useState(false)
  // Select/delete/drag — arch_windows_planing.md §6.3/§6.4. Also owned
  // here, same posture as barDrawMode above.
  const [selectedBarId, setSelectedBarId] = useState<string | null>(null)
  const [pendingDeleteBarId, setPendingDeleteBarId] = useState<string | null>(null)
  useEffect(() => {
    setBarDrawMode(false)
    setSelectedBarId(null)
    setPendingDeleteBarId(null)
  }, [activePanelIndex])
  // Drawing and selecting a bar are mutually exclusive modes — entering
  // draw mode drops whatever bar was selected (and any pending delete
  // confirm for it), so the two never fight over the same clicks.
  useEffect(() => {
    if (barDrawMode) {
      setSelectedBarId(null)
      setPendingDeleteBarId(null)
    }
  }, [barDrawMode])

  const projectQuery = useProjectQuery(projectId)
  const project = projectQuery.data

  const editingWindowQuery = useWindowQuery(windowId)
  const editingWindow = editingWindowQuery.data

  const createMutation = useCreateWindowMutation(projectId)
  const updateMutation = useUpdateWindowMutation(windowId ?? '', projectId)
  const updateProjectMutation = useUpdateProjectMutation(project?.id ?? '')

  const profilesQuery = useMergedSystemProfilesQuery()
  const catalogsQuery = useMergedSystemCatalogsQuery()
  const glassQuery = useMergedGlassQuery()
  const combinationsQuery = useMergedGlassCombinationsQuery()
  const colorsQuery = useMergedColorsQuery()

  const {
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, isSubmitted, isDirty },
  } = useForm<CreateWindowInput>({
    resolver: zodResolver(createWindowSchema),
    defaultValues: emptyWindow(projectId),
  })

  // `WindowEditor` is remounted (via the `key` on `windowId` above)
  // every time the route switches to a different window, so this only
  // ever needs to fire once per mount — no "closed" state to gate on
  // anymore, unlike the old dialog. Still guarded by a ref rather than
  // firing unconditionally on every render: without it, setting a
  // favourite from the tree's right-click menu mid-fill (a real thing
  // to do, since the tree lives inside this very screen) changes
  // `project.favoriteFrameProfile`, which would otherwise re-trigger
  // the effect and wipe out whatever the user had already typed —
  // confirmed live in the browser, not hypothetical (bug-012).
  const initialized = useRef(false)
  // Mirrors `initialized.current` as real state (a ref alone can't
  // trigger the re-render the loading-guard below needs): `reset()` only
  // runs inside THIS effect, which fires after the first paint — so even
  // when `editingWindow` is already cache-warm and available on that
  // first paint, `watch('panels')` elsewhere in this component still
  // reads `emptyWindow()`'s placeholder defaults until this effect
  // actually runs. See the guard's own comment for why that one frame
  // matters.
  const [formReady, setFormReady] = useState(false)

  useEffect(() => {
    if (initialized.current) return
    // Editing, but the detail fetch hasn't landed yet — wait rather than
    // briefly resetting to blank create-mode defaults.
    if (isEdit && !editingWindow) return
    initialized.current = true
    reset(
      editingWindow
        ? {
            projectId,
            name: editingWindow.name,
            quantity: editingWindow.quantity,
            // `WindowPanelDetail`'s own refs are already exactly
            // `ScopedRef`-shaped strings — this just recovers the
            // narrower type react-hook-form's generic loses.
            panels: editingWindow.panels.map((p) => ({
              ...p,
              frameProfile: p.frameProfile as ScopedRef,
              dividerProfile: p.dividerProfile as ScopedRef | null,
              interiorColor: p.interiorColor as ScopedRef | null,
              exteriorColor: p.exteriorColor as ScopedRef | null,
              sections: p.sections.map((s) => ({
                ...s,
                sashProfile: s.sashProfile as ScopedRef | null,
                glass: s.glass as ScopedRef,
              })),
            })),
            location: editingWindow.location,
            notes: editingWindow.notes,
          }
        : emptyWindow(projectId, project?.favoriteFrameProfile ?? null),
    )
    setFormReady(true)
  }, [isEdit, editingWindow, reset, projectId, project?.favoriteFrameProfile])

  // ---- Leaving with unsaved changes -------------------------------------
  //
  // `requestLeave` is the single gate every "leave this screen" affordance
  // goes through — the back arrow, the Cancel button, the physical browser
  // back button/trackpad swipe (via the popstate trick below), and a tab
  // close/refresh (via beforeunload). A successful save does NOT go
  // through this — `onSubmit` below calls `onDone()` directly, since
  // there's nothing left to discard once the request succeeds.
  const [confirmLeave, setConfirmLeave] = useState<{ onConfirm: () => void; onCancel?: () => void } | null>(null)
  // Set just before AlertDialogAction's own click closes the dialog, so
  // the single onOpenChange(false) below can tell "Discard" apart from
  // every other way the dialog closes (Cancel, Escape, an outside click)
  // — all of which mean the same thing here: stay.
  const confirmedRef = useRef(false)

  const requestLeave = useCallback(
    (onConfirm: () => void, onCancel?: () => void) => {
      if (!isDirty) {
        onConfirm()
        return
      }
      setConfirmLeave({ onConfirm, onCancel })
    },
    [isDirty],
  )

  // Stops the trackpad two-finger swipe-back gesture from leaving this
  // screen entirely (Chromium honours `overscroll-behavior-x` for the
  // navigation gesture, not only for rubber-band scrolling) — scoped to
  // this screen's lifetime, not applied app-wide. Unconditional, not
  // gated on `isDirty`: the point is to stop the accidental swipe from
  // ever firing here, so it doesn't need to have discarded anything
  // for the fix to matter.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.overscrollBehaviorX
    root.style.overscrollBehaviorX = 'none'
    return () => {
      root.style.overscrollBehaviorX = previous
    }
  }, [])

  // Tab close, refresh, or typing a new URL — the one case this can't
  // hand off to `requestLeave`'s own dialog, since the page is gone
  // before any of our own code could run. The browser's own generic
  // prompt is all any site gets here; `returnValue` is what triggers it.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // The physical back button (and the swipe gesture on a browser/OS
  // combination the CSS above doesn't fully catch) fires `popstate`
  // after the entry has already been popped — there's no "cancel this
  // navigation" native API for it. The standard workaround: push a
  // harmless duplicate of the current entry once there's something to
  // lose, so the first back press only consumes THAT (no visible
  // change, since the URL is identical) and lands here instead of
  // actually leaving. Confirming calls `history.back()` again — for
  // real this time, since the duplicate is already gone. Cancelling
  // re-pushes the duplicate so the next back press is caught too.
  useEffect(() => {
    if (!isDirty) return
    window.history.pushState(null, '', window.location.href)
    const onPopState = () => {
      requestLeave(
        () => window.history.back(),
        () => window.history.pushState(null, '', window.location.href),
      )
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isDirty, requestLeave])

  const panels = watch('panels') as WindowPanelInput[]
  const quantity = watch('quantity')

  // ---- Per-panel catalogue resolution --------------------------------
  //
  // Every one of these used to be computed once for the whole window.
  // An assembly's panels each have their own frame, so each has its own
  // system type, weight limit, etc — and now, per SECTION, its own sash
  // options, glass ceiling and weight (docs/sections_planing.md decision
  // 7).

  // Resolved once, shared with the canvas card's own thumbnail — see
  // lib/window-render.ts. Always the interior face (`DRAWING_FACE`).
  const resolved = useResolvedPanels(panels)
  const panelInfos = resolved.map((r) => r.info)

  // A section's opening-type/fly-screen flags are only meaningful for
  // certain frames/kinds. Rather than an effect that writes back into
  // the form (one per section, each a chance to loop), the stale value
  // is simply never READ: the drawing, the options column and the
  // submitted body all use this sanitised view. Changing a frame away
  // and back therefore restores what you had, instead of silently
  // destroying it. `isDoor` stays the one panel-level field this needs.
  const sanitizedPanels: WindowPanelInput[] = panels.map((panel, i) => {
    const info = panelInfos[i]
    return {
      ...panel,
      isDoor: info.showDoor ? panel.isDoor : false,
      sections: panel.sections.map((section) => ({
        ...section,
        openingType: info.showOpeningTypes && section.kind === SectionKind.OPENING ? (section.openingType ?? null) : null,
        hasFlyScreen: info.flyScreenAllowed && section.kind === SectionKind.OPENING ? section.hasFlyScreen : false,
      })),
    }
  })

  const colorOptions = (colorsQuery.data ?? []).map((c) => ({
    value: formatScopedRef(c.scope, c.id),
    label: c.code,
    hex: c.hex,
    scope: c.scope,
  }))

  // ---- Layout ---------------------------------------------------------

  // Recomputed on every render (cheap, pure) rather than memoized — both
  // the drawing and the panel's per-part sizes need it, so it's lifted
  // here instead of built twice.
  //
  // A brand-new panel's `columnWidths`/`rowHeights` are `[NaN]` (mirroring
  // its own `widthMm`/`heightMm`, both NaN until the user picks a real
  // size) — substituted with the same drawable placeholder here so
  // `buildWindowLayout`'s arithmetic never has to see a NaN pitch. Every
  // OTHER panel (any panel that has ever had a real size) keeps its own
  // real `columnWidths`/`rowHeights` untouched, grid or not.
  const sectionRendersFor = (i: number): SectionRender[] =>
    resolved[i].render.sections.map((sr, j) => ({
      ...sr,
      openingType: sanitizedPanels[i].sections[j].openingType,
      hasFlyScreen: sanitizedPanels[i].sections[j].hasFlyScreen,
    }))

  const layoutInput: AssemblyPanelInput[] = sanitizedPanels.map((panel, i) => {
    const columnWidths = Number.isFinite(panel.widthMm) ? panel.columnWidths : [drawableMm(panel.widthMm, PLACEHOLDER_WIDTH_MM)]
    const rowHeights = Number.isFinite(panel.heightMm) ? panel.rowHeights : [drawableMm(panel.heightMm, PLACEHOLDER_HEIGHT_MM)]
    return {
      xMm: panel.xMm,
      yMm: panel.yMm,
      widthMm: drawableMm(panel.widthMm, PLACEHOLDER_WIDTH_MM),
      heightMm: drawableMm(panel.heightMm, PLACEHOLDER_HEIGHT_MM),
      systemType: panelInfos[i].systemType,
      flyScreenAllowed: panelInfos[i].flyScreenAllowed,
      isDoor: panel.isDoor,
      headShape: panel.headShape,
      headRiseMm: panel.headRiseMm,
      metrics: resolved[i].render.metrics,
      columnWidths,
      rowHeights,
      sections: sectionRendersFor(i).map((sr) => ({ kind: sr.kind, hasSash: sr.hasSash, openingType: sr.openingType, hasFlyScreen: sr.hasFlyScreen, sliding: sr.sliding })),
    }
  })
  const drawingLayout = buildAssemblyLayout(layoutInput)

  const activePanel = sanitizedPanels[activePanelIndex] ?? sanitizedPanels[0]
  const activeInfo = panelInfos[activePanelIndex] ?? panelInfos[0]
  const activeRaw = panels[activePanelIndex] ?? panels[0]
  const activeSection = activePanel.sections[activeSectionIndex] ?? activePanel.sections[0]
  const activeSectionInfo = activeInfo.sections[activeSectionIndex] ?? activeInfo.sections[0]
  const activeIsGridded = activePanel.columnWidths.length > 1 || activePanel.rowHeights.length > 1
  const activeBars = activePanel.bars

  // ---- Bars — select/delete/drag/bow (§6.3/§6.4/§6.5) ------------------

  // Bars only ever anchor onto the archable TOP ROW's own glass outline
  // (docs/sections_planing.md — arch is scoped to `cols === 1`, and only
  // section 0 ever carries a `head`) — filtering by `.head` is what
  // keeps this from picking up some OTHER section's flat glass now that
  // a panel can have more than one.
  const activeGlassPart = drawingLayout.parts.find((p) => p.panelIndex === activePanelIndex && p.kind === 'glass' && p.head)
  const activeGlassOutline = activeGlassPart ? outlineOf(activeGlassPart) : null
  const selectedBar = selectedBarId ? (activeBars.find((b) => b.id === selectedBarId) ?? null) : null
  const selectedBarLengthMm =
    selectedBar && activeGlassOutline ? barLengthMm(selectedBar, activeBars, activeGlassOutline) : null
  // The bow/radius binding needs the CHORD (straight from→to distance),
  // not the developed length above — radiusFromSag/sagFromRadius are
  // both defined in terms of the chord a circle is drawn through, not
  // the arc length it produces.
  const selectedBarResolved =
    selectedBar && activeGlassOutline ? resolveBar(selectedBar, activeBars, activeGlassOutline) : null
  const selectedBarChordMm = selectedBarResolved
    ? Math.hypot(selectedBarResolved.to.x - selectedBarResolved.from.x, selectedBarResolved.to.y - selectedBarResolved.from.y)
    : null
  const selectedBarRadiusMm =
    selectedBar && selectedBarChordMm !== null ? radiusFromSag(selectedBarChordMm, selectedBar.sagMm) : null
  const selectedBarMinRadiusMm = selectedBarChordMm !== null ? selectedBarChordMm / 2 : null
  const pendingDeleteDependentsCount = pendingDeleteBarId ? dependentsOf(pendingDeleteBarId, activeBars).size : 0

  const onSelectBar = (barId: string) => {
    setSelectedBarId(barId)
    setPendingDeleteBarId(null)
  }
  const onRequestDeleteBar = () => {
    if (selectedBarId) setPendingDeleteBarId(selectedBarId)
  }

  // ---- Attach affordance -----------------------------------------------
  //
  // With two or more panels selected the markers stay put — that
  // selection was deliberate. With one or none they follow the pointer,
  // which is the user's own "when I hover over a window" ask. Once a
  // "+" has actually been clicked, though, this STOPS following the
  // pointer — `addRequest.panelIndices` is a snapshot taken at that
  // click, and every downstream user of `attachPanels` (the marker
  // itself, `allowDivider`, both confirm handlers, the divider-profile
  // popup's own catalogue scoping) reads that frozen value for as long
  // as the popup stays open. Without this, `hoveredPanelIndex` drifting
  // while the popup is up (a real risk the instant it renders under the
  // cursor — the browser re-hit-tests) made the marker and the popup's
  // own Mullion/Transom option disappear together (Mario, 2026-09-15).
  const effectiveAttachIndices = addRequest
    ? addRequest.panelIndices
    : selectedPanelIndices.length >= 2
      ? selectedPanelIndices
      : hoveredPanelIndex !== null
        ? [hoveredPanelIndex]
        : []

  // Geometry runs on the raw panels, whose placement fields are the same
  // as the sanitised ones — sanitising only touches per-section opening/
  // fly-screen fields. Identity matters: freeSidesOf excludes the
  // selection by reference.
  const attachPanels = effectiveAttachIndices.map((i) => panels[i]).filter(Boolean)
  // An assembly still being filled in has no real size yet — there is
  // nothing coherent to attach to, so no "+" until every panel has one.
  const allPanelsSized = panels.every(
    (p) => Number.isFinite(p.widthMm) && p.widthMm > 0 && Number.isFinite(p.heightMm) && p.heightMm > 0,
  )
  // "The edge of the selection" is only well-defined when the selected
  // panels actually form a solid rectangle between them.
  const canAttach =
    allPanelsSized && attachPanels.length > 0 && (attachPanels.length === 1 || tilesExactly(attachPanels))
  const attachRect = canAttach ? unionRect(attachPanels.map(panelRect)) : null
  // A panel is "arched" here iff it actually DREW arched (has a real
  // `.head` on its built frame part) — a panel whose headShape is
  // non-flat but isn't archable (sliding, a hinged door, more than one
  // column, …) silently draws flat, and attaching above it is
  // perfectly fine.
  const hasArchedHead = (p: PanelPlacement) => {
    // `p` is always one of `panels`' own elements by reference (the
    // same identity `freeSidesOf` itself already relies on to exclude
    // the selection) — the cast just recovers that for `indexOf`,
    // which wants the array's own element type, not the narrower
    // structural `PanelPlacement` shape `freeSidesOf` declares.
    const index = panels.indexOf(p as WindowPanelInput)
    return !!drawingLayout.parts.find((part) => part.panelIndex === index && part.kind === 'frame')?.head
  }
  const attachSides = canAttach ? freeSidesOf(attachPanels, panels, hasArchedHead) : []
  // Growing the SAME panel via a divider only makes sense for a single-
  // panel selection (docs/sections_planing.md decision 2) — offering it
  // for a multi-panel selection would leave "which one grows?" undefined.
  const allowDivider = attachPanels.length === 1

  const onAddPanel = (side: PanelSide, at: { left: number; top: number }) => {
    if (attachPanels.length === 0) return
    const source = attachPanels[0]
    setAddError(undefined)
    setAddChoice(null)
    setAddRequest({ side, at, panelIndices: effectiveAttachIndices, ...prefillForSide(side, attachPanels, source) })
  }

  // Shared by every stage of the flow (the type-step, either size
  // card) — cancelling any of them clears the whole thing back to
  // nothing showing, same as the single "X" the old two-stage flow had.
  const onCancelAddPanel = () => {
    setAddRequest(null)
    setAddChoice(null)
    setAddError(undefined)
  }

  // Lands the newly-appended panel as the active one with its frame/
  // ring selected, so the options column is already showing what to
  // change — shared by both confirm handlers below.
  const landOnNewPanel = (next: WindowPanelInput[]) => {
    setValue('panels', next, { shouldValidate: true, shouldDirty: true })
    const newIndex = next.length - 1
    setActivePanelIndex(newIndex)
    setSelectedPanelIndices([newIndex])
    setSelectedPartId(`p${newIndex}:frame`)
    // The card sits inside the drawing box, so dismissing it doesn't
    // fire the container's mouseleave — without this the markers for
    // whatever was hovered before stay on screen until the pointer next
    // crosses the drawing's edge.
    setHoveredPanelIndex(null)
    onCancelAddPanel()
  }

  const onConfirmAddPanel = (widthMm: number, heightMm: number) => {
    if (!addRequest || attachPanels.length === 0) return
    const source = attachPanels[0]
    // Clones the panel attached to — same frame, colours, is-door, and
    // its first section's kind/sash/glass/opening type/fly screen. A
    // NEW coupled panel always starts as a plain 1×1 grid at the given
    // size, even when the source is itself gridded — "+ → Window" adds
    // a normal frame, never a copy of a whole multi-section layout.
    const sourceSection = source.sections[0]
    const next = insertPanel(panels, addRequest.side, attachPanels, {
      frameProfile: source.frameProfile,
      dividerProfile: null,
      columnWidths: [Math.round(widthMm)],
      rowHeights: [Math.round(heightMm)],
      sections: [{ ...sourceSection, row: 0, col: 0 }],
      isDoor: source.isDoor,
      interiorColor: source.interiorColor,
      exteriorColor: source.exteriorColor,
      headShape: HeadShape.FLAT,
      headRiseMm: null,
      bars: [],
      // Same frame ⇒ same system: a coupled panel added next to a
      // sliding one is sliding too, and (via `sourceSection`'s own
      // `sliding`) starts with that section's sashes rather than a
      // blank the user has to fill twice.
      widthMm: Math.round(widthMm),
      heightMm: Math.round(heightMm),
      xMm: 0,
      yMm: 0,
    })
    if (!next) {
      setAddError(t('windowDialog.design.addPanel.wouldOverlap'))
      return
    }
    landOnNewPanel(next)
  }

  // "+" → Mullion/Transom (docs/sections_planing.md decision 2): grows
  // the SAME panel via `insertRow`/`insertColumn` and inserts a
  // full-length divider — never a new coupled frame. The new section
  // always starts FIXED, cloning the panel's own first section's glass.
  const onConfirmDivider = (sizeMm: number, dividerProfile: ScopedRef) => {
    if (!addRequest || attachPanels.length !== 1) return
    const panel = attachPanels[0]
    const index = panels.indexOf(panel)
    if (index < 0) return
    const pitch = Math.round(sizeMm)
    const makeSection = (row: number, col: number): WindowSectionInput => {
      const source = panel.sections[0]
      return {
        row,
        col,
        kind: SectionKind.FIXED,
        sashProfile: null,
        // Not-yet-picked, same posture as a fresh OPENING section's
        // `sashProfile: '' as ScopedRef` below — a real ref is required
        // to save, `''` just means nothing's chosen yet. Not cloned
        // from `source` even when it's also fixed: a bead profile is
        // this section's own choice, not a copy of a sibling's.
        beadProfile: '' as ScopedRef,
        openingType: null,
        glassKind: source.glassKind,
        glass: source.glass,
        hasFlyScreen: false,
        sliding: null,
      }
    }

    const isColumn = addRequest.side === 'left' || addRequest.side === 'right'
    let next = isColumn
      ? insertColumn(panels, index, addRequest.side as 'left' | 'right', pitch, makeSection)
      : insertRow(panels, index, addRequest.side as 'top' | 'bottom', pitch, makeSection)

    // A mullion (a new COLUMN) is never compatible with an arched head
    // (decision 5) — flatten defensively rather than let the UI reach
    // an invalid state the schema would only reject at Save. A new ROW
    // keeps the arch (decision 5's whole point of allowing transoms
    // under one), but ROUND specifically can't survive more than one
    // row (its rise is pinned to width / 2), and a surviving Segmental/
    // Gothic head's STORED rise has to track whichever row ends up on
    // top — unchanged if the new row was appended at the bottom, reset
    // to the new row's own height if it was inserted above.
    // The picked divider profile is set on the SAME panel object here —
    // one profile per panel (decision 4), so picking it in this popup
    // is exactly the same field the side panel's own picker edits, just
    // asked for up front instead of as a separate follow-up step.
    next = next.map((p, i) => {
      if (i !== index) return p
      const withProfile = { ...p, dividerProfile }
      if (withProfile.headShape === HeadShape.FLAT) return withProfile
      if (isColumn || withProfile.headShape === HeadShape.ROUND) {
        return { ...withProfile, headShape: HeadShape.FLAT, headRiseMm: null, bars: [] }
      }
      if (addRequest.side === 'top') {
        return { ...withProfile, headRiseMm: withProfile.rowHeights[0] }
      }
      return withProfile
    })

    setValue('panels', next, { shouldValidate: true, shouldDirty: true })
    setSelectedPartId(`p${index}:frame`)
    setActiveSectionIndex(0)
    setHoveredPanelIndex(null)
    onCancelAddPanel()
  }

  // ---- Panel / section mutation ------------------------------------------

  const updateActivePanel = (changes: Partial<WindowPanelInput>) => {
    setValue(
      'panels',
      panels.map((panel, i) => (i === activePanelIndex ? { ...panel, ...changes } : panel)),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  const updateActiveSection = (changes: Partial<WindowSectionInput>) => {
    setValue(
      'panels',
      panels.map((panel, i) =>
        i === activePanelIndex
          ? { ...panel, sections: panel.sections.map((s, j) => (j === activeSectionIndex ? { ...s, ...changes } : s)) }
          : panel,
      ),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  // ---- Sliding layout (docs/sliding_windows_planing.md §7) ---------------

  const activeIsSliding = activeInfo?.systemType === SystemType.SLIDING
  // The last layout each SECTION had before it was set to Fixed (or
  // before its frame was re-picked) — component state only, gone when
  // this screen is left, so "Opening" can restore it (decision 6).
  // Keyed `panelIndex:sectionIndex` (planing §12: a sliding panel can
  // hold several sliding sections).
  const rememberedSlidingLayouts = useRef(new Map<string, SlidingLayoutInput>())
  const rememberKey = (panelIndex: number, sectionIndex: number) => `${panelIndex}:${sectionIndex}`
  const onSlidingRailsShrunk = (moved: number[]) => {
    toast.info(t('fields.sliding.railsShrunkToast', { sashes: moved.join(', '), count: moved.length }))
  }
  const systemTypeOfFrame = (ref: ScopedRef | null): SystemType | null => {
    const frame = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === ref)
    const catalog = catalogsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === frame?.catalog)
    return catalog?.systemType ?? null
  }
  // The rail count is the frame PROFILE's (planing §11) — read straight
  // off the merged catalogue row, never stored on the panel.
  const slidingRailsOfFrame = (ref: ScopedRef | null): number | null =>
    profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === ref)?.slidingRails ?? null
  const activeSlidingRails = slidingRailsOfFrame(activePanel.frameProfile)

  const confirmDeleteBar = () => {
    if (!pendingDeleteBarId) return
    updateActivePanel({ bars: removeBarCascade(activeBars, pendingDeleteBarId) })
    setSelectedBarId(null)
    setPendingDeleteBarId(null)
  }

  // `radiusMm: null` means "clear the field" — flatten back to a
  // straight line (sagMm: 0), the other half of §6.5's "line and arc
  // are never two tools, only two values of one field". A typed radius
  // preserves whichever side the bar is CURRENTLY bowed to (or defaults
  // positive, going from straight — there's no existing direction to
  // preserve yet); `sagFromRadius` itself clamps below chord/2.
  const onBarRadiusChange = (radiusMm: number | null) => {
    if (!selectedBar || selectedBarChordMm === null) return
    const sagMm = radiusMm === null ? 0 : (selectedBar.sagMm >= 0 ? 1 : -1) * sagFromRadius(selectedBarChordMm, radiusMm)
    updateActivePanel({ bars: activeBars.map((b) => (b.id === selectedBar.id ? { ...b, sagMm } : b)) })
  }

  // Panel-level dimension inputs. A plain (1×1) panel resizes exactly as
  // before. A GRIDDED panel routes the delta to the column/row nearest
  // the edge that moves — the right column for width, the top row for
  // height (docs/sections_planing.md §5 — matching `resizePanel`'s own
  // left-/bottom-anchor rule) — via `resizeSection`, so every OTHER
  // section keeps its own pitch untouched.
  const onPanelSizeChange = (widthMm: number, heightMm: number) => {
    const panel = panels[activePanelIndex]
    if (!panel) return
    if (panel.columnWidths.length === 1 && panel.rowHeights.length === 1) {
      // `resizePanel` is grid-agnostic (it only moves placements), so
      // the single cell has to follow the panel here — otherwise a
      // brand-new panel's `[NaN]` grid never becomes real, the Section
      // size fields stay blank and `gridMismatch` fires on save (bug-058).
      const resized = resizePanel(panels, activePanelIndex, widthMm, heightMm)
      setValue(
        'panels',
        resized.map((p, i) => (i === activePanelIndex ? { ...p, columnWidths: [p.widthMm], rowHeights: [p.heightMm] } : p)),
        { shouldValidate: true, shouldDirty: true },
      )
      return
    }
    const lastCol = panel.columnWidths.length - 1
    const nextColWidth = panel.columnWidths[lastCol] + (Math.round(widthMm) - panel.widthMm)
    const nextRowHeight = panel.rowHeights[0] + (Math.round(heightMm) - panel.heightMm)
    setValue('panels', resizeSection(panels, activePanelIndex, 0, lastCol, nextColWidth, nextRowHeight), {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  // The active SECTION's own width/height inputs — docs/sections_planing.md's
  // assumption that resizing a section grows the PANEL by the same
  // delta (never steals from a neighbour section), reusing
  // `resizeSection` directly at this one cell's own row/col.
  const onSectionWidthChange = (mm: number) => {
    setValue(
      'panels',
      resizeSection(panels, activePanelIndex, activeSection.row, activeSection.col, mm, activePanel.rowHeights[activeSection.row]),
      { shouldValidate: true, shouldDirty: true },
    )
  }
  const onSectionHeightChange = (mm: number) => {
    setValue(
      'panels',
      resizeSection(panels, activePanelIndex, activeSection.row, activeSection.col, activePanel.columnWidths[activeSection.col], mm),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  const canDeletePanel = panels.length > 1 && removePanel(panels, activePanelIndex) !== null
  const onDeletePanel = () => {
    const next = removePanel(panels, activePanelIndex)
    if (!next) return
    setValue('panels', next, { shouldValidate: true, shouldDirty: true })
    const fallback = Math.max(0, activePanelIndex - 1)
    setActivePanelIndex(fallback)
    setSelectedPanelIndices([fallback])
    setSelectedPartId(null)
  }

  const onRemoveDivider = (orientation: 'horizontal' | 'vertical', k: number) => {
    const next = removeDivider(panels, activePanelIndex, orientation, k)
    const updated = next[activePanelIndex]
    if (!updated) return
    const stillGridded = updated.columnWidths.length > 1 || updated.rowHeights.length > 1
    // A 1×1 panel has no divider to profile (the schema forbids one) —
    // null it out the moment the last one is merged away.
    const final = stillGridded ? next : next.map((p, i) => (i === activePanelIndex ? { ...p, dividerProfile: null } : p))
    setValue('panels', final, { shouldValidate: true, shouldDirty: true })
    setSelectedPartId(`p${activePanelIndex}:frame`)
    setActiveSectionIndex(0)
  }

  // Dragging a mullion/transom on the drawing itself (Mario, 2026-09-15:
  // "move the transom/mullion in the panel by dragging it"). `dividerId`
  // is the divider's own full assembly part id — parsed the same way
  // `selectedDividerMatch` below reads a selected divider's id, since
  // this can be ANY panel's divider, not just the active one. Unlike
  // `onRemoveDivider`/`resizeSection` above, `moveDivider` REDISTRIBUTES
  // between the two sections the divider separates (steals from one,
  // gives to the other) rather than growing the panel — the behaviour
  // Mario chose specifically for dragging, distinct from the side
  // panel's numeric fields.
  const onDividerDrag = (dividerId: string, boundaryMm: number) => {
    const parsed = parsePartId(dividerId)
    const match = parsed ? /^div-(v|h)(\d+)$/.exec(parsed.localId) : null
    if (!parsed || !match) return
    const orientation: 'vertical' | 'horizontal' = match[1] === 'v' ? 'vertical' : 'horizontal'
    setValue('panels', moveDivider(panels, parsed.panelIndex, orientation, Number(match[2]), boundaryMm), {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  // Dragging a panel's own FREE outer edge in/out (Mario: "resize the
  // window by dragging any side in or out"). `positionMm` is already
  // resolved by the drawing — snapped onto another coupled panel's edge
  // when one was within tolerance, raw pointer position otherwise — so
  // this only has to route to the right geometry function, same
  // 1×1-vs-gridded split `onPanelSizeChange` already makes for the
  // numeric fields.
  const onPanelEdgeDrag = (panelIndex: number, side: PanelSide, positionMm: number) => {
    const panel = panels[panelIndex]
    if (!panel) return
    const gridded = panel.columnWidths.length > 1 || panel.rowHeights.length > 1
    setValue(
      'panels',
      gridded ? resizeSectionEdge(panels, panelIndex, side, positionMm) : resizePanelEdge(panels, panelIndex, side, positionMm),
      { shouldValidate: true, shouldDirty: true },
    )
  }

  const onSelectPart = (partId: string, additive: boolean) => {
    const parsed = parsePartId(partId)
    const panelIndex = parsed?.panelIndex ?? 0
    if (additive) {
      // Toggles this panel into the selection WITHOUT moving which part
      // is selected — the options column stays where it was.
      setSelectedPanelIndices((prev) =>
        prev.includes(panelIndex) ? prev.filter((i) => i !== panelIndex) : [...prev, panelIndex],
      )
      return
    }
    setSelectedPartId(partId)
    setActivePanelIndex(panelIndex)
    setSelectedPanelIndices([panelIndex])
    setSelectedBarId(null)
    setPendingDeleteBarId(null)
    // A sash/glass/fly-screen part carries its own section — a divider
    // or the frame carries none (`sectionIndex: null`), so the active
    // section simply stays whatever it already was.
    if (parsed?.sectionIndex !== null && parsed?.sectionIndex !== undefined) {
      setActiveSectionIndex(parsed.sectionIndex)
    }
  }

  // ---- Active panel/section options --------------------------------------

  const sashOptions = (profilesQuery.data ?? [])
    .filter((p) => p.profileType === ProfileType.LEAF && p.catalog === activeInfo?.frame?.catalog)
    .sort((a, b) => a.profileNo.localeCompare(b.profileNo))

  // A fixed section's sash equivalent — same catalogue-scoping rule.
  const beadOptions = (profilesQuery.data ?? [])
    .filter((p) => p.profileType === ProfileType.GLASS_BEADING && p.catalog === activeInfo?.frame?.catalog)
    .sort((a, b) => a.profileNo.localeCompare(b.profileNo))

  // For the "+" → Mullion/Transom popup's own profile picker — scoped to
  // whichever panel is actually being attached to (`attachPanels[0]`),
  // NOT `activeInfo`: hovering to attach a divider to panel 2 while panel
  // 1 is still the "active" one in the side panel are two different
  // panels in a multi-panel assembly, and a divider is hard-scoped to
  // ITS OWN frame's catalogue (bug-040), never the active panel's.
  const attachInfo = panelInfos[effectiveAttachIndices[0] ?? activePanelIndex] ?? activeInfo
  const dividerOptions = (profilesQuery.data ?? [])
    .filter((p) => p.profileType === ProfileType.TRANSOM && p.catalog === attachInfo?.frame?.catalog)
    .sort((a, b) => a.profileNo.localeCompare(b.profileNo))

  const glassOptions = [
    ...(glassQuery.data ?? [])
      .filter((g) => activeSectionInfo?.maxGlassAllowed != null && g.thickness <= activeSectionInfo.maxGlassAllowed)
      .map((g) => ({
        value: `${GlassKind.SINGLE}|${formatScopedRef(g.scope, g.id)}`,
        label: `${g.name} — ${g.thickness} mm`,
        scope: g.scope,
      })),
    ...(combinationsQuery.data ?? [])
      .filter((c) => activeSectionInfo?.maxGlassAllowed != null && c.totalThickness <= activeSectionInfo.maxGlassAllowed)
      .map((c) => ({
        value: `${GlassKind.COMBINATION}|${formatScopedRef(c.scope, c.id)}`,
        label: `${c.name} — ${c.totalThickness} mm`,
        scope: c.scope,
      })),
  ]
  const glassValue = activeSection?.glass ? `${activeSection.glassKind}|${activeSection.glass}` : ''

  // The active SECTION's own weight estimate, for the options column's
  // weight line. Recomputed here rather than plucked out of
  // `issuesByPart`, which only carries the translated message, not the
  // number — and which stays empty until `showValidation`.
  const activeSashPart = drawingLayout.parts.find(
    (p) => p.panelIndex === activePanelIndex && p.kind === 'sash' && p.sectionIndex === activeSectionIndex,
  )
  const activeSashWeightKg =
    activeSectionInfo?.sash && (activeSectionInfo.currentGlass ?? activeSectionInfo.currentCombination) && activeSashPart
      ? computeSashWeightKg({
          rectMm: activeSashPart.rectMm,
          glassWeightPerSqm: resolveGlassWeightPerSqm(
            activeSection.glassKind,
            activeSectionInfo.currentGlass,
            activeSectionInfo.currentCombination,
            glassQuery.data ?? [],
          ),
          sashProfile: activeSectionInfo.sash,
          head: activeSashPart.head,
          bars: activePanel.bars,
        })
      : null

  // Changing the frame invalidates every SECTION's sash (scoped to its
  // catalogue) and, transitively, glass — same cascade rule
  // ProjectPreferencesFields uses for brand → catalogue, just applied
  // across the whole panel's sections now instead of one panel-level
  // field.
  const onFrameChange = (ref: ScopedRef) => {
    // What system the NEW frame belongs to — resolved here rather than
    // waiting for `useResolvedPanels` to catch up next render, so the
    // sliding layout can be written in the same update as the frame.
    const nextSystem = systemTypeOfFrame(ref)
    const rails = slidingRailsOfFrame(ref)
    // Every OPENING section of a panel that becomes sliding gets the
    // default layout (decision 5) — or its remembered one if it was
    // sliding before and the user only re-picked the frame; a panel
    // that stops being sliding drops every layout (the schema forbids
    // one elsewhere). Either way each layout is fitted to the NEW
    // profile's rail count (planing §11, decision 14): sashes on rails
    // the new frame doesn't have move to its front rail, and one toast
    // says which (sash numbers, across sections).
    const moved: number[] = []
    const slidingFor = (s: WindowSectionInput, sectionIndex: number): SlidingLayoutInput | null => {
      if (nextSystem !== SystemType.SLIDING || s.kind !== SectionKind.OPENING) return null
      const kept = s.sliding ?? rememberedSlidingLayouts.current.get(rememberKey(activePanelIndex, sectionIndex)) ?? defaultSlidingLayout()
      if (rails === null) return kept
      const remapped = remapSlidingRails(kept, rails)
      moved.push(...remapped.moved.map((i) => i + 1))
      return remapped.layout
    }
    const sections = activePanel.sections.map((s, sectionIndex) => ({
      ...s,
      sashProfile: s.kind === SectionKind.OPENING ? ('' as ScopedRef) : null,
      // Bead options are scoped to the frame's catalogue exactly like
      // sash options are — a frame change invalidates a fixed
      // section's pick the same way it invalidates an opening one's.
      beadProfile: s.kind === SectionKind.FIXED ? ('' as ScopedRef) : null,
      glass: '' as ScopedRef,
      sliding: slidingFor(s, sectionIndex),
    }))
    if (moved.length > 0) onSlidingRailsShrunk(moved)
    updateActivePanel({ frameProfile: ref, sections })
  }

  const onDividerProfileChange = (ref: ScopedRef) => updateActivePanel({ dividerProfile: ref })

  // Switching a section's own kind — decision 6: fixed by default,
  // switching to opening resets sash/glass to "not yet chosen" (the
  // drawing shows no sash until one is picked) with a sensible default
  // opening type; switching back to fixed clears everything an opening
  // section carries that a fixed one can't (the schema itself forbids
  // them).
  const onSectionKindChange = (kind: SectionKind) => {
    if (kind === SectionKind.FIXED) {
      // A fixed sliding light has no layout (decision 6) — but keep the
      // one being dropped in component state so "Opening" brings it
      // back instead of a blank default (handoff: "change back to
      // sliding restores it").
      if (activeSection.sliding) rememberedSlidingLayouts.current.set(rememberKey(activePanelIndex, activeSectionIndex), activeSection.sliding)
      updateActiveSection({ kind, sashProfile: null, beadProfile: '' as ScopedRef, openingType: null, hasFlyScreen: false, sliding: null })
      return
    }
    // A sliding section is "opening" with no hinge type at all (the
    // schema's own rule) — only a hinged one gets the default type.
    updateActiveSection({
      kind,
      sashProfile: '' as ScopedRef,
      beadProfile: null,
      openingType: activeIsSliding ? null : HingedOpeningType.SIDE_HUNG_RIGHT,
      sliding: activeIsSliding
        ? (rememberedSlidingLayouts.current.get(rememberKey(activePanelIndex, activeSectionIndex)) ?? defaultSlidingLayout())
        : null,
    })
  }

  // The sliding layout editor's one write path (planing §7): every
  // control in `sliding-layout-editor.tsx` — and any future context
  // menu or keyboard shortcut — lands here, already re-derived, so an
  // `auto` sash can never be stored disagreeing with its rails.
  // A layout landing on a FIXED sliding section (its tiles double as
  // the fixed/opening choice, 2026-09-20) flips that section to
  // opening in the same write — the `onSectionKindChange(OPENING)`
  // reset, minus the layout it would restore, since this IS the layout.
  const setSlidingLayoutOf = (panelIndex: number, sectionIndex: number, layout: SlidingLayoutInput) => {
    const next = resolveSlidingLayout(layout)
    rememberedSlidingLayouts.current.set(rememberKey(panelIndex, sectionIndex), next)
    const write = (section: WindowSectionInput): WindowSectionInput =>
      section.kind === SectionKind.FIXED
        ? { ...section, kind: SectionKind.OPENING, sashProfile: '' as ScopedRef, beadProfile: null, openingType: null, sliding: next }
        : { ...section, sliding: next }
    setValue(
      'panels',
      panels.map((panel, i) =>
        i === panelIndex ? { ...panel, sections: panel.sections.map((s, j) => (j === sectionIndex ? write(s) : s)) } : panel,
      ),
      { shouldValidate: true, shouldDirty: true },
    )
  }
  const setSlidingLayout = (layout: SlidingLayoutInput) => setSlidingLayoutOf(activePanelIndex, activeSectionIndex, layout)
  // One sash of one section — the quick menu's and the keyboard's entry
  // point (planing §7/§10), so both land on exactly the same write as
  // the part panel's rows.
  const updateSlidingSash = (
    panelIndex: number,
    sectionIndex: number,
    sashIndex: number,
    changes: Partial<SlidingLayoutInput['sashes'][number]>,
  ) => {
    const layout = panels[panelIndex]?.sections[sectionIndex]?.sliding
    if (!layout) return
    setSlidingLayoutOf(panelIndex, sectionIndex, {
      ...layout,
      sashes: layout.sashes.map((sash, i) => (i === sashIndex ? { ...sash, ...changes } : sash)),
    })
  }
  /** The sliding sash a part id names — `null` for anything else
   * (frame, glass, a legacy sash with no layout, a hinged sash). */
  const slidingSashOf = (partId: string | null) => {
    if (!partId) return null
    const hit = drawingLayout.parts.find((p) => p.id === partId)
    if (!hit) return null
    // The pointer is far more often over a sash's GLASS than its stiles
    // — a glass part carries its sash's `index`, so it resolves to the
    // same sash (bug-059: the menu never opened from the glass).
    const part =
      hit.kind === 'glass'
        ? drawingLayout.parts.find(
            (p) => p.kind === 'sash' && p.panelIndex === hit.panelIndex && p.sectionIndex === hit.sectionIndex && p.index === hit.index,
          )
        : hit
    if (!part || part.kind !== 'sash' || !part.sliding) return null
    const sectionIndex = part.sectionIndex ?? 0
    const layout = panels[part.panelIndex]?.sections[sectionIndex]?.sliding
    if (!layout) return null
    // A sash beyond the profile's rails can still move BACK (that's the
    // fix), so the bound only stops moving further forward.
    const rails = slidingRailsOfFrame(panels[part.panelIndex]?.frameProfile ?? null) ?? 0
    return { partId, panelIndex: part.panelIndex, sectionIndex, index: part.index, layout, rails, sash: layout.sashes[part.index] }
  }
  // Which sash the right-click menu is open FOR — captured on open,
  // since `hoveredPartId` keeps moving with the pointer while the menu
  // is up. The trigger is disabled unless the pointer is over a sliding
  // sash, so a right-click anywhere else is the browser's own menu.
  const [menuSashPartId, setMenuSashPartId] = useState<string | null>(null)
  const hoveredSlidingSash = slidingSashOf(hoveredPartId)
  const menuSashEntry = slidingSashOf(menuSashPartId)
  const menuSash = menuSashEntry?.sash ? { ...menuSashEntry, sash: menuSashEntry.sash } : null

  // The hinged opening-type grid IS the fixed/opening choice now (Mario,
  // 2026-09-13: a separate Fixed/Opening toggle is redundant once the
  // grid already carries `FIXED_CLOSED`) — picking it does exactly what
  // `onSectionKindChange(FIXED)` does above; picking any real hinge type
  // does what `onSectionKindChange(OPENING)` does, but with the ACTUAL
  // type clicked rather than always defaulting to `SIDE_HUNG_RIGHT`, and
  // keeps whatever sash profile was already picked rather than resetting
  // it — switching from one hinge style to another shouldn't lose it.
  // The plain Fixed/Opening toggle still exists for sliding/curtain-wall
  // sections (`window-part-panel.tsx`'s `!showOpeningTypes` branch),
  // which have no opening-type grid to fold this into.
  const onSectionOpeningTypeChange = (value: HingedOpeningType | null) => {
    if (value === null || value === HingedOpeningType.FIXED_CLOSED) {
      updateActiveSection({
        kind: SectionKind.FIXED,
        sashProfile: null,
        beadProfile: activeSection.kind === SectionKind.FIXED ? activeSection.beadProfile : ('' as ScopedRef),
        openingType: null,
        hasFlyScreen: false,
      })
      return
    }
    updateActiveSection({
      kind: SectionKind.OPENING,
      sashProfile: activeSection.kind === SectionKind.OPENING ? activeSection.sashProfile : ('' as ScopedRef),
      beadProfile: null,
      openingType: value,
    })
  }

  // ---- Per-panel render descriptors --------------------------------------

  // `useResolvedPanels` already did the catalogue work (colours, glass
  // tint, Georgian grid) per section. Two fields are overridden here:
  // `placement` uses the drawable fallback so an unsized panel still
  // renders, and each section's opening-type/fly-screen come from the
  // sanitised view rather than the raw form value.
  const panelRenders: PanelRender[] = resolved.map((r, i) => ({
    ...r.render,
    placement: layoutInput[i],
    isDoor: sanitizedPanels[i].isDoor,
    sections: sectionRendersFor(i),
  }))

  // ---- Issues ------------------------------------------------------------

  // A brand-new window starts with every required field empty — showing
  // "Pick a sash profile." before the user has touched anything reads as
  // the dialog already complaining. Editing an existing window always
  // shows its real issues; creating one stays quiet until first submit.
  const showValidation = isEdit || isSubmitted

  const issuesByPart = new Map<string, TranslatedIssue[]>()
  if (showValidation) {
    sanitizedPanels.forEach((panel, i) => {
      const info = panelInfos[i]
      const parts = drawingLayout.parts.filter((p) => p.panelIndex === i)
      const framePart = parts.find((p) => p.kind === 'frame')
      // §7's archObstructed: a panel resting on an arched panel's own
      // curved head carves a void inside the assembly rather than at
      // its outline — checked against the RAW placements (`panels`),
      // same as `irregularOutline`/`panelsConnected` above use, not the
      // drawable-fallback `layoutInput`. Panel-level, so it's computed
      // once per panel, not once per section.
      const hasArchedHeadHere = !!framePart?.head
      const hasPanelOnTop = panels.some((other, j) => j !== i && touchesTopEdge(panels[i], other))

      // Panel-level rules (V1, V8, archWithMullion) plus each section's
      // sliding-layout rules — computed once per panel, not once per
      // section (docs/sections_tasks.md Step 7 / §6's own note on why
      // these can't live inside the loop below).
      for (const issue of collectPanelIssues({
        dividerProfile: panel.dividerProfile,
        columnWidths: panel.columnWidths,
        rowHeights: panel.rowHeights,
        widthMm: panel.widthMm,
        heightMm: panel.heightMm,
        headShape: panel.headShape,
        systemType: info.systemType,
        framePartId: framePart?.id ?? `p${i}:frame`,
        slidingRails: info.frame?.slidingRails ?? null,
        hasFrame: !!info.frame,
        sections: slidingSectionArgs(panel.sections, parts),
      })) {
        const translated: TranslatedIssue = {
          severity: issue.severity,
          messageKey: issue.messageKey,
          message: t(`windowDialog.design.issues.${issue.messageKey}`, issue.values),
        }
        issuesByPart.set(issue.partId, [...(issuesByPart.get(issue.partId) ?? []), translated])
      }

      panel.sections.forEach((section, sectionIndex) => {
        const sectionInfo = info.sections[sectionIndex]
        const sectionParts = parts.filter((p) => p.sectionIndex === sectionIndex)
        const sashPart = sectionParts.find((p) => p.kind === 'sash')
        const sashPartIds = sectionParts.filter((p) => p.kind === 'sash').map((p) => p.id)
        const glassPartIds = sectionParts.filter((p) => p.kind === 'glass').map((p) => p.id)
        const flyScreenPartId = sectionParts.find((p) => p.kind === 'flyScreen')?.id ?? null
        const glassWeightPerSqm = resolveGlassWeightPerSqm(
          section.glassKind,
          sectionInfo?.currentGlass,
          sectionInfo?.currentCombination,
          glassQuery.data ?? [],
        )
        const sashWeightKg =
          sectionInfo?.sash && (sectionInfo.currentGlass ?? sectionInfo.currentCombination) && sashPart
            ? computeSashWeightKg({
                rectMm: sashPart.rectMm,
                glassWeightPerSqm,
                sashProfile: sectionInfo.sash,
                head: sashPart.head,
                bars: panel.bars,
              })
            : null

        for (const issue of collectWindowIssues({
          frameProfile: info.frame,
          sectionKind: section.kind,
          sashProfile: sectionInfo?.sash,
          beadProfile: sectionInfo?.bead,
          hasGlass: !!section.glass,
          glassThickness: sectionInfo?.currentGlass?.thickness ?? sectionInfo?.currentCombination?.totalThickness ?? null,
          maxGlassAllowed: sectionInfo?.maxGlassAllowed ?? null,
          sashWeightKg,
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
          columnWidthMm: panel.columnWidths[section.col] ?? panel.widthMm,
          rowHeightMm: panel.rowHeights[section.row] ?? panel.heightMm,
          isArchedOpeningSection: hasArchedHeadHere && section.row === 0 && section.kind === SectionKind.OPENING,
          // `info.showOpeningTypes` is exactly `systemType === HINGED`
          // (window-render.ts) — the same flag `sanitizedPanels` already
          // uses to decide whether `openingType` survives at all, so a
          // sliding/curtain-wall section (genuinely opening, always
          // null — bug-034) can never reach here with this true.
          openingTypeRequired: section.kind === SectionKind.OPENING && info.showOpeningTypes && section.openingType == null,
        })) {
          const translated: TranslatedIssue = {
            severity: issue.severity,
            messageKey: issue.messageKey,
            message: t(`windowDialog.design.issues.${issue.messageKey}`, issue.values),
          }
          issuesByPart.set(issue.partId, [...(issuesByPart.get(issue.partId) ?? []), translated])
        }
      })
    })

    // V9 `dividerMisaligned` — cross-panel, so it runs once over the
    // whole assembly rather than inside the per-panel loop above (same
    // posture as `irregularOutline`/`disconnectedPanels` below).
    for (const { panelIndex, localId } of findMisalignedDividers(sanitizedPanels)) {
      const translated: TranslatedIssue = {
        severity: 'warning',
        messageKey: 'dividerMisaligned',
        message: t('windowDialog.design.issues.dividerMisaligned'),
      }
      const partId = `p${panelIndex}:${localId}`
      issuesByPart.set(partId, [...(issuesByPart.get(partId) ?? []), translated])
    }
  }

  // Assembly-level, so they belong to no drawn part.
  const assemblyIssues: TranslatedIssue[] = []

  // A stepped outline is a real fabricated shape — amber, and Save stays
  // enabled, same posture as the sash-weight estimate.
  const irregularOutline = panels.length > 1 && allPanelsSized && !tilesExactly(panels)
  if (irregularOutline) {
    assemblyIssues.push({
      severity: 'warning',
      messageKey: 'irregularOutline',
      message: t('windowDialog.design.issues.irregularOutline'),
    })
  }

  // Red, not amber: the API rejects a disconnected assembly outright.
  // Resizing can reach this state — shrinking a panel narrower than the
  // one it was the only bridge to strands the rest — so it's surfaced
  // live here instead of only as a 400 on Save.
  if (panels.length > 1 && allPanelsSized && !panelsConnected(panels)) {
    assemblyIssues.push({
      severity: 'error',
      messageKey: 'disconnectedPanels',
      message: t('windowDialog.design.issues.disconnectedPanels'),
    })
  }

  if (assemblyIssues.length > 0) issuesByPart.set(ASSEMBLY_PART_ID, assemblyIssues)

  // The strip below the drawing — one row per distinct (part, message)
  // pair, not per message alone. Deduping by message text ONLY (as this
  // used to) collapses every panel sharing the identical issue (four
  // panels all missing a sash profile, say) down to a single clickable
  // link pointing at whichever panel happened to iterate first — Mario
  // caught this live ("if all the panels has errors show error inside
  // each one of them not on the main window frame"): the other panels'
  // identical issues silently had nowhere to click through to. Keying
  // on `partId` too still collapses a genuinely redundant repeat of the
  // SAME message on the SAME part (the scenario the original comment
  // actually had in mind), while giving every troubled panel its own
  // row.
  const stripIssues: { partId: string; severity: TranslatedIssue['severity']; message: string }[] = []
  const seenPartMessages = new Set<string>()
  for (const [partId, issues] of issuesByPart) {
    for (const issue of issues) {
      const key = `${partId} ${issue.message}`
      if (seenPartMessages.has(key)) continue
      seenPartMessages.add(key)
      stripIssues.push({ partId, ...issue })
    }
  }

  // ---- Submit --------------------------------------------------------------

  const onSubmit = async (data: CreateWindowInput) => {
    try {
      // Submits the sanitised panels, never the raw ones — a stale
      // openingType on a section whose frame is no longer hinged must
      // not reach the API just because the control that set it is
      // hidden.
      const body: CreateWindowInput = { ...data, panels: sanitizedPanels }
      if (isEdit) {
        const { projectId: _ignored, ...editable } = body
        await updateMutation.mutateAsync(editable)
        toast.success(t('windowDialog.updated'))
      } else {
        const created = await createMutation.mutateAsync(body)
        toast.success(t('windowDialog.created', { name: created.name }))
      }
      onDone()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('windowDialog.error')))
    }
  }

  // Once a frame profile is picked, its catalogue's system type is known
  // — swap the generic title for one naming it (e.g. "New sliding
  // window"), same label text `lookups.json`'s systemType filter uses.
  const pageTitle = activeInfo?.systemType
    ? t(isEdit ? 'windowDialog.editTitleTyped' : 'windowDialog.createTitleTyped', {
        type: tLookups(`systemType.${activeInfo.systemType}`).toLowerCase(),
      })
    : t(isEdit ? 'windowDialog.editTitle' : 'windowDialog.createTitle')

  // Favouriting a frame also updates the project's own catalogue/brand
  // defaults, not just favoriteFrameProfile — a favourite frame that
  // isn't the project's own default catalogue would otherwise leave the
  // tree's "preferred catalogue" expansion pointing at the wrong branch
  // every time this screen opens next. `ref` is whichever profile was
  // right-clicked in the tree, not necessarily the one currently
  // selected on the form, so its catalogue/brand are looked up fresh.
  const onSetFavorite = (ref: ScopedRef) => {
    if (!project) return
    const favoritedProfile = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === ref)
    const favoritedCatalog = favoritedProfile
      ? catalogsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === favoritedProfile.catalog)
      : undefined
    updateProjectMutation.mutate(
      {
        favoriteFrameProfile: ref,
        ...(favoritedProfile ? { defaultSystemCatalog: favoritedProfile.catalog } : {}),
        ...(favoritedCatalog ? { defaultSystemBrand: favoritedCatalog.brand } : {}),
      },
      {
        onError: (err) => toast.error(apiErrorMessage(err, t('windowDialog.error'))),
      },
    )
  }

  // ---- Selected divider ---------------------------------------------------
  //
  // A divider's own id is panel-level (`div-v{k}`/`div-h{j}`, `sectionIndex:
  // null`) — matched here from `selectedPartId` rather than threaded
  // through as separate state, since the drawing's own selection is
  // already the single source of truth for "what's selected".
  const selectedDividerMatch = selectedPartId ? /^div-(v|h)(\d+)$/.exec(parsePartId(selectedPartId)?.localId ?? '') : null
  const selectedDividerOrientation: 'vertical' | 'horizontal' | null = selectedDividerMatch
    ? selectedDividerMatch[1] === 'v'
      ? 'vertical'
      : 'horizontal'
    : null
  const selectedDividerK = selectedDividerMatch ? Number(selectedDividerMatch[2]) : null
  const selectedDividerPart = selectedDividerMatch ? drawingLayout.parts.find((p) => p.id === selectedPartId) : null
  const selectedDivider =
    selectedDividerPart && selectedDividerOrientation && selectedDividerK !== null
      ? {
          label:
            selectedDividerOrientation === 'vertical'
              ? t('windowDialog.design.parts.mullion')
              : t('windowDialog.design.parts.transom'),
          profileNumber: activeInfo?.dividerProfile?.profileNo,
          lengthMm: selectedDividerOrientation === 'vertical' ? selectedDividerPart.rectMm.height : selectedDividerPart.rectMm.width,
          onRemove: () => onRemoveDivider(selectedDividerOrientation, selectedDividerK),
        }
      : null

  // Keyboard control of the selected divider: arrow keys nudge it 1mm
  // (a press moves it once, holding the key repeats via the browser's
  // own native key-repeat — same redistribute-between-neighbours
  // behaviour and 100mm floor as `onDividerDrag`'s drag), Delete/
  // Backspace removes it (same merge-into-neighbour behaviour as
  // `onRemoveDivider`'s own button). Both are inlined here rather than
  // called through those two functions so this effect doesn't need to
  // depend on functions recreated every render. The drawing is fixed
  // `dir="ltr"` regardless of app locale (see its own note elsewhere in
  // this file), so Left/Right always means the same physical direction
  // here too.
  useEffect(() => {
    if (!selectedPartId || !selectedDividerOrientation || selectedDividerK === null) return
    const panelIndex = parsePartId(selectedPartId)?.panelIndex
    if (panelIndex === undefined) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        const next = removeDivider(panels, panelIndex, selectedDividerOrientation, selectedDividerK)
        const updated = next[panelIndex]
        if (!updated) return
        const stillGridded = updated.columnWidths.length > 1 || updated.rowHeights.length > 1
        const final = stillGridded ? next : next.map((p, i) => (i === panelIndex ? { ...p, dividerProfile: null } : p))
        setValue('panels', final, { shouldValidate: true, shouldDirty: true })
        setSelectedPartId(`p${panelIndex}:frame`)
        setActiveSectionIndex(0)
        return
      }

      const deltaMm =
        selectedDividerOrientation === 'vertical'
          ? event.key === 'ArrowLeft'
            ? -1
            : event.key === 'ArrowRight'
              ? 1
              : null
          : event.key === 'ArrowUp'
            ? -1
            : event.key === 'ArrowDown'
              ? 1
              : null
      if (deltaMm === null) return

      const panel = panels[panelIndex]
      if (!panel) return
      const pitches = selectedDividerOrientation === 'vertical' ? panel.columnWidths : panel.rowHeights
      const currentBoundary = cumulativeBoundaries(pitches)[selectedDividerK]
      if (currentBoundary === undefined) return

      event.preventDefault()
      setValue('panels', moveDivider(panels, panelIndex, selectedDividerOrientation, selectedDividerK, currentBoundary + deltaMm), {
        shouldValidate: true,
        shouldDirty: true,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPartId, selectedDividerOrientation, selectedDividerK, panels, setValue, setSelectedPartId, setActiveSectionIndex])

  // Keyboard control of a selected SLIDING sash (planing §10, the
  // handoff's shortcuts): `[` moves it one rail back (toward the
  // outside), `]` one rail forward, `←`/`→` select its neighbour sash.
  // Same input-focus guard as the divider handler above; `[`/`]` are
  // deliberately not arrows so they can't collide with the divider's.
  useEffect(() => {
    const selected = slidingSashOf(selectedPartId)
    if (!selected) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const { panelIndex, sectionIndex, index, layout, rails, sash } = selected
      if (!sash) return
      if (event.key === '[' || event.key === ']') {
        const rail = sash.rail + (event.key === '[' ? -1 : 1)
        if (rail < 0 || rail >= rails) return
        event.preventDefault()
        updateSlidingSash(panelIndex, sectionIndex, index, { rail })
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const next = index + (event.key === 'ArrowLeft' ? -1 : 1)
        if (next < 0 || next >= layout.sashes.length) return
        event.preventDefault()
        setSelectedPartId(`p${panelIndex}:s${sectionIndex}:sash-${next}`)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // `slidingSashOf`/`updateSlidingSash` are plain closures over
    // `panels`/`drawingLayout`, recreated every render — depending on
    // their inputs is the honest dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartId, panels, drawingLayout])

  // The form hasn't been `reset()` with real data yet: `panels` above is
  // still `emptyWindow()`'s single 1000×1200 placeholder panel.
  // `WindowDrawing` must not mount against that placeholder geometry —
  // its `baseViewBox` fit-to-content view is captured ONCE via a lazy
  // `useState` initializer and never recomputed, so mounting it here
  // would freeze the "whole window" fit at the placeholder's tiny size
  // forever, leaving the real (usually much larger) assembly cropped
  // once `reset()` swaps the real data in one render later. Bug caught
  // live testing the new pan/zoom camera: opening any existing
  // multi-panel window showed it zoomed in and cut off from the very
  // first frame — even gating on `editingWindow` alone wasn't enough,
  // since a cache-warm query can already have data on the FIRST paint,
  // before the `reset()` effect (which only runs after that paint) has
  // actually applied it. `formReady` is set true in that same effect,
  // right after `reset()`, so it's the one signal that's actually true
  // only once `watch('panels')` reflects the real data.
  if (!formReady) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        <p>{t('windowDialog.loading')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-svh flex-col bg-background">
        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-border p-4">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('actions.back')}
              onClick={() => requestLeave(onDone)}
            >
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
            <h1 className="font-heading text-base font-medium">{pageTitle}</h1>
          </header>

          {/* A frame profile tree (18rem) + the drawing (1fr) + a
              fixed-width options column, so all three stay put and
              never reflow when a different part is selected, per
              docs/window_design_planing.md's decisions table. Tree
              narrowed from its original 22rem — it only ever holds
              short profile codes, and the drawing is what benefits from
              the room. */}
          <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr_26rem] gap-4 overflow-hidden p-4">
            <div className="flex min-h-0 min-w-0 flex-col border-e border-border ps-1 pe-3">
              <FieldLabel htmlFor="window-frame" required>
                {t('fields.frameProfile')}
              </FieldLabel>
              <div className="mt-1.5 min-h-0 min-w-0 flex-1">
                <ProfileTreePicker
                  profileType={ProfileType.FRAME}
                  value={activePanel.frameProfile || null}
                  onChange={onFrameChange}
                  favoriteRef={project?.favoriteFrameProfile}
                  onSetFavorite={project ? onSetFavorite : undefined}
                  preferredCatalogRef={isEdit ? undefined : project?.defaultSystemCatalog}
                  preferredBrandRef={isEdit ? undefined : project?.defaultSystemBrand}
                />
              </div>
              {showValidation && errors.panels && (
                <p className="mt-1 shrink-0 text-xs text-destructive">{t('fields.frameProfileRequired')}</p>
              )}
            </div>

            <div className="flex min-h-0 flex-col gap-1.5">
              {/* No Interior/Exterior toggle: the elevation is always the
                  interior view for now (`DRAWING_FACE`, 2026-09-20). */}
              <ContextMenu
                onOpenChange={(open) => {
                  if (!open) {
                    setMenuSashPartId(null)
                    return
                  }
                  // Opening also selects the sash, like a left-click —
                  // so the part panel below shows the row being acted on.
                  if (hoveredSlidingSash) {
                    setMenuSashPartId(hoveredSlidingSash.partId)
                    onSelectPart(hoveredSlidingSash.partId, false)
                  }
                }}
              >
              <ContextMenuTrigger asChild disabled={!hoveredSlidingSash}>
              <div className="min-h-0 flex-1">
                <WindowDrawing
                  layout={drawingLayout}
                  panels={panelRenders}
                  selectedPartId={selectedPartId}
                  hoveredPartId={hoveredPartId}
                  onSelect={onSelectPart}
                  onHover={setHoveredPartId}
                  selectedPanelIndices={panels.length > 1 ? selectedPanelIndices : []}
                  activePanelIndex={activePanelIndex}
                  attachRect={attachRect}
                  attachSides={attachSides}
                  onPanelHover={setHoveredPanelIndex}
                  onAddPanel={onAddPanel}
                  overlay={
                    addChoice === null ? (
                      <AddPanelTypeStep anchor={addRequest} allowDivider={allowDivider} onCancel={onCancelAddPanel} onChoose={setAddChoice} />
                    ) : addChoice === 'window' ? (
                      <AddPanelCard request={addRequest} error={addError} onCancel={onCancelAddPanel} onConfirm={onConfirmAddPanel} />
                    ) : (
                      <AddDividerCard
                        request={addRequest}
                        title={
                          addRequest?.side === 'left' || addRequest?.side === 'right'
                            ? t('windowDialog.design.addPanel.mullion')
                            : t('windowDialog.design.addPanel.transom')
                        }
                        error={addError}
                        onCancel={onCancelAddPanel}
                        onConfirm={onConfirmDivider}
                        initialDividerProfile={attachPanels[0]?.dividerProfile ?? ''}
                        dividerOptions={dividerOptions}
                      />
                    )
                  }
                  issuesByPart={issuesByPart}
                  barDrawMode={barDrawMode}
                  onExitBarDrawMode={() => setBarDrawMode(false)}
                  onAddBar={(bar) => updateActivePanel({ bars: [...activeBars, bar] })}
                  selectedBarId={selectedBarId}
                  onSelectBar={onSelectBar}
                  pendingDeleteBarId={pendingDeleteBarId}
                  onRequestDeleteBar={onRequestDeleteBar}
                  onUpdateBarAnchor={(barId, end, anchor) =>
                    updateActivePanel({ bars: activeBars.map((b) => (b.id === barId ? { ...b, [end]: anchor } : b)) })
                  }
                  onUpdateBarSag={(barId, sagMm) =>
                    updateActivePanel({ bars: activeBars.map((b) => (b.id === barId ? { ...b, sagMm } : b)) })
                  }
                  onDividerDrag={onDividerDrag}
                  onPanelEdgeDrag={onPanelEdgeDrag}
                />
              </div>
              </ContextMenuTrigger>
              {menuSash && (
                <ContextMenuContent>
                  <ContextMenuItem
                    disabled={menuSash.sash.rail === 0}
                    onSelect={() => updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { rail: menuSash.sash.rail - 1 })}
                  >
                    {t('fields.sliding.moveBack')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={menuSash.sash.rail >= menuSash.rails - 1}
                    onSelect={() => updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { rail: menuSash.sash.rail + 1 })}
                  >
                    {t('fields.sliding.moveForward')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {(
                    [SlidingOpeningType.LEFT, SlidingOpeningType.FREE, SlidingOpeningType.RIGHT] as const
                  ).map((type) => {
                    const suggested = suggestSlidingOpeningType(
                      menuSash.layout.sashes.map((x) => x.rail),
                      menuSash.index,
                    )
                    const current = menuSash.sash.openingType === type
                    return (
                      <ContextMenuItem
                        key={type}
                        onSelect={() =>
                          updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { openingType: type, directionSource: SlidingDirectionSource.MANUAL })
                        }
                      >
                        <span className="w-4 text-center">{current ? '✓' : ''}</span>
                        {t(`fields.sliding.types.${type}`)}
                        {suggested === type && <span className="ms-auto text-xs text-muted-foreground">{t('fields.sliding.suggested')}</span>}
                      </ContextMenuItem>
                    )
                  })}
                  {menuSash.sash.directionSource === SlidingDirectionSource.MANUAL && (
                    <ContextMenuItem
                      onSelect={() => updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { directionSource: SlidingDirectionSource.AUTO })}
                    >
                      <span className="w-4" />
                      {t('fields.sliding.resetAuto')}
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  {/* Acts on the ACTIVE section — opening the menu selected this
                      sash, so that is its own section by the time this fires. */}
                  <ContextMenuItem onSelect={() => onSectionKindChange(SectionKind.FIXED)}>
                    {t('fields.sliding.wholeFrameFixed')}
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
              </ContextMenu>
              {/* Every band width the drawing is built from is a
                  placeholder until profiles carry their own (planing
                  decision 10) — say so under the drawing, gated on
                  the resolver's own `source`, not a flag, so the
                  caption disappears by itself the day real numbers
                  arrive. */}
              {resolved.some((r) => r.render.metrics.source === 'PLACEHOLDER') && (
                <p className="shrink-0 pt-1 text-[11px] text-muted-foreground">
                  {t('windowDialog.design.illustrationOnly')}
                </p>
              )}
              {stripIssues.length > 0 && (
                <ul className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1.5 text-xs">
                  {stripIssues.map((issue) =>
                    // The assembly-level note points at no part, so it's
                    // plain text rather than a click-to-select button.
                    issue.partId === ASSEMBLY_PART_ID ? (
                      <li key={issue.message} className="font-medium text-amber-600 dark:text-amber-500">
                        {issue.message}
                      </li>
                    ) : (
                      <li key={issue.partId + issue.message}>
                        <button
                          type="button"
                          onClick={() => onSelectPart(issue.partId, false)}
                          className={cn(
                            'underline decoration-dotted underline-offset-2',
                            issue.severity === 'error'
                              ? 'text-destructive'
                              : 'font-medium text-amber-600 dark:text-amber-500',
                          )}
                        >
                          {issue.message}
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>

            <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-s border-border px-3 pe-0 pb-4">
              {activeInfo && (
                <WindowPartPanel
                  layout={{
                    outerMm: {
                      width: layoutInput[activePanelIndex]?.widthMm ?? 0,
                      height: layoutInput[activePanelIndex]?.heightMm ?? 0,
                    },
                    parts: drawingLayout.parts.filter((p) => p.panelIndex === activePanelIndex),
                  }}
                  selectedPartId={selectedPartId}
                  issuesByPart={issuesByPart}
                  panelIndex={activePanelIndex}
                  panelCount={panels.length}
                  onDeletePanel={canDeletePanel ? onDeletePanel : undefined}
                  deleteDisabledReason={canDeletePanel ? undefined : t('windowDialog.design.deletePanelBlocked')}
                  name={watch('name')}
                  onNameChange={(value) => setValue('name', value, { shouldValidate: true, shouldDirty: true })}
                  nameError={showValidation && errors.name ? t('fields.windowNameRequired') : undefined}
                  quantity={quantity}
                  onQuantityChange={(value) => setValue('quantity', value, { shouldValidate: true, shouldDirty: true })}
                  quantityError={showValidation && errors.quantity ? t('fields.quantityRequired') : undefined}
                  widthMm={activeRaw?.widthMm ?? NaN}
                  heightMm={activeRaw?.heightMm ?? NaN}
                  onWidthChange={(mm) => onPanelSizeChange(mm, activeRaw?.heightMm ?? mm)}
                  onHeightChange={(mm) => onPanelSizeChange(activeRaw?.widthMm ?? mm, mm)}
                  widthError={showValidation && errors.panels ? t('fields.widthMmRequired') : undefined}
                  heightError={showValidation && errors.panels ? t('fields.heightMmRequired') : undefined}
                  headShape={activePanel.headShape}
                  headRiseMm={activePanel.headRiseMm ?? null}
                  onHeadShapeChange={(shape) => {
                    if (shape === HeadShape.FLAT) {
                      updateActivePanel({ headShape: shape, headRiseMm: null, bars: [] })
                      setBarDrawMode(false)
                      return
                    }
                    // A fresh, shape-appropriate default every time the
                    // shape button changes — NOT a carried-over rise
                    // from whatever shape was selected before. A rise
                    // that made sense for segmental can sit right at or
                    // below gothic's own minimum (see
                    // arch-geometry.ts's minGothicRiseMm), where gothic
                    // stops being a point and turns into a
                    // self-intersecting "heart" shape. With more than
                    // one row, the rise is pinned to the top row's own
                    // pitch instead of a freely-chosen default — the
                    // Rise input is read-only in that case anyway.
                    const widthForRise = drawableMm(activeRaw?.widthMm ?? NaN, PLACEHOLDER_WIDTH_MM)
                    const heightForRise = drawableMm(activeRaw?.heightMm ?? NaN, PLACEHOLDER_HEIGHT_MM)
                    if (activePanel.rowHeights.length > 1) {
                      updateActivePanel({ headShape: shape, headRiseMm: activePanel.rowHeights[0] })
                      return
                    }
                    const defaultRise =
                      shape === HeadShape.SEGMENTAL
                        ? Math.round(widthForRise / 3)
                        : shape === HeadShape.GOTHIC
                          ? Math.round(minGothicRiseMm(widthForRise) * 1.15) // clear margin past the floor, not sitting right on it
                          : Math.round(widthForRise / 2) // round — normalizeHeadRise pins this exactly regardless
                    updateActivePanel({
                      headShape: shape,
                      headRiseMm: normalizeHeadRise(shape, widthForRise, defaultRise, heightForRise),
                    })
                  }}
                  onHeadRiseChange={(mm) =>
                    updateActivePanel({
                      headRiseMm: normalizeHeadRise(
                        activePanel.headShape,
                        drawableMm(activeRaw?.widthMm ?? NaN, PLACEHOLDER_WIDTH_MM),
                        mm,
                        drawableMm(activeRaw?.heightMm ?? NaN, PLACEHOLDER_HEIGHT_MM),
                      ),
                    })
                  }
                  headShapeAllowed={canHaveArchedHead({
                    isDoor: activePanel.isDoor,
                    systemType: activeInfo.systemType,
                    cols: activePanel.columnWidths.length,
                    topRowOpeningType: activePanel.sections[0]?.openingType ?? null,
                  })}
                  headRiseReadOnly={activePanel.rowHeights.length > 1}
                  roundDisallowedGridded={activePanel.rowHeights.length > 1}
                  barDrawMode={barDrawMode}
                  onBarDrawModeChange={setBarDrawMode}
                  barCount={activePanel.bars.length}
                  selectedBar={
                    selectedBar
                      ? {
                          id: selectedBar.id,
                          lengthMm: selectedBarLengthMm,
                          radiusMm: selectedBarRadiusMm,
                          minRadiusMm: selectedBarMinRadiusMm,
                        }
                      : null
                  }
                  onRequestDeleteBar={onRequestDeleteBar}
                  onBarRadiusChange={onBarRadiusChange}
                  interiorColor={activePanel.interiorColor ?? null}
                  exteriorColor={activePanel.exteriorColor ?? null}
                  onInteriorColorChange={(value) => updateActivePanel({ interiorColor: value as ScopedRef | null })}
                  onExteriorColorChange={(value) => updateActivePanel({ exteriorColor: value as ScopedRef | null })}
                  colorOptions={colorOptions}
                  showDoor={activeInfo.showDoor}
                  isDoor={activePanel.isDoor}
                  onDoorChange={(value) => updateActivePanel({ isDoor: value })}
                  isGridded={activeIsGridded}
                  dividerProfile={activePanel.dividerProfile}
                  onDividerProfileChange={onDividerProfileChange}
                  dividerProfileError={showValidation && errors.panels ? t('fields.dividerProfileRequired') : undefined}
                  frameCatalogRef={activeInfo.frame?.catalog}
                  activeSection={{
                    sectionIndex: activeSectionIndex,
                    row: activeSection.row,
                    col: activeSection.col,
                    kind: activeSection.kind,
                    onKindChange: onSectionKindChange,
                    widthMm: activePanel.columnWidths[activeSection.col] ?? NaN,
                    heightMm: activePanel.rowHeights[activeSection.row] ?? NaN,
                    onWidthChange: onSectionWidthChange,
                    onHeightChange: onSectionHeightChange,
                    showOpeningTypes: activeInfo.showOpeningTypes,
                    openingType: activeSection.openingType ?? null,
                    onOpeningTypeChange: onSectionOpeningTypeChange,
                    sashProfile: activeSection.sashProfile ?? '',
                    sashOptions,
                    onSashChange: (ref) => updateActiveSection({ sashProfile: ref, glass: '' as ScopedRef }),
                    sashWeightKg: activeSashWeightKg,
                    maxSashWeight: activeInfo.maxSashWeight,
                    beadProfile: activeSection.beadProfile ?? '',
                    beadOptions,
                    onBeadChange: (ref) => updateActiveSection({ beadProfile: ref, glass: '' as ScopedRef }),
                    hasFlyScreen: activeSection.hasFlyScreen,
                    flyScreenAllowed: activeInfo.flyScreenAllowed,
                    onFlyScreenChange: (value) => updateActiveSection({ hasFlyScreen: value }),
                    isSliding: activeIsSliding,
                    slidingLayout: activeSection.sliding ?? null,
                    slidingRails: activeSlidingRails,
                    onSlidingLayoutChange: setSlidingLayout,
                    glassValue,
                    glassOptions,
                    onGlassChange: (kind, ref) => updateActiveSection({ glassKind: kind, glass: ref }),
                    maxGlassAllowed: activeSectionInfo?.maxGlassAllowed ?? null,
                    sashMaxGlassThickness: activeSectionInfo?.sashMaxGlassThickness ?? null,
                    beadMaxGlassThickness: activeSectionInfo?.beadMaxGlassThickness ?? null,
                  }}
                  selectedDivider={selectedDivider}
                  location={watch('location') ?? null}
                  onLocationChange={(value) => setValue('location', value, { shouldValidate: true, shouldDirty: true })}
                  notes={watch('notes') ?? null}
                  onNotesChange={(value) => setValue('notes', value, { shouldValidate: true, shouldDirty: true })}
                />
              )}
            </div>
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted/50 p-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => requestLeave(onDone)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? t('actions.save') : t('actions.create')}
            </Button>
          </footer>
        </form>
      </div>

      {/* Bar delete confirm — §6.3. The dependents it names are already
          highlighted in the danger colour on the drawing underneath by
          the time this renders (window-drawing.tsx reacts to
          `pendingDeleteBarId` directly), not just described in words
          here. A plain AlertDialog, not the typed-name confirm client/
          project deletion use — this is in-memory form state, gone the
          instant this screen is left without saving, not a server-side
          cascade. */}
      <AlertDialog open={pendingDeleteBarId !== null} onOpenChange={(next) => !next && setPendingDeleteBarId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fields.barsDeleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteDependentsCount > 0
                ? t('fields.barsDeleteConfirmDescriptionCascade', { count: pendingDeleteDependentsCount })
                : t('fields.barsDeleteConfirmDescriptionPlain')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeleteBar}>
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One gate for every way to leave this screen with unsaved
          changes — see `requestLeave` above. `onOpenChange(false)` is
          the single place that decides "Discard" from every other way
          the dialog closes (Cancel, Escape, an outside click all mean
          "stay"), via `confirmedRef` set just before Discard's own
          click closes it. */}
      <AlertDialog
        open={confirmLeave !== null}
        onOpenChange={(open) => {
          if (open) return
          if (confirmedRef.current) {
            confirmLeave?.onConfirm()
          } else {
            confirmLeave?.onCancel?.()
          }
          confirmedRef.current = false
          setConfirmLeave(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('windowDialog.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('windowDialog.discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => (confirmedRef.current = true)}>
              {t('actions.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** A panel with no size yet still has to draw as something. */
function drawableMm(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function emptyWindow(projectId: string, favoriteFrameProfile?: string | null): CreateWindowInput {
  return {
    projectId,
    name: '',
    quantity: 1,
    panels: [emptyPanel(favoriteFrameProfile)],
    location: null,
    notes: null,
  }
}

/** A blank panel — a 1×1 grid whose single section starts `kind:
 * 'opening'` (the 2026-09-13 fixed-light rule: no sash is drawn until
 * the sash profile is picked, and "opening ⇒ sashProfile set" is a
 * submit rule, not a draw-time one). Width/height are NaN, not 0, so
 * their inputs render empty rather than showing a number nobody typed
 * (the drawing falls back to PLACEHOLDER_* for the elevation) — and
 * `columnWidths`/`rowHeights` mirror that same NaN rather than `[NaN]`
 * disagreeing with a real `widthMm`. Always this panel's very first
 * panel, or the create-mode default — the "+" flow that grows a real
 * grid is `insertRow`/`insertColumn`, not this factory. */
function emptyPanel(favoriteFrameProfile?: string | null): WindowPanelInput {
  return {
    xMm: 0,
    yMm: 0,
    widthMm: NaN,
    heightMm: NaN,
    frameProfile: (favoriteFrameProfile ?? '') as ScopedRef,
    dividerProfile: null,
    columnWidths: [NaN],
    rowHeights: [NaN],
    sections: [
      {
        row: 0,
        col: 0,
        // A new window starts fixed (Mario, 2026-09-13) — matching
        // decision 6's general "a section is fixed by default" rule,
        // which this initial section used to carve an exception out of
        // (started `opening`/`SIDE_HUNG_RIGHT` to preserve the pre-Sections
        // "a new window opens" default). Same shape a "+"-added section
        // starts with (`onConfirmDivider`'s `makeSection`).
        kind: SectionKind.FIXED,
        sashProfile: null,
        beadProfile: '' as ScopedRef,
        openingType: null,
        glassKind: GlassKind.SINGLE,
        glass: '' as ScopedRef,
        hasFlyScreen: false,
        // No frame picked yet ⇒ no system yet ⇒ no sliding layout; the
        // editor writes `defaultSlidingLayout()` the moment this panel's
        // frame resolves to a sliding system (docs/sliding_windows_planing.md
        // §7), which is also what tells a brand-new section apart from
        // a saved legacy one that must NOT be backfilled.
        sliding: null,
      },
    ],
    isDoor: false,
    interiorColor: null,
    exteriorColor: null,
    // Flat/empty — the arch-heads feature's own UI (a Head section in
    // the part panel) lands in a later step; a brand-new panel is a
    // plain rectangle until the user asks for otherwise, same as every
    // panel before this feature existed.
    headShape: HeadShape.FLAT,
    headRiseMm: null,
    bars: [],
  }
}
