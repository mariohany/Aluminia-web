import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  GlassKind,
  HeadShape,
  PanelType,
  createWindowSchema,
  type CreateWindowInput,
  type WindowDetail,
  type WindowPanelInput,
  type WindowPanelTransomInput,
  type WindowPanelWindowInput,
} from '@repo/types/windows'
import { ProfileType } from '@repo/types/lookups'
import { formatScopedRef, type ScopedRef } from '@repo/types/company-lookups'
import type { ProjectDetail } from '@repo/types/projects'
import { apiErrorMessage } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  useMergedColorsQuery,
  useMergedGlassCombinationsQuery,
  useMergedGlassQuery,
  useMergedSystemCatalogsQuery,
  useMergedSystemProfilesQuery,
} from '@/lib/lookup-merge'
import { useUpdateProjectMutation } from '@/lib/projects-queries'
import { useCreateWindowMutation, useUpdateWindowMutation, useWindowQuery } from '@/lib/windows-queries'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/workspace/field-label'
import { ProfileTreePicker } from '@/components/workspace/profile-tree-picker'
import { WindowDrawing } from '@/components/workspace/window-drawing'
import { useResolvedPanels, type PanelRender } from '@/lib/window-render'
import { WindowPartPanel } from '@/components/workspace/window-part-panel'
import { TransomPartPanel } from '@/components/workspace/transom-part-panel'
import { AddPanelCard, type AddPanelRequest } from '@/components/workspace/add-panel-card'
import { AddPanelTypeStep } from '@/components/workspace/add-panel-type-step'
import { AddTransomCard, type AddTransomInput } from '@/components/workspace/add-transom-card'
import {
  buildAssemblyLayout,
  canHaveArchedHead,
  freeSidesOf,
  insertPanel,
  panelRect,
  panelsConnected,
  parsePartId,
  prefillForSide,
  removePanel,
  resizePanel,
  tilesExactly,
  touchesTopEdge,
  unionRect,
  type AssemblyPanelInput,
  type PanelPlacement,
  type PanelSide,
} from '@/lib/window-geometry'
import { minGothicRiseMm, normalizeHeadRise, radiusFromSag, sagFromRadius } from '@/lib/arch-geometry'
import { barLengthMm, dependentsOf, removeBarCascade, resolveBar } from '@/lib/arch-bars'
import { outlineOf } from '@/components/workspace/window-shapes'
import { collectTransomIssues, collectWindowIssues, computeSashWeightKg, resolveGlassWeightPerSqm, type TranslatedIssue } from '@/lib/window-weight'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

interface WindowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** For the favourite frame pre-select and the tree's preferred catalogue. */
  project?: ProjectDetail
  /** Absent for create; present for edit — fetched internally, so the
   * caller (a canvas card, which only holds a `WindowSummary`) doesn't
   * need the full detail just to open this dialog. */
  windowId?: string
  onCreated?: (window: WindowDetail) => void
}

/**
 * Create or edit a window ASSEMBLY — one screen, one `useForm`, one
 * submit: a frame profile tree, a clickable elevation of every panel
 * (`window-drawing.tsx`), and an options panel (`window-part-panel.tsx`)
 * that edits whichever panel owns the selected part.
 *
 * Hovering a panel puts a "+" on each of its free sides; selecting
 * several panels (ctrl/cmd-click) offers one on the sides of their
 * combined outline. See docs/window_assembly_planing.md.
 *
 * Every field uses the controlled `watch()`/`setValue()` pattern, never
 * `register()` + `setValueAs`, for numeric/select fields — a
 * `register()`-driven numeric input populated via `reset()` and never
 * typed into can silently submit as `null` (bug-011).
 */
