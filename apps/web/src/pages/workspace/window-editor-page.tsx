import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import {
  GlassKind,
  HeadShape,
  HingedOpeningType,
  SectionKind,
  createWindowSchema,
  type CreateWindowInput,
  type WindowDividerInput,
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
import { WindowDrawing } from '@/components/workspace/window-drawing'
import { WindowIssuesPanel } from '@/components/workspace/window-issues-panel'
import { cn } from '@/lib/utils'
import { displayName } from '@/lib/bilingual'
import { WindowStructurePanel } from '@/components/workspace/window-structure-panel'
import { ProfileSearchPicker } from '@/components/workspace/profile-search-picker'
import { panelIssueLights, slidingSectionArgs, useResolvedPanels, type PanelRender, type SectionRender } from '@/lib/window-render'
import { useEditHistory } from '@/lib/use-edit-history'
import { WindowPartPanel } from '@/components/workspace/window-part-panel'
import { AddPanelCard, type AddPanelRequest } from '@/components/workspace/add-panel-card'
import { AddPanelTypeStep, type AddChoice } from '@/components/workspace/add-panel-type-step'
import { AddDividerCard } from '@/components/workspace/add-divider-card'
import {
  buildAssemblyLayout,
  canHaveArchedHead,
  dividerNames,
  findMisalignedDividers,
  freeSidesOf,
  insertPanel,
  MIN_GLAZED_PITCH_MM,
  normalizeOrigin,
  originShiftMm,
  panelRect,
  panelsConnected,
  parsePartId,
  prefillForSide,
  removePanel,
  resizePanel,
  resizePanelEdge,
  tilesExactly,
  touchesTopEdge,
  unionRect,
  type AssemblyPanelInput,
  type PanelPlacement,
  type PanelSide,
} from '@/lib/window-geometry'
import { headBendRadiusMm, minGothicRiseMm, normalizeHeadRise, type PointMm } from '@/lib/arch-geometry'
import { allMembers, anchorOn, bendDivider, dividerProblems, isFrameMember, moveEnd, planDelete, moveStraight, resolveDividers, swapCrossing, zoneOf, type Crossing } from '@/lib/dividers'
import { pathProject } from '@/lib/curves'
import { DeleteDividerDialog, type DeleteDividerRequest } from '@/components/workspace/delete-divider-dialog'
import { defaultBowSign, radiusFromSag, sagFromRadius } from '@/lib/divider-draw'
import {
  addEdgeDivider,
  changeHeadShape,
  deleteDividers,
  isFixedOnlyLight,
  lightPitch,
  panelGeometry,
  panelLights,
  dividerSides,
  headShapeDoomed,
  resizeLight,
  stretchForEdge,
  withAlignedSections,
  withCuts,
  type PanelLightsContext,
} from '@/lib/panel-lights'
import { resolveProfileMetrics } from '@/lib/profile-metrics'
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
 * — selection, the add-panel flow — is only ever valid
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
  const { t, i18n } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const isEdit = !!windowId

  const onDone = () => void navigate(`/workspace/projects/${projectId}`)

  // Drawing selection/hover state — owned here (not inside WindowDrawing
  // itself) per docs/window_design_planing.md §3, so it can also drive
  // the options panel's scroll-to-and-highlight behaviour.
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  // Parts ⌘/Ctrl/Shift-clicked into the selection beside `selectedPartId`
  // (docs/free_dividers_planing.md §7) — dividers and lights of the same
  // panel, for "divider + light → Delete" (Q18). A modifier-click on the
  // frame still toggles the whole panel instead (Mario, 2026-10-05).
  const [extraPartIds, setExtraPartIds] = useState<string[]>([])
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null)
  // Which panel the options column edits, and which panels a new one
  // would attach to. They coincide except while multi-selecting.
  const [activePanelIndex, setActivePanelIndex] = useState(0)
  // Which of the active panel's own sections the Section block shows —
  // docs/sections_planing.md §5. Reset to the panel's first section by
  // each handler that moves the active panel (not an effect on
  // `activePanelIndex`: that fired after the render and wiped any
  // section set in the same batch — an undo restoring panel + section
  // together, or a click on another panel's second section).
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)
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
  const projectQuery = useProjectQuery(projectId)
  const project = projectQuery.data

  const editingWindowQuery = useWindowQuery(windowId)
  const editingWindow = editingWindowQuery.data
  // Which saved panels still carry a `migrated:` light — glazing bars
  // the FreeDividers migration turned into transoms, whose new lights the
  // user hasn't checked yet (`lightsChanged`, docs/free_dividers_planing.md
  // §2). The form itself is re-keyed on load, so this reads the saved
  // copy; it clears once the window is saved and reloaded.
  const loadedMigrated = (editingWindow?.panels ?? []).map((p) => p.sections.some((s) => s.faceKey.startsWith('migrated:')))

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
    getValues,
    setValue,
    watch,
    formState: { errors, isSubmitting, isSubmitted, isDirty },
  } = useForm<CreateWindowInput>({
    resolver: zodResolver(createWindowSchema),
    defaultValues: emptyWindow(projectId),
  })

  // How far the drawing's fixed camera has to follow the assembly's own
  // origin. Every panel edit lands through `commitPanels` below, which
  // re-normalises the origin to (0,0) — so anything that grew up or left
  // shifts every stored position down/right, and the drawing moves its
  // view by the same amount to keep the elevation still on screen (the
  // bottom-anchored height, the edge NOT being dragged, the panels a new
  // one was added above). See `originShiftMm` in window-geometry.ts.
  const [originOffsetMm, setOriginOffsetMm] = useState({ x: 0, y: 0 })

  // Undo/redo — docs/editor_undo_redo_planing.md. Snapshots of the five
  // edited fields (+ the camera offset `commitPanels` moves with them),
  // recorded at the doors below and applied by `applyStep` further down.
  const history = useEditHistory<EditorSnapshot, EditorView, EditLabel>()
  // Cloned so a stored step can never alias the live form's objects.
  const takeSnapshot = (): EditorSnapshot =>
    structuredClone({
      name: getValues('name'),
      quantity: getValues('quantity'),
      panels: getValues('panels') as WindowPanelInput[],
      location: getValues('location'),
      notes: getValues('notes'),
      originOffsetMm,
    })
  const takeView = (): EditorView => ({ selectedPartId, activePanelIndex, activeSectionIndex, selectedPanelIndices })
  // The offset is set from THIS render's value, not accumulated through
  // a functional update: `next` was derived from this render's `panels`,
  // so its shift is relative to this render's offset too. Two drag
  // frames landing before React re-renders both build on the same base
  // and the later one simply wins — accumulating would count the same
  // shift twice and drift the view off over a drag (bug-067).
  //
  // EVERY edit to `panels` goes through here, or it bypasses undo
  // history (docs/editor_undo_redo_planing.md §2) — `label` names the
  // step in the tool pill's tooltip.
  const commitPanels = (next: WindowPanelInput[], label: EditLabel) => {
    const before = takeSnapshot()
    const shift = originShiftMm(next)
    const offset = shift.x !== 0 || shift.y !== 0 ? { x: originOffsetMm.x - shift.x, y: originOffsetMm.y - shift.y } : originOffsetMm
    if (offset !== originOffsetMm) setOriginOffsetMm(offset)
    const normalized = normalizeOrigin(next)
    setValue('panels', normalized, { shouldValidate: true, shouldDirty: true })
    history.record(label, before, { ...before, panels: structuredClone(normalized), originOffsetMm: offset }, takeView())
  }
  // For keyboard effects: `commitPanels` closes over this render's
  // selection/offset and so changes every render — an Effect Event
  // always sees the latest one without re-subscribing the listener.
  const commitPanelsFromEffect = useEffectEvent(commitPanels)

  // The other four doors — same rule as `commitPanels`: every edit to
  // these fields goes through here, or it bypasses undo history.
  const commitField = <K extends 'name' | 'quantity' | 'location' | 'notes'>(field: K, value: CreateWindowInput[K]) => {
    const before = takeSnapshot()
    setValue(field, value as never, { shouldValidate: true, shouldDirty: true })
    history.record(FIELD_LABELS[field], before, { ...before, [field]: structuredClone(value) }, takeView())
  }

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
            // Sections are re-aligned one per light on load, which also
            // re-keys a `migrated:` light left by the FreeDividers
            // migration (docs/free_dividers_planing.md §2 step 4).
            panels: editingWindow.panels.map((p) =>
              withAlignedSections(
                null,
                {
                  ...p,
                  frameProfile: p.frameProfile as ScopedRef,
                  dividerProfile: p.dividerProfile as ScopedRef | null,
                  interiorColor: p.interiorColor as ScopedRef | null,
                  exteriorColor: p.exteriorColor as ScopedRef | null,
                  dividers: p.dividers.map((d) => ({ ...d, profile: d.profile as ScopedRef | null })),
                  sections: p.sections.map((s) => ({
                    ...s,
                    sashProfile: s.sashProfile as ScopedRef | null,
                    glass: s.glass as ScopedRef,
                  })),
                },
                { metrics: resolveProfileMetrics(p.frameProfile as ScopedRef), doorSill: false },
              ),
            ),
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
  // A brand-new panel's `widthMm`/`heightMm` are NaN until the user
  // picks a real size — substituted with a drawable placeholder here so
  // `buildWindowLayout`'s arithmetic never sees a NaN (such a panel has
  // no dividers yet).
  const sectionRendersFor = (i: number): SectionRender[] =>
    resolved[i].render.sections.map((sr, j) => ({
      ...sr,
      openingType: sanitizedPanels[i].sections[j].openingType,
      hasFlyScreen: sanitizedPanels[i].sections[j].hasFlyScreen,
    }))

  const layoutInput: AssemblyPanelInput[] = sanitizedPanels.map((panel, i) => {
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
      dividers: panel.dividers,
      sections: sectionRendersFor(i).map((sr) => ({
        faceKey: sr.faceKey,
        kind: sr.kind,
        hasSash: sr.hasSash,
        openingType: sr.openingType,
        hasFlyScreen: sr.hasFlyScreen,
        sliding: sr.sliding,
      })),
    }
  })
  const drawingLayout = buildAssemblyLayout(layoutInput)

  const activePanel = sanitizedPanels[activePanelIndex] ?? sanitizedPanels[0]
  const activeInfo = panelInfos[activePanelIndex] ?? panelInfos[0]
  const activeRaw = panels[activePanelIndex] ?? panels[0]
  const activeSection = activePanel.sections[activeSectionIndex] ?? activePanel.sections[0]
  const activeSectionInfo = activeInfo.sections[activeSectionIndex] ?? activeInfo.sections[0]
  const activeIsGridded = activePanel.dividers.length > 0

  // ---- Lights ---------------------------------------------------------
  //
  // What the light maths needs for panel `i` (panel-lights.ts): its
  // metrics and whether it is a hinged door (its opening runs to the
  // real bottom edge).
  const lightCtx = (i: number): PanelLightsContext => ({
    metrics: resolved[i]?.render.metrics ?? resolveProfileMetrics(panels[i]?.frameProfile),
    doorSill: !!panels[i]?.isDoor && panelInfos[i]?.systemType === SystemType.HINGED,
  })
  const sized = (p: WindowPanelInput) => Number.isFinite(p.widthMm) && Number.isFinite(p.heightMm)
  // The active panel's lights — `sections[i]` is light `i` (kept aligned
  // on every edit), so the active section's own light is at the same index.
  const activeLights = activeRaw && sized(activeRaw) ? panelLights(activeRaw, lightCtx(activePanelIndex)).graph.lights : []
  const activeLight = activeLights[activeSectionIndex] ?? null
  const activeLightPitch = activeLight && activeRaw ? lightPitch(activeLight, activeRaw, lightCtx(activePanelIndex)) : null
  // A divider move is valid while every light can still be glazed and
  // every rectangular light keeps the glazing minimum (V2).
  const lightsValid = (panel: WindowPanelInput, i: number) => {
    const ctx = lightCtx(i)
    return panelLights(panel, ctx).graph.lights.every((l) => {
      if (!l.clear) return false
      const pitch = lightPitch(l, panel, ctx)
      return !pitch || (pitch.x1 - pitch.x0 >= MIN_GLAZED_PITCH_MM && pitch.y1 - pitch.y0 >= MIN_GLAZED_PITCH_MM)
    })
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
    commitPanels(next, 'addPanel')
    const newIndex = next.length - 1
    setActivePanelIndex(newIndex)
    setActiveSectionIndex(0)
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
    // NEW coupled panel always starts as one light at the given size,
    // even when the source is divided — "+ → Window" adds a normal
    // frame, never a copy of a whole multi-light layout.
    const sourceSection = source.sections[0]
    const next = insertPanel(panels, addRequest.side, attachPanels, {
      frameProfile: source.frameProfile,
      dividerProfile: null,
      dividers: [],
      sections: [{ ...sourceSection, faceKey: SINGLE_LIGHT_KEY }],
      isDoor: source.isDoor,
      interiorColor: source.interiorColor,
      exteriorColor: source.exteriorColor,
      headShape: HeadShape.FLAT,
      headRiseMm: null,
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

  // "+" → Mullion/Transom (docs/free_dividers_planing.md §8, Q20): the
  // SAME panel grows on the clicked side by the typed size and one
  // divider runs frame to frame across the new strip, which is one fixed
  // light across (whatever stood on that frame side now stands on the
  // new divider). The placement grows through `resizePanelEdge`, so
  // coupled neighbours are pushed the way an edge drag pushes them.
  const onConfirmDivider = (sizeMm: number, dividerProfile: ScopedRef) => {
    if (!addRequest || attachPanels.length !== 1) return
    const panel = attachPanels[0]
    const index = panels.indexOf(panel)
    if (index < 0) return
    const size = Math.round(sizeMm)
    const grown = addEdgeDivider(panel, addRequest.side, size, lightCtx(index))
    if (!grown) return
    const side = addRequest.side
    const edge =
      side === 'top' ? panel.yMm - size : side === 'bottom' ? panel.yMm + panel.heightMm + size : side === 'left' ? panel.xMm - size : panel.xMm + panel.widthMm + size
    const placed = resizePanelEdge(panels, index, side, edge)
    const next = placed.map((p, i) =>
      i === index
        ? {
            ...grown,
            xMm: p.xMm,
            yMm: p.yMm,
            widthMm: p.widthMm,
            heightMm: p.heightMm,
            // The popup's profile is the panel default when there isn't
            // one yet (Q12); an existing default is left alone.
            dividerProfile: grown.dividerProfile ?? dividerProfile,
          }
        : p,
    )
    commitPanels(next, 'addDivider')
    setSelectedPartId(`p${index}:frame`)
    setActiveSectionIndex(0)
    setHoveredPanelIndex(null)
    onCancelAddPanel()
  }

  // ---- Panel / section mutation ------------------------------------------

  const updateActivePanel = (changes: Partial<WindowPanelInput>, label: EditLabel) => {
    commitPanels(
      panels.map((panel, i) => (i === activePanelIndex ? { ...panel, ...changes } : panel)),
      label,
    )
  }

  const updateActiveSection = (changes: Partial<WindowSectionInput>, label: EditLabel) => {
    commitPanels(
      panels.map((panel, i) =>
        i === activePanelIndex
          ? { ...panel, sections: panel.sections.map((s, j) => (j === activeSectionIndex ? { ...s, ...changes } : s)) }
          : panel,
      ),
      label,
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

  // Panel-level dimension inputs (Q13): the placement grows left- and
  // bottom-anchored (`resizePanel`), and since every divider anchor is mm
  // from the left/bottom edge, the lights on the right/top absorb it.
  const onPanelSizeChange = (widthMm: number, heightMm: number) => {
    const panel = panels[activePanelIndex]
    if (!panel) return
    const resized = resizePanel(panels, activePanelIndex, widthMm, heightMm)
    commitPanels(
      resized.map((p, i) => (i === activePanelIndex ? withAlignedSections(sized(panel) ? panel : null, p, lightCtx(i)) : p)),
      'resizePanel',
    )
  }

  // The active light's own width/height inputs (Q14): the panel grows by
  // the difference at that light's own right/top edge; every other light
  // keeps its size.
  const onLightSizeChange = (axis: 'x' | 'y', mm: number) => {
    const panel = panels[activePanelIndex]
    if (!panel || !activeLight) return
    const grown = resizeLight(panel, activeLight, axis, mm, lightCtx(activePanelIndex))
    if (!grown) return
    const placed = resizePanel(panels, activePanelIndex, grown.widthMm, grown.heightMm)
    commitPanels(
      placed.map((p, i) => (i === activePanelIndex ? { ...grown, xMm: p.xMm, yMm: p.yMm } : p)),
      'resizeSection',
    )
  }

  const canDeletePanel = panels.length > 1 && removePanel(panels, activePanelIndex) !== null
  const onDeletePanel = () => {
    const next = removePanel(panels, activePanelIndex)
    if (!next) return
    commitPanels(next, 'deletePanel')
    const fallback = Math.max(0, activePanelIndex - 1)
    setActivePanelIndex(fallback)
    setActiveSectionIndex(0)
    setSelectedPanelIndices([fallback])
    setSelectedPartId(null)
  }

  // ---- Deleting dividers (Q11 + Q18) ------------------------------------
  //
  // A divider never goes alone: one side's light(s) go with it and the
  // other side takes the space, keeping its own settings. With a light of
  // its own selected the side is already chosen — no dialog, unless other
  // dividers stand on it (Delete all / Extend the rest).
  const [deleteRequest, setDeleteRequest] = useState<DeleteDividerRequest | null>(null)
  // Going flat removes the arch's own dividers — listed first (§8).
  const [headConfirm, setHeadConfirm] = useState<{ names: string[]; apply: () => void } | null>(null)
  const dividerLabel = (panelIndex: number, dividerId: string): string => {
    const name = dividerNames(drawingLayout.parts.filter((p) => p.panelIndex === panelIndex)).get(`p${panelIndex}:div-${dividerId}`)
    if (!name) return t('windowDialog.design.parts.divider')
    return `${t(name.kind === 'mullion' ? 'windowDialog.design.parts.mullion' : 'windowDialog.design.parts.transom')} ${name.number}`
  }
  const applyDividerDelete = (panelIndex: number, ids: string[], keep: string[], mode: 'delete' | 'extend') => {
    const panel = panels[panelIndex]
    if (!panel) return
    const next = deleteDividers(panel, ids, lightCtx(panelIndex), mode, new Set(keep))
    if (!lightsValid(next, panelIndex)) {
      toast.error(t('windowDialog.design.deleteDivider.refused'))
      return
    }
    commitPanels(
      panels.map((p, i) => (i === panelIndex ? next : p)),
      'removeDivider',
    )
    setSelectedPartId(`p${panelIndex}:frame`)
    setExtraPartIds([])
    setActiveSectionIndex(0)
  }
  const requestDividerDelete = (panelIndex: number, dividerIds: string[], lightIndices: number[]) => {
    const panel = panels[panelIndex]
    if (!panel || !sized(panel) || dividerIds.length === 0) return
    const ctx = lightCtx(panelIndex)
    const { graph } = panelLights(panel, ctx)
    const selectedKeys = lightIndices.map((i) => graph.lights[i]?.key).filter((k): k is string => !!k)
    const dependents = planDelete(panel.dividers, dividerIds).dependents
    // Each divider loses the side holding a selected light; undecided
    // when a divider has none (or both) of its sides selected.
    let keep: string[] | null = null
    if (selectedKeys.length > 0) {
      keep = []
      for (const id of dividerIds) {
        const sides = dividerSides(panel, id, ctx)
        const goesLeft = sides.left.some((k) => selectedKeys.includes(k))
        const goesRight = sides.right.some((k) => selectedKeys.includes(k))
        if (goesLeft === goesRight) {
          keep = null
          break
        }
        keep.push(...(goesLeft ? sides.right : sides.left))
      }
    }
    if (keep && dependents.length === 0) {
      applyDividerDelete(panelIndex, dividerIds, keep, 'extend')
      return
    }
    setDeleteRequest({
      panelIndex,
      ids: dividerIds,
      names: dividerIds.map((id) => dividerLabel(panelIndex, id)),
      sides: !keep && dividerIds.length === 1 ? dividerSides(panel, dividerIds[0], ctx) : null,
      keep: keep ?? [],
      dependents: dependents.map((id) => dividerLabel(panelIndex, id)),
      lights: graph.lights.map((l) => ({ key: l.key, polygon: l.polygon })),
      size: { width: panel.widthMm, height: panel.heightMm },
    })
  }

  // Moves a straight mullion/transom of `panelIndex` to `positionMm` —
  // from the left for a mullion, up from the bottom for a transom — held
  // back where a light would get too small to glaze.
  const moveDividerTo = (source: WindowPanelInput[], panelIndex: number, dividerId: string, positionMm: number): WindowPanelInput[] | null => {
    const panel = source[panelIndex]
    if (!panel || !sized(panel)) return null
    const ctx = lightCtx(panelIndex)
    const dividers = moveStraight(panelGeometry(panel, ctx), panel.dividers, dividerId, Math.round(positionMm), (next) =>
      lightsValid({ ...panel, dividers: next }, panelIndex),
    )
    if (dividers === panel.dividers) return null
    return source.map((p, i) => (i === panelIndex ? withAlignedSections(panel, { ...panel, dividers }, ctx) : p))
  }

  // Dragging a mullion/transom on the drawing (Mario, 2026-09-15: "move
  // the transom/mullion in the panel by dragging it"). `boundaryMm` is
  // panel-local along the divider's own axis — x from the left for a
  // mullion, y from the TOP for a transom, which becomes mm up from the
  // bottom here (the divider's own anchors, Q13).
  const onDividerDrag = (dividerPartId: string, boundaryMm: number) => {
    const part = drawingLayout.parts.find((p) => p.id === dividerPartId)
    const panel = part ? panels[part.panelIndex] : undefined
    if (!part?.dividerId || !panel || (part.dividerAxis !== 'v' && part.dividerAxis !== 'h')) return
    const positionMm = part.dividerAxis === 'v' ? boundaryMm : panel.heightMm - boundaryMm
    const next = moveDividerTo(panels, part.panelIndex, part.dividerId, positionMm)
    if (next) commitPanels(next, 'moveDivider')
  }

  // The Divider tool's second click (docs/free_dividers_planing.md §6.4):
  // the drawing has already added the divider, split at its crossings
  // (Q3) and sorted; the lights re-align here and the new divider is
  // selected. An unsized panel has no mm to anchor to, so nothing lands.
  const onDrawDivider = (panelIndex: number, dividers: WindowDividerInput[], added: string[]) => {
    const panel = panels[panelIndex]
    if (!panel || !sized(panel)) return
    commitPanels(
      panels.map((p, i) => (i === panelIndex ? withAlignedSections(panel, { ...panel, dividers }, lightCtx(i)) : p)),
      'drawDivider',
    )
    if (added[0]) onSelectPart(`p${panelIndex}:div-${added[0]}`, false)
  }

  // Bending an arch divider (§6.5) — by its midpoint handle or a typed
  // radius. Held back where a light would stop being glazable.
  const bendTo = (panelIndex: number, dividerId: string, sagMm: number, label: 'bendDivider' | 'changeDividerRadius' = 'bendDivider') => {
    const panel = panels[panelIndex]
    if (!panel || !sized(panel)) return
    const dividers = bendDivider(panel.dividers, dividerId, sagMm)
    if (dividers.every((d, k) => d.sagMm === panel.dividers[k].sagMm) || !lightsValid({ ...panel, dividers }, panelIndex)) return
    commitPanels(
      panels.map((p, i) => (i === panelIndex ? withAlignedSections(panel, { ...panel, dividers }, lightCtx(i)) : p)),
      label,
    )
  }
  // ⇄ on a cross (Q3): the cut piece runs through, the through member is
  // cut there instead.
  const onSwapCrossing = (panelIndex: number, crossing: Crossing) => {
    const panel = panels[panelIndex]
    if (!panel || !sized(panel)) return
    const ctx = lightCtx(panelIndex)
    const dividers = swapCrossing(panelGeometry(panel, ctx), panel.dividers, crossing.throughId, crossing.pieceAId, crossing.pieceBId)
    if (!dividers) return
    commitPanels(
      panels.map((p, i) => (i === panelIndex ? withAlignedSections(panel, { ...panel, dividers }, ctx) : p)),
      'swapCrossing',
    )
  }

  // Dragging an arch divider's end along the member it stands on (§7).
  // `point` is panel-local; it slides to the nearest point of that member.
  // Held back where the divider would leave the arch zone with a slant
  // or a light would stop being glazable.
  const onMoveDividerEnd = (dividerPartId: string, end: 'from' | 'to', point: PointMm) => {
    const part = drawingLayout.parts.find((p) => p.id === dividerPartId)
    const panel = part ? panels[part.panelIndex] : undefined
    if (!part?.dividerId || !panel || !sized(panel)) return
    const ctx = lightCtx(part.panelIndex)
    const geo = panelGeometry(panel, ctx)
    const divider = panel.dividers.find((d) => d.id === part.dividerId)
    const host = divider && allMembers(geo, resolveDividers(geo, panel.dividers)).get(divider[end].on)
    if (!divider || !host) return
    const anchor = anchorOn(geo, host, pathProject(host.path, point).point)
    const rounded = host.axis ? { ...anchor, at: Math.round(anchor.at) } : anchor
    const dividers = moveEnd(panel.dividers, divider.id, end, rounded)
    if (dividerProblems(geo, dividers).some((x) => x.id === divider.id) || !lightsValid({ ...panel, dividers }, part.panelIndex)) return
    commitPanels(
      panels.map((p, i) => (i === part.panelIndex ? withAlignedSections(panel, { ...panel, dividers }, ctx) : p)),
      'moveDividerEnd',
    )
  }

  const onBendDivider = (dividerPartId: string, sagMm: number) => {
    const part = drawingLayout.parts.find((p) => p.id === dividerPartId)
    if (part?.dividerId) bendTo(part.panelIndex, part.dividerId, sagMm)
  }

  // Dragging a panel's own FREE outer edge in/out (Mario: "resize the
  // window by dragging any side in or out"). `positionMm` is already
  // resolved by the drawing — snapped onto another coupled panel's edge
  // when one was within tolerance. Dividers keep their place in the
  // window: the lights on the dragged side absorb the change (Q13).
  const onPanelEdgeDrag = (panelIndex: number, side: PanelSide, positionMm: number) => {
    const panel = panels[panelIndex]
    if (!panel) return
    const resized = resizePanelEdge(panels, panelIndex, side, positionMm)
    commitPanels(
      resized.map((p, i) => (i === panelIndex ? stretchForEdge(panel, p, side, lightCtx(i)) : p)),
      'resizePanel',
    )
  }

  const onSelectPart = (partId: string, additive: boolean) => {
    const parsed = parsePartId(partId)
    const panelIndex = parsed?.panelIndex ?? 0
    const kind = drawingLayout.parts.find((p) => p.id === partId)?.kind
    if (additive && kind && kind !== 'frame') {
      // A divider or a light joins the part selection — same panel only;
      // another panel's part starts over from it.
      if (!selectedPartId || parsePartId(selectedPartId)?.panelIndex !== panelIndex) {
        setExtraPartIds([])
        setSelectedPartId(partId)
        setActivePanelIndex(panelIndex)
        setSelectedPanelIndices([panelIndex])
        return
      }
      if (partId === selectedPartId) return
      setExtraPartIds((prev) => (prev.includes(partId) ? prev.filter((id) => id !== partId) : [...prev, partId]))
      return
    }
    setExtraPartIds([])
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
    // A sash/glass/fly-screen part carries its own section — a divider
    // or the frame carries none (`sectionIndex: null`), so the active
    // section stays whatever it already was, or the first one when this
    // click moved to another panel.
    if (parsed?.sectionIndex !== null && parsed?.sectionIndex !== undefined) {
      setActiveSectionIndex(parsed.sectionIndex)
    } else if (panelIndex !== activePanelIndex) {
      setActiveSectionIndex(0)
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
    updateActivePanel({ frameProfile: ref, sections }, 'changeFrame')
  }

  const onDividerProfileChange = (ref: ScopedRef) => updateActivePanel({ dividerProfile: ref }, 'changeDividerProfile')

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
      updateActiveSection({ kind, sashProfile: null, beadProfile: '' as ScopedRef, openingType: null, hasFlyScreen: false, sliding: null }, 'changeSectionType')
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
    }, 'changeSectionType')
  }

  // The sliding layout editor's one write path (planing §7): every
  // control in `sliding-layout-editor.tsx` — and any future context
  // menu or keyboard shortcut — lands here, already re-derived, so an
  // `auto` sash can never be stored disagreeing with its rails.
  // A layout landing on a FIXED sliding section (its tiles double as
  // the fixed/opening choice, 2026-09-20) flips that section to
  // opening in the same write — the `onSectionKindChange(OPENING)`
  // reset, minus the layout it would restore, since this IS the layout.
  const setSlidingLayoutOf = (panelIndex: number, sectionIndex: number, layout: SlidingLayoutInput, label: EditLabel) => {
    const next = resolveSlidingLayout(layout)
    rememberedSlidingLayouts.current.set(rememberKey(panelIndex, sectionIndex), next)
    const write = (section: WindowSectionInput): WindowSectionInput =>
      section.kind === SectionKind.FIXED
        ? { ...section, kind: SectionKind.OPENING, sashProfile: '' as ScopedRef, beadProfile: null, openingType: null, sliding: next }
        : { ...section, sliding: next }
    commitPanels(
      panels.map((panel, i) =>
        i === panelIndex ? { ...panel, sections: panel.sections.map((s, j) => (j === sectionIndex ? write(s) : s)) } : panel,
      ),
      label,
    )
  }
  const setSlidingLayout = (layout: SlidingLayoutInput) => setSlidingLayoutOf(activePanelIndex, activeSectionIndex, layout, 'editSlidingLayout')
  // One sash of one section — the quick menu's and the keyboard's entry
  // point (planing §7/§10), so both land on exactly the same write as
  // the part panel's rows.
  const updateSlidingSash = (
    panelIndex: number,
    sectionIndex: number,
    sashIndex: number,
    changes: Partial<SlidingLayoutInput['sashes'][number]>,
    label: EditLabel,
  ) => {
    const layout = panels[panelIndex]?.sections[sectionIndex]?.sliding
    if (!layout) return
    setSlidingLayoutOf(
      panelIndex,
      sectionIndex,
      { ...layout, sashes: layout.sashes.map((sash, i) => (i === sashIndex ? { ...sash, ...changes } : sash)) },
      label,
    )
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
      }, 'changeOpening')
      return
    }
    updateActiveSection({
      kind: SectionKind.OPENING,
      sashProfile: activeSection.kind === SectionKind.OPENING ? activeSection.sashProfile : ('' as ScopedRef),
      beadProfile: null,
      openingType: value,
    }, 'changeOpening')
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
      const lights = panelIssueLights(panel, resolved[i].render)

      // Panel-level rules (dividers, lights) plus each section's
      // sliding-layout rules — computed once per panel, not once per
      // section (docs/sections_tasks.md Step 7 / §6's own note on why
      // these can't live inside the loop below).
      for (const issue of collectPanelIssues({
        dividerProfile: panel.dividerProfile,
        dividerCount: panel.dividers.length,
        dividerProblemPartIds: lights.dividerProblems.map((id) => `p${i}:div-${id}`),
        dividerBends: lights.bends.map((b) => ({ partId: `p${i}:div-${b.id}`, radiusMm: b.radiusMm })),
        minBendRadiusMm: resolved[i].render.metrics.minBendRadius,
        metricsSource: resolved[i].render.metrics.source,
        lightsMismatch: lights.mismatch,
        lightsChanged: !!loadedMigrated[i],
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
          light: lights.byKey.get(section.faceKey) ?? null,
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
    for (const { panelIndex, localId } of findMisalignedDividers(sanitizedPanels, drawingLayout.parts)) {
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
      // Every divider's saw cuts go along too — the cutting-order
      // report's cache, refreshed on every save (Q10/Q19).
      const body: CreateWindowInput = { ...data, panels: sanitizedPanels.map((p, i) => withCuts(p, lightCtx(i))) }
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

  // ---- Undo / redo (docs/editor_undo_redo_planing.md §4) ---------------

  // Set by `applyStep` — the restored `selectedPartId` can only be checked
  // against the drawn parts once the restored panels have rendered.
  const verifySelectionAfterRestore = useRef(false)

  // `setValue`, never `reset()`: reset would move the dirty baseline.
  // react-hook-form deep-compares the whole form with `defaultValues` on
  // every `shouldDirty` write, so undoing back to the loaded window makes
  // the form clean again and the leave dialog stops asking.
  const applyStep = (snapshot: EditorSnapshot, view: EditorView) => {
    const options = { shouldValidate: true, shouldDirty: true }
    setValue('name', snapshot.name, options)
    setValue('quantity', snapshot.quantity, options)
    setValue('panels', snapshot.panels, options)
    setValue('location', snapshot.location, options)
    setValue('notes', snapshot.notes, options)
    setOriginOffsetMm(snapshot.originOffsetMm)

    // The view is from when the step was made — clamp it to what the
    // restored panels actually have.
    const panelCount = snapshot.panels.length
    const panelIndex = Math.min(Math.max(view.activePanelIndex, 0), panelCount - 1)
    const sectionCount = snapshot.panels[panelIndex]?.sections.length ?? 1
    const selectedPanels = view.selectedPanelIndices.filter((i) => i < panelCount)
    const parsed = view.selectedPartId ? parsePartId(view.selectedPartId) : null
    const partFits =
      parsed !== null &&
      parsed.panelIndex < panelCount &&
      (parsed.sectionIndex === null || parsed.sectionIndex < (snapshot.panels[parsed.panelIndex]?.sections.length ?? 0))
    setActivePanelIndex(panelIndex)
    setActiveSectionIndex(view.activeSectionIndex < sectionCount ? view.activeSectionIndex : 0)
    setSelectedPanelIndices(selectedPanels.length > 0 ? selectedPanels : [panelIndex])
    setSelectedPartId(view.selectedPartId === null ? null : partFits ? view.selectedPartId : `p${panelIndex}:frame`)
    verifySelectionAfterRestore.current = view.selectedPartId !== null

    // Transient modes are closed, not restored (§4.5).
    setMenuSashPartId(null)
  }

  // A part id can parse fine and still not be drawn any more (a divider
  // `k` or sash index past what the restored grid/layout has) — fall back
  // to the active panel's frame.
  useEffect(() => {
    if (!verifySelectionAfterRestore.current) return
    verifySelectionAfterRestore.current = false
    if (selectedPartId && !drawingLayout.parts.some((part) => part.id === selectedPartId)) {
      setSelectedPartId(`p${activePanelIndex}:frame`)
    }
  }, [selectedPartId, activePanelIndex, drawingLayout])

  // ---- Gestures (§3): one drag / one field / one nudge burst = one step --

  // Canvas: anything pressed on the drawing (a divider, an edge, a bar
  // point or bow) is one step until the button comes back up. Closed a
  // tick after the release so every handler of that release — and the
  // click it can fire — still lands inside it.
  const onCanvasPointerDown = () => {
    history.beginGesture('canvas')
    const onRelease = () => {
      window.removeEventListener('pointerup', onRelease)
      window.removeEventListener('mouseup', onRelease)
      window.removeEventListener('pointercancel', onRelease)
      window.setTimeout(() => history.endGesture('canvas'), 0)
    }
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('mouseup', onRelease)
    window.addEventListener('pointercancel', onRelease)
  }

  // Fields: typing in one text/number field is one step from focus to
  // blur. A combobox's search box (`aria-controls`, the profile picker)
  // is skipped: Enter there PICKS something, and each pick is its own
  // step. `isActive` closes the gesture when the field unmounts while
  // focused, which fires no blur.
  const fieldGestureCount = useRef(0)
  const isTypingField = (target: EventTarget): target is HTMLInputElement | HTMLTextAreaElement =>
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number') && !target.hasAttribute('aria-controls'))
  const onFieldFocus = (event: React.FocusEvent) => {
    const field = event.target
    if (!isTypingField(field)) return
    fieldGestureCount.current += 1
    history.beginGesture(`field:${fieldGestureCount.current}`, () => document.activeElement === field)
  }
  const onFieldBlur = (event: React.FocusEvent) => {
    if (isTypingField(event.target)) history.endGesture(`field:${fieldGestureCount.current}`)
  }

  // Divider arrow-key nudges: a burst on the same divider is one step,
  // closed after 1 s without another nudge.
  const nudgeTimer = useRef<number | undefined>(undefined)
  const nudgeGesture = useEffectEvent((partId: string) => {
    const key = `nudge:${partId}`
    history.beginGesture(key)
    window.clearTimeout(nudgeTimer.current)
    nudgeTimer.current = window.setTimeout(() => history.endGesture(key), 1000)
  })

  // Off while anything modal is open (§5): undoing under an open add
  // card would leave it anchored to a panel that may no longer exist.
  // The add-divider card is the same `addRequest` flow.
  const historyBlocked = addRequest !== null || confirmLeave !== null || menuSashPartId !== null || deleteRequest !== null || headConfirm !== null
  const canUndo = history.canUndo && !historyBlocked
  const canRedo = history.canRedo && !historyBlocked

  const onUndo = () => {
    if (!canUndo) return
    const step = history.undo()
    if (step) applyStep(step.before, step.view)
  }
  const onRedo = () => {
    if (!canRedo) return
    const step = history.redo()
    if (step) applyStep(step.after, step.view)
  }

  // "Undo Move divider (⌘Z)" — plain "Undo (⌘Z)" when there's nothing.
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
  const undoLabel = `${
    history.undoLabelKey
      ? t('windowDialog.design.tools.undoAction', { action: t(`windowDialog.design.history.${history.undoLabelKey}`) })
      : t('windowDialog.design.tools.undo')
  } (${isMac ? '⌘Z' : 'Ctrl+Z'})`
  const redoLabel = `${
    history.redoLabelKey
      ? t('windowDialog.design.tools.redoAction', { action: t(`windowDialog.design.history.${history.redoLabelKey}`) })
      : t('windowDialog.design.tools.redo')
  } (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`

  // ⌘/Ctrl+Z undo, ⌘/Ctrl+Shift+Z or Ctrl+Y redo (decision 4). Matched
  // on `event.code`, the physical key: on an Arabic layout `event.key`
  // is "ئ"/"غ" and would never match. Inside a field the browser keeps
  // its own text undo. `preventDefault` only when it actually acts.
  const onHistoryShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    const isRedo = event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey)
    const isUndo = event.code === 'KeyZ' && !event.shiftKey
    if (isUndo && canUndo) {
      event.preventDefault()
      onUndo()
    } else if (isRedo && canRedo) {
      event.preventDefault()
      onRedo()
    }
  })
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => onHistoryShortcut(event)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ---- Selected divider ---------------------------------------------------
  //
  // Read from `selectedPartId` rather than threaded through as separate
  // state, since the drawing's own selection is already the single
  // source of truth for "what's selected".
  const selectedDividerPart = drawingLayout.parts.find((p) => p.id === selectedPartId && p.kind === 'divider') ?? null
  // The whole part selection, primary first — extras from another panel
  // or gone after an edit are dropped.
  const selectionPanel = selectedPartId ? (parsePartId(selectedPartId)?.panelIndex ?? null) : null
  const selectedPartIds = selectedPartId
    ? [
        selectedPartId,
        ...extraPartIds.filter(
          (id) => id !== selectedPartId && parsePartId(id)?.panelIndex === selectionPanel && drawingLayout.parts.some((p) => p.id === id),
        ),
      ]
    : []
  const selectedParts = selectedPartIds.flatMap((id) => drawingLayout.parts.filter((p) => p.id === id))
  const selectionDividerIds = selectedParts.flatMap((p) => (p.kind === 'divider' && p.dividerId ? [p.dividerId] : []))
  const selectionLightIndices = [...new Set(selectedParts.flatMap((p) => (p.kind !== 'divider' && p.sectionIndex !== null ? [p.sectionIndex] : [])))]
  // Delete/Backspace with any divider in the selection (§7).
  const onDeleteKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (selectionPanel === null || selectionDividerIds.length === 0) return
    event.preventDefault()
    requestDividerDelete(selectionPanel, selectionDividerIds, selectionLightIndices)
  })
  const selectionHasDivider = selectionDividerIds.length > 0
  useEffect(() => {
    if (!selectionHasDivider) return
    const handleKeyDown = (event: KeyboardEvent) => onDeleteKey(event)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectionHasDivider])
  const selectedDividerName = selectedDividerPart
    ? dividerNames(drawingLayout.parts.filter((p) => p.panelIndex === selectedDividerPart.panelIndex)).get(selectedDividerPart.id)
    : undefined
  // An arch-zone divider bends (§6.5): its radius over its own chord,
  // empty while straight.
  const selectedDividerBend = (() => {
    const part = selectedDividerPart
    const panel = part ? panels[part.panelIndex] : undefined
    if (!part?.dividerId || !panel || !sized(panel)) return null
    const geo = panelGeometry(panel, lightCtx(part.panelIndex))
    const resolved = resolveDividers(geo, panel.dividers).get(part.dividerId)
    if (!resolved || zoneOf(geo, resolved) !== 'arch') return null
    const chord = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y)
    const sag = resolved.divider.sagMm
    const radius = radiusFromSag(chord, sag)
    return {
      radiusMm: radius === null ? null : Math.round(radius),
      minMm: Math.ceil(chord / 2),
      onChange: (mm: number | null) =>
        bendTo(part.panelIndex, part.dividerId as string, mm === null || mm <= 0 ? 0 : sagFromRadius(chord, mm, Math.sign(sag) || defaultBowSign(resolved.from, resolved.to)), 'changeDividerRadius'),
    }
  })()
  // Its own profile override (Q12), typed position (Q15) and what each
  // end stands on with its saw cut (Q10/Q19).
  const selectedDividerDetail = (() => {
    const part = selectedDividerPart
    const panel = part ? panels[part.panelIndex] : undefined
    const divider = part?.dividerId ? panel?.dividers.find((d) => d.id === part.dividerId) : undefined
    if (!part || !panel || !divider) return null
    const panelIndex = part.panelIndex
    const ref = divider.profile ?? panel.dividerProfile
    const profileNumber = ref ? profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === ref)?.profileNo : undefined
    const profile = {
      override: divider.profile,
      panelDefault: panel.dividerProfile,
      onChange: (next: ScopedRef | null) => {
        // With no panel default yet, the first pick becomes it.
        const nextPanel = !panel.dividerProfile && next
          ? { ...panel, dividerProfile: next }
          : { ...panel, dividers: panel.dividers.map((d) => (d.id === divider.id ? { ...d, profile: next === panel.dividerProfile ? null : next } : d)) }
        commitPanels(
          panels.map((p, i) => (i === panelIndex ? nextPanel : p)),
          'changeDividerProfile',
        )
      },
    }
    let ends: string[] = []
    let position: { axis: 'v' | 'h'; valueMm: number; onChange: (mm: number) => void } | null = null
    const rect = drawingLayout.panelRects[panelIndex]
    if (sized(panel) && rect) {
      const band = panelLights(panel, lightCtx(panelIndex)).graph.bands.find((b) => b.dividerId === divider.id)
      ends = (['from', 'to'] as const).map((end, k) => {
        const host = divider[end].on
        const hostName = isFrameMember(host) ? t(`windowDialog.design.dividerTool.members.${host}`) : dividerLabel(panelIndex, host)
        const cut = band?.ends[k]
        const left = Math.round(cut?.leftDeg ?? 0)
        const right = Math.round(cut?.rightDeg ?? 0)
        return t('windowDialog.design.dividerInspector.end', { host: hostName, cut: left === right ? `${left}°` : `${left}° / ${right}°` })
      })
      const axis = part.dividerAxis
      if ((axis === 'v' || axis === 'h') && !selectedDividerBend) {
        const current = axis === 'v' ? part.rectMm.x + part.rectMm.width / 2 - rect.x : panel.heightMm - (part.rectMm.y + part.rectMm.height / 2 - rect.y)
        position = {
          axis,
          valueMm: Math.round(current),
          onChange: (mm) => {
            const next = moveDividerTo(panels, panelIndex, divider.id, mm)
            if (next) commitPanels(next, 'moveDivider')
          },
        }
      }
    }
    return { profileNumber, profile, ends, position }
  })()
  const selectedDivider =
    selectedDividerPart?.dividerId && selectedDividerName && selectedDividerDetail
      ? {
          bend: selectedDividerBend,
          profile: selectedDividerDetail.profile,
          position: selectedDividerDetail.position,
          ends: selectedDividerDetail.ends,
          label: `${t(selectedDividerName.kind === 'mullion' ? 'windowDialog.design.parts.mullion' : 'windowDialog.design.parts.transom')} ${selectedDividerName.number}`,
          profileNumber: selectedDividerDetail.profileNumber,
          lengthMm: selectedDividerPart.cutLengthMm ?? 0,
          onRemove: () =>
            requestDividerDelete(
              selectedDividerPart.panelIndex,
              [...new Set([selectedDividerPart.dividerId as string, ...selectionDividerIds])],
              selectionLightIndices,
            ),
        }
      : null

  // Keyboard control of the selected divider: arrow keys nudge a
  // straight one 1 mm along its axis (holding repeats via the browser's
  // own key-repeat; same floor as the drag), Delete/Backspace removes it.
  // The drawing is fixed `dir="ltr"`, so Left/Right always means the same
  // physical direction.
  const onDividerKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    const part = selectedDividerPart
    if (!part?.dividerId) return
    const panel = panels[part.panelIndex]
    if (!panel) return

    // A mullion moves right with →, a transom UP with ↑ — its position is
    // measured up from the bottom (Q15).
    const delta =
      part.dividerAxis === 'v'
        ? event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null
        : part.dividerAxis === 'h'
          ? event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : null
          : null
    if (delta === null) return
    const rect = drawingLayout.panelRects[part.panelIndex]
    if (!rect) return
    const current =
      part.dividerAxis === 'v'
        ? part.rectMm.x + part.rectMm.width / 2 - rect.x
        : panel.heightMm - (part.rectMm.y + part.rectMm.height / 2 - rect.y)
    event.preventDefault()
    nudgeGesture(part.id)
    const next = moveDividerTo(panels, part.panelIndex, part.dividerId, current + delta)
    if (next) commitPanelsFromEffect(next, 'moveDivider')
  })
  const selectedDividerPartId = selectedDividerPart?.id ?? null
  useEffect(() => {
    if (!selectedDividerPartId) return
    const handleKeyDown = (event: KeyboardEvent) => onDividerKey(event)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedDividerPartId])

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
        updateSlidingSash(panelIndex, sectionIndex, index, { rail }, 'moveSash')
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
          {/* Blueprint layout (docs/window_editor_redesign_planing.md §2):
              structure tree | drawing | options, full height — no header
              or footer bar. Fixed widths on both sides so neither column
              reflows when a different part is selected, per
              docs/window_design_planing.md's decisions table. */}
          <div className="grid min-h-0 flex-1 grid-cols-[16.25rem_1fr_21.25rem] overflow-hidden">
            {/* `contents`: a focus listener only, no box of its own in the grid. */}
            <div className="contents" onFocusCapture={onFieldFocus} onBlurCapture={onFieldBlur}>
            <WindowStructurePanel
              projectName={project ? displayName(project, i18n.resolvedLanguage ?? 'en') : undefined}
              title={watch('name')?.trim() || pageTitle}
              onBack={() => requestLeave(onDone)}
              quantity={quantity}
              onQuantityChange={(value) => commitField('quantity', value)}
              quantityError={showValidation && errors.quantity ? t('fields.quantityRequired') : undefined}
              panels={panels}
              parts={drawingLayout.parts}
              outerMm={drawingLayout.outerMm}
              issuesByPart={issuesByPart}
              activePanelIndex={activePanelIndex}
              activeSectionIndex={activeSectionIndex}
              selectedPartId={selectedPartId}
              onSelectPart={(partId) => onSelectPart(partId, false)}
            />
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
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
              <div className="min-h-0 flex-1" onPointerDownCapture={onCanvasPointerDown}>
                <WindowDrawing
                  layout={drawingLayout}
                  panels={panelRenders}
                  selectedPartId={selectedPartId}
                  selectedPartIds={selectedPartIds}
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
                  undoRedo={{ canUndo, canRedo, undoLabel, redoLabel, onUndo, onRedo }}
                  onDividerDrag={onDividerDrag}
                  onDrawDivider={onDrawDivider}
                  onBendDivider={onBendDivider}
                  onMoveDividerEnd={onMoveDividerEnd}
                  onSwapCrossing={onSwapCrossing}
                  onPanelEdgeDrag={onPanelEdgeDrag}
                  originOffsetMm={originOffsetMm}
                />
              </div>
              </ContextMenuTrigger>
              {menuSash && (
                <ContextMenuContent>
                  <ContextMenuItem
                    disabled={menuSash.sash.rail === 0}
                    onSelect={() => updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { rail: menuSash.sash.rail - 1 }, 'moveSash')}
                  >
                    {t('fields.sliding.moveBack')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={menuSash.sash.rail >= menuSash.rails - 1}
                    onSelect={() => updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { rail: menuSash.sash.rail + 1 }, 'moveSash')}
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
                          updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { openingType: type, directionSource: SlidingDirectionSource.MANUAL }, 'changeSlidingDirection')
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
                      onSelect={() => updateSlidingSash(menuSash.panelIndex, menuSash.sectionIndex, menuSash.index, { directionSource: SlidingDirectionSource.AUTO }, 'changeSlidingDirection')}
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
              {/* Fixed-height and always present, so messages coming and
                  going never resize the drawing (see the component). The
                  "illustration only" caption rides along as an info row —
                  still gated on the resolver's own `source`, not a flag,
                  so it disappears by itself once profiles carry real
                  band widths (planing decision 10). */}
              <WindowIssuesPanel
                rows={[
                  ...stripIssues.map((issue) => ({
                    // The assembly-level note points at no part.
                    partId: issue.partId === ASSEMBLY_PART_ID ? null : issue.partId,
                    severity: issue.severity,
                    message: issue.message,
                  })),
                  ...(resolved.some((r) => r.render.metrics.source === 'PLACEHOLDER')
                    ? [{ partId: null, severity: 'info' as const, message: t('windowDialog.design.illustrationOnly') }]
                    : []),
                ]}
                onSelectPart={(partId) => onSelectPart(partId, false)}
              />
            </div>

            <aside
              aria-label={t('windowDialog.design.inspector')}
              className="flex min-h-0 min-w-0 flex-col border-s border-border bg-card"
              onFocusCapture={onFieldFocus}
              onBlurCapture={onFieldBlur}
            >
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-4">
              {/* Frame profile — search + favourite + Browse
                  (docs/window_editor_redesign_planing.md §4), replacing
                  the old always-open left-column tree. */}
              <div className="mb-4 flex flex-col gap-1.5">
                <FieldLabel htmlFor="window-frame" required>
                  {t('fields.frameProfile')}
                </FieldLabel>
                <ProfileSearchPicker
                  id="window-frame"
                  profileType={ProfileType.FRAME}
                  value={activePanel.frameProfile || null}
                  onChange={onFrameChange}
                  favoriteRef={project?.favoriteFrameProfile}
                  onSetFavorite={project ? onSetFavorite : undefined}
                  preferredCatalogRef={isEdit ? undefined : project?.defaultSystemCatalog}
                  preferredBrandRef={isEdit ? undefined : project?.defaultSystemBrand}
                />
                {showValidation && errors.panels && (
                  <p className="text-xs text-destructive">{t('fields.frameProfileRequired')}</p>
                )}
              </div>
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
                  onNameChange={(value) => commitField('name', value)}
                  nameError={showValidation && errors.name ? t('fields.windowNameRequired') : undefined}
                  widthMm={activeRaw?.widthMm ?? NaN}
                  heightMm={activeRaw?.heightMm ?? NaN}
                  onWidthChange={(mm) => onPanelSizeChange(mm, activeRaw?.heightMm ?? mm)}
                  onHeightChange={(mm) => onPanelSizeChange(activeRaw?.widthMm ?? mm, mm)}
                  widthError={showValidation && errors.panels ? t('fields.widthMmRequired') : undefined}
                  heightError={showValidation && errors.panels ? t('fields.heightMmRequired') : undefined}
                  headShape={activePanel.headShape}
                  headRiseMm={activePanel.headRiseMm ?? null}
                  frameFaceMm={lightCtx(activePanelIndex).metrics.frameFace}
                  onHeadShapeChange={(shape) => {
                    // A fresh, shape-appropriate default every time the
                    // shape button changes — NOT a carried-over rise
                    // from whatever shape was selected before. A rise
                    // that made sense for segmental can sit right at or
                    // below gothic's own minimum (see
                    // arch-geometry.ts's minGothicRiseMm), where gothic
                    // stops being a point and turns into a
                    // self-intersecting "heart" shape.
                    const widthForRise = drawableMm(activeRaw?.widthMm ?? NaN, PLACEHOLDER_WIDTH_MM)
                    const heightForRise = drawableMm(activeRaw?.heightMm ?? NaN, PLACEHOLDER_HEIGHT_MM)
                    const defaultRise =
                      shape === HeadShape.SEGMENTAL
                        ? Math.round(widthForRise / 3)
                        : shape === HeadShape.GOTHIC
                          ? Math.round(minGothicRiseMm(widthForRise) * 1.15) // clear margin past the floor, not sitting right on it
                          : Math.round(widthForRise / 2) // round — normalizeHeadRise pins this exactly regardless
                    const rise = shape === HeadShape.FLAT ? null : normalizeHeadRise(shape, widthForRise, defaultRise, heightForRise, lightCtx(activePanelIndex).metrics.frameFace)
                    // Dividers on the head re-land on the flat top (or
                    // the other way round) — changeHeadShape (§8). Any
                    // that can't are listed and confirmed first.
                    const panelIndex = activePanelIndex
                    const apply = () =>
                      commitPanels(
                        panels.map((p, i) => (i === panelIndex ? changeHeadShape(p, shape, rise, lightCtx(i)) : p)),
                        'changeHeadShape',
                      )
                    const doomed = activeRaw && sized(activeRaw) ? headShapeDoomed(activeRaw, shape, rise, lightCtx(panelIndex)) : []
                    if (doomed.length === 0) apply()
                    else setHeadConfirm({ names: doomed.map((id) => dividerLabel(panelIndex, id)), apply })
                  }}
                  onHeadRiseChange={(mm) => {
                    const rise = normalizeHeadRise(
                      activePanel.headShape,
                      drawableMm(activeRaw?.widthMm ?? NaN, PLACEHOLDER_WIDTH_MM),
                      mm,
                      drawableMm(activeRaw?.heightMm ?? NaN, PLACEHOLDER_HEIGHT_MM),
                      lightCtx(activePanelIndex).metrics.frameFace,
                    )
                    commitPanels(
                      panels.map((p, i) => (i === activePanelIndex ? withAlignedSections(p, { ...p, headRiseMm: rise }, lightCtx(i)) : p)),
                      'changeHeadRise',
                    )
                  }}
                  headShapeAllowed={canHaveArchedHead({ isDoor: activePanel.isDoor, systemType: activeInfo.systemType })}
                  interiorColor={activePanel.interiorColor ?? null}
                  exteriorColor={activePanel.exteriorColor ?? null}
                  onInteriorColorChange={(value) => updateActivePanel({ interiorColor: value as ScopedRef | null }, 'changeColor')}
                  onExteriorColorChange={(value) => updateActivePanel({ exteriorColor: value as ScopedRef | null }, 'changeColor')}
                  colorOptions={colorOptions}
                  showDoor={activeInfo.showDoor}
                  isDoor={activePanel.isDoor}
                  onDoorChange={(value) => updateActivePanel({ isDoor: value }, 'changeDoor')}
                  isGridded={activeIsGridded}
                  dividerProfile={activePanel.dividerProfile}
                  onDividerProfileChange={onDividerProfileChange}
                  dividerProfileError={showValidation && errors.panels ? t('fields.dividerProfileRequired') : undefined}
                  frameCatalogRef={activeInfo.frame?.catalog}
                  activeSection={{
                    sectionIndex: activeSectionIndex,
                    kind: activeSection.kind,
                    fixedOnly: !!activeLight && isFixedOnlyLight(activeLight),
                    onKindChange: onSectionKindChange,
                    widthMm: activeLightPitch ? Math.round(activeLightPitch.x1 - activeLightPitch.x0) : null,
                    heightMm: activeLightPitch ? Math.round(activeLightPitch.y1 - activeLightPitch.y0) : null,
                    onWidthChange: (mm) => onLightSizeChange('x', mm),
                    onHeightChange: (mm) => onLightSizeChange('y', mm),
                    showOpeningTypes: activeInfo.showOpeningTypes,
                    openingType: activeSection.openingType ?? null,
                    onOpeningTypeChange: onSectionOpeningTypeChange,
                    sashProfile: activeSection.sashProfile ?? '',
                    sashOptions,
                    onSashChange: (ref) => updateActiveSection({ sashProfile: ref, glass: '' as ScopedRef }, 'changeSash'),
                    sashWeightKg: activeSashWeightKg,
                    maxSashWeight: activeInfo.maxSashWeight,
                    beadProfile: activeSection.beadProfile ?? '',
                    beadOptions,
                    onBeadChange: (ref) => updateActiveSection({ beadProfile: ref, glass: '' as ScopedRef }, 'changeBead'),
                    hasFlyScreen: activeSection.hasFlyScreen,
                    flyScreenAllowed: activeInfo.flyScreenAllowed,
                    onFlyScreenChange: (value) => updateActiveSection({ hasFlyScreen: value }, 'changeFlyScreen'),
                    isSliding: activeIsSliding,
                    slidingLayout: activeSection.sliding ?? null,
                    slidingRails: activeSlidingRails,
                    onSlidingLayoutChange: setSlidingLayout,
                    glassValue,
                    glassOptions,
                    onGlassChange: (kind, ref) => updateActiveSection({ glassKind: kind, glass: ref }, 'changeGlass'),
                    maxGlassAllowed: activeSectionInfo?.maxGlassAllowed ?? null,
                    sashMaxGlassThickness: activeSectionInfo?.sashMaxGlassThickness ?? null,
                    beadMaxGlassThickness: activeSectionInfo?.beadMaxGlassThickness ?? null,
                  }}
                  selectedDivider={selectedDivider}
                  location={watch('location') ?? null}
                  onLocationChange={(value) => commitField('location', value)}
                  notes={watch('notes') ?? null}
                  onNotesChange={(value) => commitField('notes', value)}
                />
              )}
            </div>
            {/* Save lives with the options it commits (redesign §2,
                decision 8). No autosave — the line only reports the
                form's own dirty state. */}
            <div className="flex shrink-0 flex-col gap-2.5 border-t border-border p-3">
              <span
                className={cn(
                  'flex items-center gap-1.5 text-xs',
                  isEdit && !isDirty ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground',
                )}
              >
                {isEdit && !isDirty && <Check className="size-3.5" aria-hidden="true" />}
                {!isEdit
                  ? t('windowDialog.design.saveState.new')
                  : isDirty
                    ? t('windowDialog.design.saveState.unsaved')
                    : t('windowDialog.design.saveState.saved')}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => requestLeave(onDone)}>
                  {t('actions.cancel')}
                </Button>
                <Button type="submit" className="flex-[2]" disabled={isSubmitting}>
                  {isEdit ? t('actions.save') : t('actions.create')}
                </Button>
              </div>
            </div>
            </aside>
          </div>
        </form>
      </div>

      {/* One gate for every way to leave this screen with unsaved
          changes — see `requestLeave` above. `onOpenChange(false)` is
          the single place that decides "Discard" from every other way
          the dialog closes (Cancel, Escape, an outside click all mean
          "stay"), via `confirmedRef` set just before Discard's own
          click closes it. */}
      <DeleteDividerDialog
        request={deleteRequest}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={(keep, mode) => {
          if (deleteRequest) applyDividerDelete(deleteRequest.panelIndex, deleteRequest.ids, keep, mode)
          setDeleteRequest(null)
        }}
      />
      <AlertDialog open={headConfirm !== null} onOpenChange={(open) => !open && setHeadConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('windowDialog.design.headFlatConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('windowDialog.design.headFlatConfirm.description', { names: headConfirm?.names.join(', ') ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                headConfirm?.apply()
                setHeadConfirm(null)
              }}
            >
              {t('windowDialog.design.headFlatConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

/** What one undo step restores — the five fields every edit goes
 * through, plus the camera offset `commitPanels` moves alongside
 * `panels` (without it, undoing "add panel on the left" slides the
 * drawing sideways — bug-067's family). */
interface EditorSnapshot {
  name: CreateWindowInput['name']
  quantity: CreateWindowInput['quantity']
  panels: WindowPanelInput[]
  location: CreateWindowInput['location']
  notes: CreateWindowInput['notes']
  originOffsetMm: { x: number; y: number }
}

/** The name of an undo step — `windowDialog.design.history.<label>` —
 * required by every door so the compiler finds a call that forgot one. */
type EditLabel =
  | 'addPanel'
  | 'deletePanel'
  | 'resizePanel'
  | 'resizeSection'
  | 'addDivider'
  | 'moveDivider'
  | 'removeDivider'
  | 'drawDivider'
  | 'bendDivider'
  | 'moveDividerEnd'
  | 'changeDividerRadius'
  | 'swapCrossing'
  | 'changeFrame'
  | 'changeDividerProfile'
  | 'changeSectionType'
  | 'changeOpening'
  | 'changeSash'
  | 'changeBead'
  | 'changeFlyScreen'
  | 'changeGlass'
  | 'changeColor'
  | 'changeDoor'
  | 'changeHeadShape'
  | 'changeHeadRise'
  | 'editSlidingLayout'
  | 'moveSash'
  | 'changeSlidingDirection'
  | 'rename'
  | 'changeQuantity'
  | 'editLocation'
  | 'editNotes'

const FIELD_LABELS = {
  name: 'rename',
  quantity: 'changeQuantity',
  location: 'editLocation',
  notes: 'editNotes',
} as const satisfies Record<string, EditLabel>

/** Where the user was when a step was made — restored on undo AND redo
 * (planing decision 2), clamped by `applyStep`. */
interface EditorView {
  selectedPartId: string | null
  activePanelIndex: number
  activeSectionIndex: number
  selectedPanelIndices: number[]
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

/** A blank panel — no dividers, one fixed light. Width/height are NaN,
 * not 0, so their inputs render empty rather than showing a number
 * nobody typed (the drawing falls back to PLACEHOLDER_* for the
 * elevation). */
function emptyPanel(favoriteFrameProfile?: string | null): WindowPanelInput {
  return {
    xMm: 0,
    yMm: 0,
    widthMm: NaN,
    heightMm: NaN,
    frameProfile: (favoriteFrameProfile ?? '') as ScopedRef,
    dividerProfile: null,
    dividers: [],
    sections: [
      {
        faceKey: SINGLE_LIGHT_KEY,
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
  }
}

/** The one light of a flat panel with no dividers — its four sides
 * (light-graph.ts face key). */
const SINGLE_LIGHT_KEY = 'left|right|sill|top'