export function WindowDialog({
  open,
  onOpenChange,
  projectId,
  project,
  windowId,
  onCreated,
}: WindowDialogProps) {
  const { t } = useTranslation('workspace')
  const { t: tLookups } = useTranslation('lookups')
  const { t: tCommon } = useTranslation('common')
  const isEdit = !!windowId

  // Drawing selection/hover state — owned here (not inside WindowDrawing
  // itself) per docs/window_design_planing.md §3, so it can also drive
  // the options panel's scroll-to-and-highlight behaviour.
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null)
  const [drawingFace, setDrawingFace] = useState<'interior' | 'exterior'>('exterior')
  // Which panel the options column edits, and which panels a new one
  // would attach to. They coincide except while multi-selecting.
  const [activePanelIndex, setActivePanelIndex] = useState(0)
  const [selectedPanelIndices, setSelectedPanelIndices] = useState<number[]>([0])
  // Sticky: set when the pointer enters a panel, cleared only when it
  // leaves the whole drawing. Deriving it from `hoveredPartId` instead
  // made the "+" markers flicker out the moment the pointer crossed
  // onto one of them — the panel's own mouseleave had already fired.
  const [hoveredPanelIndex, setHoveredPanelIndex] = useState<number | null>(null)
  const [addRequest, setAddRequest] = useState<AddPanelRequest | null>(null)
  // `null` while the type-step (Window/Transom) is still showing — set
  // the instant one is chosen, cleared together with `addRequest` on
  // cancel/confirm. Two independent pieces of state, not a single
  // `AddPanelRequest & { type }`, because the size/side pre-fill is
  // identical either way (`prefillForSide` doesn't know or care what
  // kind of panel is coming) while the type is a separate later choice.
  const [addPanelType, setAddPanelType] = useState<PanelType | null>(null)
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

  const editingWindowQuery = useWindowQuery(open && windowId ? windowId : undefined)
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
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<CreateWindowInput>({
    resolver: zodResolver(createWindowSchema),
    defaultValues: emptyWindow(projectId),
  })

  // Guards the create-mode reset below so it only fires on the
  // closed→open transition, not on every render while open. Without
  // this, setting a favourite from the tree's right-click menu mid-fill
  // (a real thing to do, since the tree lives inside this very dialog)
  // changes `project.favoriteFrameProfile`, which would otherwise
  // re-trigger the effect and wipe out whatever the user had already
  // typed — confirmed live in the browser, not hypothetical (bug-012).
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      setSelectedPartId(null)
      setActivePanelIndex(0)
      setSelectedPanelIndices([0])
      setHoveredPanelIndex(null)
      setAddRequest(null)
      setAddPanelType(null)
      // `WindowDialog` is a single instance reused across every window
      // (no `key`, see the `activePanelIndex`-keyed effect below for
      // why that one alone isn't enough) — without this, closing the
      // dialog while mid-drawing left `barDrawMode` stuck `true` for
      // whatever window got opened next, panel 0 or not. Found live:
      // reopening this exact test window showed "Drawing…" already
      // active with nothing drawn yet.
      setBarDrawMode(false)
      setSelectedBarId(null)
      setPendingDeleteBarId(null)
      return
    }
    // Editing, but the detail fetch hasn't landed yet — wait rather than
    // briefly resetting to blank create-mode defaults.
    if (isEdit && !editingWindow) return
    if (wasOpen.current) return
    wasOpen.current = true
    reset(
      editingWindow
        ? {
            projectId,
            name: editingWindow.name,
            quantity: editingWindow.quantity,
            // Docs/transom_tasks.md Step 5: a saved window can now
            // genuinely contain a transom panel, so this branches per
            // `panelType` rather than asserting every row is a window
            // the way it used to. Both branches share the same
            // string→ScopedRef re-cast — `WindowPanelDetail`'s own
            // refs are already exactly `ScopedRef`-shaped strings, this
            // is just recovering the narrower type react-hook-form's
            // generic loses.
            panels: editingWindow.panels.map((p) =>
              p.panelType === PanelType.WINDOW
                ? {
                    ...p,
                    frameProfile: p.frameProfile as ScopedRef,
                    sashProfile: p.sashProfile as ScopedRef,
                    glass: p.glass as ScopedRef,
                    interiorColor: p.interiorColor as ScopedRef | null,
                    exteriorColor: p.exteriorColor as ScopedRef | null,
                  }
                : {
                    ...p,
                    transomProfile: p.transomProfile as ScopedRef,
                    glass: p.glass as ScopedRef,
                    interiorColor: p.interiorColor as ScopedRef | null,
                    exteriorColor: p.exteriorColor as ScopedRef | null,
                  },
            ),
            location: editingWindow.location,
            notes: editingWindow.notes,
          }
        : emptyWindow(projectId, project?.favoriteFrameProfile ?? null),
    )
  }, [open, isEdit, editingWindow, reset, projectId, project?.favoriteFrameProfile])

  // The full union, not window-only — the "+" flow can genuinely append
  // a transom now (docs/transom_tasks.md Step 5).
  const panels = watch('panels') as WindowPanelInput[]
  const quantity = watch('quantity')

  // ---- Per-panel catalogue resolution --------------------------------
  //
  // Every one of these used to be computed once for the whole window.
  // An assembly's panels each have their own frame, so each has its own
  // system type, its own sash options, its own glass thickness ceiling
  // and its own weight limit.

  // Resolved once, shared with the canvas card's own thumbnail — see
  // lib/window-render.ts. `drawingFace` picks which side's colour the
  // elevation is painted in.
  const resolved = useResolvedPanels(panels, drawingFace)
  const panelInfos = resolved.map((r) => r.info)

  // A panel's door/opening-type/fly-screen flags are only meaningful for
  // certain frames. Rather than an effect that writes back into the form
  // (one per panel, each a chance to loop), the stale value is simply
  // never READ: the drawing, the options column and the submitted body
  // all use this sanitised view. Changing a frame away and back
  // therefore restores what you had, instead of silently destroying it.
  //
  // A transom has none of those three fields AT ALL (not merely unset —
  // structurally absent, `transomPanelSchema.strict()`) — passed through
  // unchanged rather than run through this window-only sanitisation,
  // which would otherwise inject fields the storage schema rejects.
  const sanitizedPanels: WindowPanelInput[] = panels.map((panel, i) => {
    if (panel.panelType !== PanelType.WINDOW) return panel
    const info = panelInfos[i]
    return {
      ...panel,
      isDoor: info.showDoor ? panel.isDoor : false,
      openingType: info.showOpeningTypes ? (panel.openingType ?? null) : null,
      hasFlyScreen: info.flyScreenAllowed ? panel.hasFlyScreen : false,
    }
  })

  const colorOptions = (colorsQuery.data ?? []).map((c) => ({
    value: formatScopedRef(c.scope, c.id),
    label: c.code,
    hex: c.hex,
    scope: c.scope,
  }))

  // ---- Layout ---------------------------------------------------------

  // Recomputed on every render (cheap, pure) rather than memoized —
  // both the drawing and the panel's per-part sizes need it, so it's
  // lifted here instead of built twice. Branches per `panelType`
  // (`AssemblyPanelInput`'s own union, docs/transom_tasks.md Step 3) —
  // a transom needs nothing beyond its own placement and drawable size.
  const layoutInput: AssemblyPanelInput[] = sanitizedPanels.map((panel, i) =>
    panel.panelType === PanelType.WINDOW
      ? {
          panelType: PanelType.WINDOW,
          xMm: panel.xMm,
          yMm: panel.yMm,
          widthMm: drawableMm(panel.widthMm, PLACEHOLDER_WIDTH_MM),
          heightMm: drawableMm(panel.heightMm, PLACEHOLDER_HEIGHT_MM),
          systemType: panelInfos[i].systemType,
          hasFlyScreen: panel.hasFlyScreen,
          flyScreenAllowed: panelInfos[i].flyScreenAllowed,
          isDoor: panel.isDoor,
          openingType: panel.openingType ?? null,
          headShape: panel.headShape,
          headRiseMm: panel.headRiseMm,
        }
      : {
          panelType: PanelType.TRANSOM,
          xMm: panel.xMm,
          yMm: panel.yMm,
          widthMm: drawableMm(panel.widthMm, PLACEHOLDER_WIDTH_MM),
          heightMm: drawableMm(panel.heightMm, PLACEHOLDER_HEIGHT_MM),
        },
  )
  const drawingLayout = buildAssemblyLayout(layoutInput)

  const activePanel = sanitizedPanels[activePanelIndex] ?? sanitizedPanels[0]
  const activeInfo = panelInfos[activePanelIndex] ?? panelInfos[0]
  const activeRaw = panels[activePanelIndex] ?? panels[0]
  // Bars only exist on a window's own head — a transom is always flat
  // and has no `bars` field at all (decision 6). `[]` here means
  // "nothing to select", the same as if no bar were selected — every
  // control below that used to read `activePanel.bars` directly reads
  // this instead, safe regardless of which kind of panel is active.
  const activeBars = activePanel.panelType === PanelType.WINDOW ? activePanel.bars : []

  // ---- Bars — select/delete/drag/bow (§6.3/§6.4/§6.5) ------------------

  const activeGlassPart = drawingLayout.parts.find((p) => p.panelIndex === activePanelIndex && p.kind === 'glass')
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

  // ---- Attach affordance ---------------------------------------------
  //
  // With two or more panels selected the markers stay put — that
  // selection was deliberate. With one or none they follow the pointer,
  // which is the user's own "when I hover over a window" ask.

  const effectiveAttachIndices =
    selectedPanelIndices.length >= 2
      ? selectedPanelIndices
      : hoveredPanelIndex !== null
        ? [hoveredPanelIndex]
        : []

  // Geometry runs on the raw panels, whose placement fields are the same
  // as the sanitised ones — sanitising only touches door/opening/fly
  // screen. Identity matters: freeSidesOf excludes the selection by
  // reference.
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
  // non-flat but isn't archable (sliding, a hinged door, …) silently
  // draws flat per Step 7's own scope, and attaching above it is
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

  const onAddPanel = (side: PanelSide, at: { left: number; top: number }) => {
    if (attachPanels.length === 0) return
    const source = attachPanels[0]
    setAddError(undefined)
    setAddPanelType(null)
    setAddRequest({ side, at, ...prefillForSide(side, attachPanels, source) })
  }

  // Shared by every stage of the flow (the type-step, either size
  // card) — cancelling any of them clears the whole thing back to
  // nothing showing, same as the single "X" the old two-stage flow had.
  const onCancelAddPanel = () => {
    setAddRequest(null)
    setAddPanelType(null)
    setAddError(undefined)
  }

  // Lands the newly-appended panel as the active one with its frame/
  // ring selected, so the options column is already showing what to
  // change — shared by both confirm handlers below, not duplicated,
  // since only WHICH part id to select differs (a transom has no sash,
  // but its frame ring is still `:frame`, so even that's the same).
  const landOnNewPanel = (next: WindowPanelInput[]) => {
    setValue('panels', next, { shouldValidate: true })
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
    // Clones the panel attached to — same frame, sash, glass, colours,
    // opening type and flags. Only the size differs. A transom has none
    // of those fields to clone (it's a genuinely different shape), so
    // adding a WINDOW next to one falls back to the same blank defaults
    // a window with no neighbour at all starts from, rather than
    // spreading a transom's fields onto a `panelType: 'window'` object.
    const base = source.panelType === PanelType.WINDOW ? source : emptyPanel()
    const next = insertPanel(panels, addRequest.side, attachPanels, {
      ...base,
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

  const onConfirmAddTransom = (input: AddTransomInput) => {
    if (!addRequest || attachPanels.length === 0) return
    const widthMm = addRequest.side === 'top' || addRequest.side === 'bottom' ? addRequest.widthMm : input.sizeMm
    const heightMm = addRequest.side === 'top' || addRequest.side === 'bottom' ? input.sizeMm : addRequest.heightMm
    const next = insertPanel(panels, addRequest.side, attachPanels, {
      panelType: PanelType.TRANSOM,
      xMm: 0,
      yMm: 0,
      widthMm: Math.round(widthMm),
      heightMm: Math.round(heightMm),
      transomProfile: input.transomProfile,
      glassKind: input.glassKind,
      glass: input.glass,
      interiorColor: null,
      exteriorColor: null,
    })
    if (!next) {
      setAddError(t('windowDialog.design.addPanel.wouldOverlap'))
      return
    }
    landOnNewPanel(next)
  }

  // ---- Panel mutation -------------------------------------------------

  const updateActivePanel = (changes: Partial<WindowPanelWindowInput>) => {
    setValue(
      'panels',
      // Only ever touches an ACTUAL window panel — the `&&` narrows
      // `panel` inside this ternary's true branch, so the spread below
      // type-checks against the window branch specifically. Falls
      // through unchanged (a defensive no-op, not expected to fire) if
      // `activePanelIndex` somehow pointed at a transom: every caller
      // of this function lives inside JSX that only renders once the
      // active panel is confirmed to be a window (see the
      // `WindowPartPanel` gate below).
      panels.map((panel, i) =>
        i === activePanelIndex && panel.panelType === PanelType.WINDOW ? { ...panel, ...changes } : panel,
      ),
      { shouldValidate: true },
    )
  }

  // The transom counterpart to `updateActivePanel` above — same
  // shape, same defensive narrowing, just the other branch of the
  // union (docs/transom_tasks.md Step 6).
  const updateActiveTransomPanel = (changes: Partial<WindowPanelTransomInput>) => {
    setValue(
      'panels',
      panels.map((panel, i) =>
        i === activePanelIndex && panel.panelType === PanelType.TRANSOM ? { ...panel, ...changes } : panel,
      ),
      { shouldValidate: true },
    )
  }

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

  const onPanelSizeChange = (widthMm: number, heightMm: number) => {
    setValue('panels', resizePanel(panels, activePanelIndex, widthMm, heightMm), { shouldValidate: true })
  }

  const canDeletePanel = panels.length > 1 && removePanel(panels, activePanelIndex) !== null
  const onDeletePanel = () => {
    const next = removePanel(panels, activePanelIndex)
    if (!next) return
    setValue('panels', next, { shouldValidate: true })
    const fallback = Math.max(0, activePanelIndex - 1)
    setActivePanelIndex(fallback)
    setSelectedPanelIndices([fallback])
    setSelectedPartId(null)
  }

  const onSelectPart = (partId: string, additive: boolean) => {
    const panelIndex = parsePartId(partId)?.panelIndex ?? 0
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
  }

  // ---- Active panel's options ----------------------------------------

  const sashOptions = (profilesQuery.data ?? [])
    .filter((p) => p.profileType === ProfileType.LEAF && p.catalog === activeInfo?.frame?.catalog)
    .sort((a, b) => a.profileNo.localeCompare(b.profileNo))

  const glassOptions = [
    ...(glassQuery.data ?? [])
      .filter((g) => activeInfo?.maxGlassAllowed != null && g.thickness <= activeInfo.maxGlassAllowed)
      .map((g) => ({
        value: `${GlassKind.SINGLE}|${formatScopedRef(g.scope, g.id)}`,
        label: `${g.name} — ${g.thickness} mm`,
        scope: g.scope,
      })),
    ...(combinationsQuery.data ?? [])
      .filter((c) => activeInfo?.maxGlassAllowed != null && c.totalThickness <= activeInfo.maxGlassAllowed)
      .map((c) => ({
        value: `${GlassKind.COMBINATION}|${formatScopedRef(c.scope, c.id)}`,
        label: `${c.name} — ${c.totalThickness} mm`,
        scope: c.scope,
      })),
  ]
  const glassValue = activePanel?.glass ? `${activePanel.glassKind}|${activePanel.glass}` : ''

  // The active panel's own weight estimate, for the options column's
  // weight line. Recomputed here rather than plucked out of `issuesByPart`,
  // which only carries the translated message, not the number — and which
  // stays empty until `showValidation`. Window-only (the `panelType`
  // check first in the chain also narrows `activePanel` for the rest of
  // it) — the transom mirror is `activeTransomWeightKg`, right below.
  const activeSashPart = drawingLayout.parts.find((p) => p.panelIndex === activePanelIndex && p.kind === 'sash')
  const activeSashWeightKg =
    activePanel.panelType === PanelType.WINDOW &&
    activeInfo?.sash &&
    (activeInfo.currentGlass ?? activeInfo.currentCombination) &&
    activeSashPart
      ? computeSashWeightKg({
          rectMm: activeSashPart.rectMm,
          glassWeightPerSqm: resolveGlassWeightPerSqm(
            activePanel.glassKind,
            activeInfo.currentGlass,
            activeInfo.currentCombination,
            glassQuery.data ?? [],
          ),
          sashProfile: activeInfo.sash,
          head: activeSashPart.head,
          bars: activePanel.bars,
        })
      : null

  // §6: literally the same `computeSashWeightKg` call, sourcing
  // `weight`/`maxGlassThickness` from the transom's own profile
  // (already resolved under `info.sash` — see window-render.ts's own
  // comment on why) instead of a window's sash. `rectMm` is the FRAME
  // part's own rect, not a `sash` one — a transom has no separate sash
  // part at all, its frame ring IS the whole extrusion
  // (`buildTransomLayout`). No `head`/`bars`: a transom is always flat
  // with no bars (decision 6), so the plain rectangular perimeter
  // `computeSashWeightKg` falls back to without those args is already
  // exactly right.
  const activeFramePart = drawingLayout.parts.find((p) => p.panelIndex === activePanelIndex && p.kind === 'frame')
  const activeTransomWeightKg =
    activePanel.panelType === PanelType.TRANSOM &&
    activeInfo?.sash &&
    (activeInfo.currentGlass ?? activeInfo.currentCombination) &&
    activeFramePart
      ? computeSashWeightKg({
          rectMm: activeFramePart.rectMm,
          glassWeightPerSqm: resolveGlassWeightPerSqm(
            activePanel.glassKind,
            activeInfo.currentGlass,
            activeInfo.currentCombination,
            glassQuery.data ?? [],
          ),
          sashProfile: activeInfo.sash,
        })
      : null

  // Changing the frame invalidates the sash (scoped to its catalogue)
  // and, transitively, the glass (scoped to the sash's max thickness) —
  // same cascade rule ProjectPreferencesFields uses for brand →
  // catalogue. Applies to the ACTIVE panel only.
  const onFrameChange = (ref: ScopedRef) => {
    updateActivePanel({ frameProfile: ref, sashProfile: '' as ScopedRef, glass: '' as ScopedRef })
  }

  // The transom mirror of `onFrameChange` — its own profile is the
  // whole glass-ceiling, so changing it invalidates glass the same way.
  const onTransomProfileChange = (ref: ScopedRef) => {
    updateActiveTransomPanel({ transomProfile: ref, glass: '' as ScopedRef })
  }

  // ---- The face toggle -------------------------------------------------

  // Only matters when it would actually show something different — both
  // colours picked on some panel, and they don't resolve to the same hex
  // (two different colour entries can still be visually identical).
  const showFaceToggle = sanitizedPanels.some((panel) => {
    if (!panel.interiorColor || !panel.exteriorColor) return false
    const interiorHex = colorOptions.find((c) => c.value === panel.interiorColor)?.hex ?? null
    const exteriorHex = colorOptions.find((c) => c.value === panel.exteriorColor)?.hex ?? null
    return interiorHex !== exteriorHex
  })

  // ---- Per-panel render descriptors ------------------------------------

  // `useResolvedPanels` already did the catalogue work (colours, glass
  // tint, Georgian grid). Two fields are overridden here: `placement`
  // uses the drawable fallback so an unsized panel still renders, and
  // the door/opening-type flags come from the sanitised view rather than
  // the raw form value — window-only fields, so a transom entry keeps
  // whatever `useResolvedPanels` already defaulted them to (false/null).
  const panelRenders: PanelRender[] = resolved.map((r, i) => {
    const panel = sanitizedPanels[i]
    return panel.panelType === PanelType.WINDOW
      ? { ...r.render, placement: layoutInput[i], isDoor: panel.isDoor, openingType: panel.openingType ?? null }
      : { ...r.render, placement: layoutInput[i] }
  })

  // ---- Issues ----------------------------------------------------------

  // A brand-new window starts with every required field empty — showing
  // "Pick a sash profile." before the user has touched anything reads as
  // the dialog already complaining. Editing an existing window always
  // shows its real issues; creating one stays quiet until first submit.
  const showValidation = isEdit || isSubmitted

  const issuesByPart = new Map<string, TranslatedIssue[]>()
  if (showValidation) {
    sanitizedPanels.forEach((panel, i) => {
      if (panel.panelType !== PanelType.WINDOW) {
        const info = panelInfos[i]
        const glassPart = drawingLayout.parts.find((p) => p.panelIndex === i && p.kind === 'glass')
        for (const issue of collectTransomIssues({
          transomProfile: info.sash,
          hasGlass: !!panel.glass,
          glassThickness: info.currentGlass?.thickness ?? info.currentCombination?.totalThickness ?? null,
          maxGlassAllowed: info.maxGlassAllowed,
          glassPartId: glassPart?.id ?? `p${i}:glass-0`,
        })) {
          const translated: TranslatedIssue = {
            severity: issue.severity,
            messageKey: issue.messageKey,
            message: t(`windowDialog.design.issues.${issue.messageKey}`, issue.values),
          }
          issuesByPart.set(issue.partId, [...(issuesByPart.get(issue.partId) ?? []), translated])
        }
        return
      }
      const info = panelInfos[i]
      const parts = drawingLayout.parts.filter((p) => p.panelIndex === i)
      const framePart = parts.find((p) => p.kind === 'frame')
      const sashPart = parts.find((p) => p.kind === 'sash')
      const sashPartIds = parts.filter((p) => p.kind === 'sash').map((p) => p.id)
      const glassPartIds = parts.filter((p) => p.kind === 'glass').map((p) => p.id)
      const flyScreenPartId = parts.find((p) => p.kind === 'flyScreen')?.id ?? null
      const glassWeightPerSqm = resolveGlassWeightPerSqm(
        panel.glassKind,
        info.currentGlass,
        info.currentCombination,
        glassQuery.data ?? [],
      )
      const sashWeightKg =
        info.sash && (info.currentGlass ?? info.currentCombination) && sashPart
          ? computeSashWeightKg({
              rectMm: sashPart.rectMm,
              glassWeightPerSqm,
              sashProfile: info.sash,
              head: sashPart.head,
              bars: panel.bars,
            })
          : null
      // §7's archObstructed: a panel resting on an arched panel's own
      // curved head carves a void inside the assembly rather than at
      // its outline — checked against the RAW placements (`panels`),
      // same as `irregularOutline`/`panelsConnected` above use, not the
      // drawable-fallback `layoutInput`.
      const hasArchedHead = !!framePart?.head
      const hasPanelOnTop = panels.some((other, j) => j !== i && touchesTopEdge(panels[i], other))

      for (const issue of collectWindowIssues({
        frameProfile: info.frame,
        sashProfile: info.sash,
        hasGlass: !!panel.glass,
        glassThickness: info.currentGlass?.thickness ?? info.currentCombination?.totalThickness ?? null,
        maxGlassAllowed: info.maxGlassAllowed,
        sashWeightKg,
        maxSashWeight: info.maxSashWeight,
        hasFlyScreen: panel.hasFlyScreen,
        flyScreenAllowed: info.flyScreenAllowed,
        sashPartIds,
        glassPartIds,
        flyScreenPartId,
        framePartId: framePart?.id ?? `p${i}:frame`,
        hasArchedHead,
        hasPanelOnTop,
      })) {
        const translated: TranslatedIssue = {
          severity: issue.severity,
          messageKey: issue.messageKey,
          message: t(`windowDialog.design.issues.${issue.messageKey}`, issue.values),
        }
        issuesByPart.set(issue.partId, [...(issuesByPart.get(issue.partId) ?? []), translated])
      }
    })
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

  // The strip below the drawing — one row per distinct message, not per
  // part (four panels all missing a sash profile would otherwise repeat
  // "Pick a sash profile." four times).
  const stripIssues: { partId: string; severity: TranslatedIssue['severity']; message: string }[] = []
  const seenMessages = new Set<string>()
  for (const [partId, issues] of issuesByPart) {
    for (const issue of issues) {
      if (seenMessages.has(issue.message)) continue
      seenMessages.add(issue.message)
      stripIssues.push({ partId, ...issue })
    }
  }

  // ---- Submit ----------------------------------------------------------

  const onSubmit = async (data: CreateWindowInput) => {
    try {
      // Submits the sanitised panels, never the raw ones — a stale
      // openingType on a panel whose frame is no longer hinged must not
      // reach the API just because the control that set it is hidden.
      const body: CreateWindowInput = { ...data, panels: sanitizedPanels }
      if (isEdit) {
        const { projectId: _ignored, ...editable } = body
        await updateMutation.mutateAsync(editable)
        toast.success(t('windowDialog.updated'))
      } else {
        const created = await createMutation.mutateAsync(body)
        toast.success(t('windowDialog.created', { name: created.name }))
        onCreated?.(created)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('windowDialog.error')))
    }
  }

  // Once a frame profile is picked, its catalogue's system type is known
  // — swap the generic title for one naming it (e.g. "New sliding
  // window"), same label text `lookups.json`'s systemType filter uses.
  const dialogTitle = activeInfo?.systemType
    ? t(isEdit ? 'windowDialog.editTitleTyped' : 'windowDialog.createTitleTyped', {
        type: tLookups(`systemType.${activeInfo.systemType}`).toLowerCase(),
      })
    : t(isEdit ? 'windowDialog.editTitle' : 'windowDialog.createTitle')

  // Favouriting a frame also updates the project's own catalogue/brand
  // defaults, not just favoriteFrameProfile — a favourite frame that
  // isn't the project's own default catalogue would otherwise leave the
  // tree's "preferred catalogue" expansion pointing at the wrong branch
  // every time this dialog opens next. `ref` is whichever profile was
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

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* FIXED height and width (not max-h/max-w) with a constant 2rem
          viewport margin on every side — an intrinsic/auto height up to
          a cap still resizes the whole centered box every time inner
          content changes height (a validation message appearing, a
          tree branch expanding), which reads as the dialog visibly
          jumping/flickering. Fixing both dimensions means only the
          inner scroll regions ever move, and the three columns
          (tree/drawing/panel) get the full available width to lay out
          in rather than being capped at some fraction of the screen. */}
      <DialogContent
        className="flex h-[calc(100svh-4rem)] flex-col sm:max-w-[calc(100vw-4rem)]"
        // While drawing bars, Escape is `window-drawing.tsx`'s own —
        // it clears a pending anchor or exits draw mode (arch_windows_
        // planing.md §6.2). Radix's Dialog ALSO listens for Escape,
        // globally, to close the whole dialog; without this it wins
        // too, on the SAME keypress, silently discarding whatever
        // hasn't been saved yet. Found live in the browser: three
        // bars fanned from one point, pressed Escape meaning "stop
        // drawing," and the entire edit dialog closed instead.
        onEscapeKeyDown={(e) => {
          if (barDrawMode) e.preventDefault()
        }}
      >
        <form
          onSubmit={(e) => void handleSubmit(onSubmit)(e)}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{dialogTitle}</DialogTitle>
            {/* Kept for Radix's aria-describedby, not shown — the user
                asked for the visible subtitle gone, not the a11y wiring. */}
            <DialogDescription className="sr-only">{t('windowDialog.description')}</DialogDescription>
          </DialogHeader>

          {/* A frame profile tree (18rem) + the drawing (1fr) + a
              fixed-width options column, so all three stay put and
              never reflow when a different part is selected, per
              docs/window_design_planing.md's decisions table. Tree
              narrowed from its original 22rem — it only ever holds
              short profile codes, and the drawing is what benefits from
              the room. */}
          <div className="mt-6 grid min-h-0 flex-1 grid-cols-[18rem_1fr_26rem] gap-4 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-col border-e border-border ps-1 pe-3">
              {/* A transom has no frame profile at all (its own
                  transom profile is Step 6's job to edit) — this whole
                  tree is window-only, same stopgap posture as the
                  options column's own transom placeholder. */}
              {activePanel?.panelType === PanelType.WINDOW && (
                <>
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
                </>
              )}
              {showValidation && errors.panels && activePanel?.panelType === PanelType.WINDOW && (
                <p className="mt-1 shrink-0 text-xs text-destructive">{t('fields.frameProfileRequired')}</p>
              )}
            </div>

            <div className="flex min-h-0 flex-col gap-1.5">
              {showFaceToggle && (
                <div className="flex shrink-0 justify-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawingFace('interior')}
                    className={cn(
                      'rounded px-2 py-0.5',
                      drawingFace === 'interior' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t('windowDialog.design.interior')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawingFace('exterior')}
                    className={cn(
                      'rounded px-2 py-0.5',
                      drawingFace === 'exterior' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t('windowDialog.design.exterior')}
                  </button>
                </div>
              )}
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
                  onPanelWidthChange={(mm) => onPanelSizeChange(mm, activeRaw?.heightMm ?? mm)}
                  onPanelHeightChange={(mm) => onPanelSizeChange(activeRaw?.widthMm ?? mm, mm)}
                  widthLabel={t('fields.widthMm')}
                  heightLabel={t('fields.heightMm')}
                  attachRect={attachRect}
                  attachSides={attachSides}
                  onPanelHover={setHoveredPanelIndex}
                  onAddPanel={onAddPanel}
                  overlay={
                    addPanelType === null ? (
                      <AddPanelTypeStep anchor={addRequest} onCancel={onCancelAddPanel} onChoose={setAddPanelType} />
                    ) : addPanelType === PanelType.WINDOW ? (
                      <AddPanelCard
                        request={addRequest}
                        error={addError}
                        onCancel={onCancelAddPanel}
                        onConfirm={onConfirmAddPanel}
                      />
                    ) : (
                      <AddTransomCard
                        request={addRequest}
                        error={addError}
                        onCancel={onCancelAddPanel}
                        onConfirm={onConfirmAddTransom}
                        preferredCatalogRef={isEdit ? undefined : project?.defaultSystemCatalog}
                        preferredBrandRef={isEdit ? undefined : project?.defaultSystemBrand}
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
                />
              </div>
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
              {activePanel && activePanel.panelType === PanelType.TRANSOM && (
                <TransomPartPanel
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
                  onNameChange={(value) => setValue('name', value, { shouldValidate: true })}
                  nameError={showValidation && errors.name ? t('fields.windowNameRequired') : undefined}
                  quantity={quantity}
                  onQuantityChange={(value) => setValue('quantity', value, { shouldValidate: true })}
                  quantityError={showValidation && errors.quantity ? t('fields.quantityRequired') : undefined}
                  widthMm={activeRaw?.widthMm ?? NaN}
                  heightMm={activeRaw?.heightMm ?? NaN}
                  onWidthChange={(mm) => onPanelSizeChange(mm, activeRaw?.heightMm ?? mm)}
                  onHeightChange={(mm) => onPanelSizeChange(activeRaw?.widthMm ?? mm, mm)}
                  widthError={showValidation && errors.panels ? t('fields.widthMmRequired') : undefined}
                  heightError={showValidation && errors.panels ? t('fields.heightMmRequired') : undefined}
                  transomProfile={activePanel.transomProfile}
                  onTransomChange={onTransomProfileChange}
                  transomProfileError={showValidation && errors.panels ? t('fields.transomProfileRequired') : undefined}
                  preferredCatalogRef={isEdit ? undefined : project?.defaultSystemCatalog}
                  preferredBrandRef={isEdit ? undefined : project?.defaultSystemBrand}
                  glassValue={glassValue}
                  glassOptions={glassOptions}
                  onGlassChange={(kind, ref) => updateActiveTransomPanel({ glassKind: kind, glass: ref })}
                  maxGlassAllowed={activeInfo?.maxGlassAllowed ?? null}
                  weightKg={activeTransomWeightKg}
                />
              )}
              {activePanel && activePanel.panelType === PanelType.WINDOW && activeInfo && (
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
                  deleteDisabledReason={
                    canDeletePanel ? undefined : t('windowDialog.design.deletePanelBlocked')
                  }
                  name={watch('name')}
                  onNameChange={(value) => setValue('name', value, { shouldValidate: true })}
                  nameError={showValidation && errors.name ? t('fields.windowNameRequired') : undefined}
                  quantity={quantity}
                  onQuantityChange={(value) => setValue('quantity', value, { shouldValidate: true })}
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
                    // self-intersecting "heart" shape. The button that
                    // re-selects the ALREADY active shape never reaches
                    // here — window-part-panel.tsx's button skips the
                    // call entirely — so this never resets a rise the
                    // user is still editing.
                    const widthForRise = drawableMm(activeRaw?.widthMm ?? NaN, PLACEHOLDER_WIDTH_MM)
                    const heightForRise = drawableMm(activeRaw?.heightMm ?? NaN, PLACEHOLDER_HEIGHT_MM)
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
                    openingType: activePanel.openingType ?? null,
                  })}
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
                  onInteriorColorChange={(value) =>
                    updateActivePanel({ interiorColor: value as ScopedRef | null })
                  }
                  onExteriorColorChange={(value) =>
                    updateActivePanel({ exteriorColor: value as ScopedRef | null })
                  }
                  colorOptions={colorOptions}
                  showDoor={activeInfo.showDoor}
                  isDoor={activePanel.isDoor}
                  onDoorChange={(value) => updateActivePanel({ isDoor: value })}
                  showOpeningTypes={activeInfo.showOpeningTypes}
                  openingType={activePanel.openingType ?? null}
                  onOpeningTypeChange={(value) => updateActivePanel({ openingType: value })}
                  sashProfile={activePanel.sashProfile}
                  sashOptions={sashOptions}
                  onSashChange={(ref) => updateActivePanel({ sashProfile: ref, glass: '' as ScopedRef })}
                  sashWeightKg={activeSashWeightKg}
                  maxSashWeight={activeInfo.maxSashWeight}
                  glassValue={glassValue}
                  glassOptions={glassOptions}
                  onGlassChange={(kind, ref) => updateActivePanel({ glassKind: kind, glass: ref })}
                  maxGlassAllowed={activeInfo.maxGlassAllowed}
                  sashMaxGlassThickness={activeInfo.sashMaxGlassThickness}
                  hasFlyScreen={activePanel.hasFlyScreen}
                  flyScreenAllowed={activeInfo.flyScreenAllowed}
                  onFlyScreenChange={(value) => updateActivePanel({ hasFlyScreen: value })}
                  location={watch('location') ?? null}
                  onLocationChange={(value) => setValue('location', value, { shouldValidate: true })}
                  notes={watch('notes') ?? null}
                  onNotesChange={(value) => setValue('notes', value, { shouldValidate: true })}
                />
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? t('actions.save') : t('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {/* Bar delete confirm — §6.3. The dependents it names are already
        highlighted in the danger colour on the drawing underneath by
        the time this renders (window-drawing.tsx reacts to
        `pendingDeleteBarId` directly), not just described in words
        here. A plain AlertDialog, not the typed-name confirm client/
        project deletion use — this is in-memory form state, gone the
        instant the outer dialog closes without saving, not a
        server-side cascade. */}
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

/** A blank panel. Width/height are NaN, not 0, so their inputs render
 * empty rather than showing a number nobody typed (the drawing falls
 * back to PLACEHOLDER_* for the elevation). Always a WINDOW — the "+"
 * flow that can create a TRANSOM panel instead is a later step
 * (docs/transom_tasks.md Step 5); this is only ever the assembly's
 * very first panel, or the create-mode default. */
function emptyPanel(favoriteFrameProfile?: string | null): WindowPanelWindowInput {
  return {
    panelType: PanelType.WINDOW,
    xMm: 0,
    yMm: 0,
    widthMm: NaN,
    heightMm: NaN,
    frameProfile: (favoriteFrameProfile ?? '') as ScopedRef,
    sashProfile: '' as ScopedRef,
    hasFlyScreen: false,
    isDoor: false,
    glassKind: GlassKind.SINGLE,
    glass: '' as ScopedRef,
    openingType: null,
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
