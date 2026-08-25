import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  GlassKind,
  createWindowSchema,
  type CreateWindowInput,
  type WindowDetail,
} from '@repo/types/windows'
import { CombinationItemKind, ProfileType } from '@repo/types/lookups'
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
import { WindowPartPanel } from '@/components/workspace/window-part-panel'
import { buildWindowLayout } from '@/lib/window-geometry'
import { collectWindowIssues, computeSashWeightKg, resolveGlassWeightPerSqm, type TranslatedIssue } from '@/lib/window-weight'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// The bead allowance subtracted from a sash's max glass thickness to get
// the largest glass build-up it can actually take. See
// docs/window_creation_planing.md §5's "The glass rule".
const BEAD_ALLOWANCE_MM = 2

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
 * Create or edit a window — one screen, one `useForm`, one submit: a
 * frame profile tree, a clickable elevation of the window
 * (`window-drawing.tsx`), and an options panel (`window-part-panel.tsx`)
 * that scrolls to and highlights whichever part is selected on the
 * drawing. There is no separate "basic info" step any more — every
 * field lives here.
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
  const isEdit = !!windowId

  // Drawing selection/hover state — owned here (not inside WindowDrawing
  // itself) per docs/window_design_planing.md §3, so it can also drive
  // the options panel's scroll-to-and-highlight behaviour.
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null)
  const [drawingFace, setDrawingFace] = useState<'interior' | 'exterior'>('exterior')

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
  // typed — confirmed live in the browser, not hypothetical.
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      setSelectedPartId(null)
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
            frameProfile: editingWindow.frameProfile as ScopedRef,
            sashProfile: editingWindow.sashProfile as ScopedRef,
            widthMm: editingWindow.widthMm,
            heightMm: editingWindow.heightMm,
            quantity: editingWindow.quantity,
            hasFlyScreen: editingWindow.hasFlyScreen,
            isDoor: editingWindow.isDoor,
            openingType: editingWindow.openingType,
            glassKind: editingWindow.glassKind,
            glass: editingWindow.glass as ScopedRef,
            interiorColor: editingWindow.interiorColor as ScopedRef | null,
            exteriorColor: editingWindow.exteriorColor as ScopedRef | null,
            location: editingWindow.location,
            notes: editingWindow.notes,
          }
        : emptyWindow(projectId, project?.favoriteFrameProfile ?? null),
    )
  }, [open, isEdit, editingWindow, reset, projectId, project?.favoriteFrameProfile])

  const frameProfile = watch('frameProfile')
  const sashProfile = watch('sashProfile')
  const widthMm = watch('widthMm')
  const heightMm = watch('heightMm')
  const quantity = watch('quantity')
  const hasFlyScreen = watch('hasFlyScreen')
  const isDoor = watch('isDoor')
  const openingType = watch('openingType') ?? null
  const glassKind = watch('glassKind')
  const glass = watch('glass')
  const interiorColor = watch('interiorColor')
  const exteriorColor = watch('exteriorColor')

  const frame = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === frameProfile)
  const frameCatalog = catalogsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === frame?.catalog)
  const sash = profilesQuery.data?.find((p) => formatScopedRef(p.scope, p.id) === sashProfile)

  // The frame's own catalogue is a hinged system — door only means
  // something there. Force it off if the frame changes to a non-hinged
  // (or no) catalogue rather than leave a stale true hidden.
  const systemType = frameCatalog?.systemType ?? null
  const showDoor = systemType === 'hinged'
  // Same "hinged only" gate as showDoor — the Type icon grid (and the
  // structural double-door/mullion geometry it can drive) only makes
  // sense there; sliding gets its own icon set later, not this one.
  const showOpeningTypes = showDoor
  useEffect(() => {
    if (!showDoor && isDoor) setValue('isDoor', false, { shouldValidate: true })
  }, [showDoor, isDoor, setValue])
  useEffect(() => {
    if (!showOpeningTypes && openingType) setValue('openingType', null, { shouldValidate: true })
  }, [showOpeningTypes, openingType, setValue])

  // Same rule for fly screen — gated on the frame's own flag.
  const flyScreenAllowed = frame?.acceptsFlyScreen ?? false
  useEffect(() => {
    if (!flyScreenAllowed && hasFlyScreen) setValue('hasFlyScreen', false, { shouldValidate: true })
  }, [flyScreenAllowed, hasFlyScreen, setValue])

  const sashOptions = (profilesQuery.data ?? [])
    .filter((p) => p.profileType === ProfileType.LEAF && p.catalog === frame?.catalog)
    .sort((a, b) => a.profileNo.localeCompare(b.profileNo))

  const sashMaxGlassThickness = sash?.maxGlassThickness ?? null
  const maxGlassAllowed = sashMaxGlassThickness !== null ? sashMaxGlassThickness - BEAD_ALLOWANCE_MM : null

  const glassOptions = [
    ...(glassQuery.data ?? [])
      .filter((g) => maxGlassAllowed !== null && g.thickness <= maxGlassAllowed)
      .map((g) => ({
        value: `${GlassKind.SINGLE}|${formatScopedRef(g.scope, g.id)}`,
        label: `${g.name} — ${g.thickness} mm`,
        scope: g.scope,
      })),
    ...(combinationsQuery.data ?? [])
      .filter((c) => maxGlassAllowed !== null && c.totalThickness <= maxGlassAllowed)
      .map((c) => ({
        value: `${GlassKind.COMBINATION}|${formatScopedRef(c.scope, c.id)}`,
        label: `${c.name} — ${c.totalThickness} mm`,
        scope: c.scope,
      })),
  ]
  const glassValue = glass ? `${glassKind}|${glass}` : ''

  const colorOptions = (colorsQuery.data ?? []).map((c) => ({
    value: formatScopedRef(c.scope, c.id),
    label: c.code,
    hex: c.hex,
    scope: c.scope,
  }))

  const onSubmit = async (data: CreateWindowInput) => {
    try {
      if (isEdit) {
        const { projectId: _ignored, ...editable } = data
        await updateMutation.mutateAsync(editable)
        toast.success(t('windowDialog.updated'))
      } else {
        const created = await createMutation.mutateAsync(data)
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
  const dialogTitle = systemType
    ? t(isEdit ? 'windowDialog.editTitleTyped' : 'windowDialog.createTitleTyped', {
        type: tLookups(`systemType.${systemType}`).toLowerCase(),
      })
    : t(isEdit ? 'windowDialog.editTitle' : 'windowDialog.createTitle')

  // Favouriting a frame also updates the project's own catalogue/brand
  // defaults, not just favoriteFrameProfile — a favourite frame that
  // isn't the project's own default catalogue would otherwise leave the
  // tree's "preferred catalogue" expansion pointing at the wrong branch
  // every time this dialog opens next. `ref` is whichever profile was
  // right-clicked in the tree, not necessarily the one currently
  // selected on the form, so its catalogue/brand are looked up fresh
  // rather than reusing `frame`/`frameCatalog` above.
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

  // Shared by both steps' own tree instance (Step 1's persistent left
  // column and Step 2's, identical). Changing the frame invalidates the
  // sash (scoped to its catalogue) and, transitively, the glass (scoped
  // to the sash's max thickness) — same cascade rule
  // ProjectPreferencesFields uses for brand → catalogue.
  const onFrameChange = (ref: ScopedRef) => {
    setValue('frameProfile', ref, { shouldValidate: true })
    setValue('sashProfile', '' as ScopedRef, { shouldValidate: true })
    setValue('glass', '' as ScopedRef, { shouldValidate: true })
  }

  // Recomputed on every render (cheap, pure) rather than memoized —
  // both the drawing and the panel's per-part sizes need it, so it's
  // lifted here instead of built twice.
  const drawingLayout = buildWindowLayout({
    widthMm: Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 1000,
    heightMm: Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 1200,
    systemType,
    hasFlyScreen,
    flyScreenAllowed,
    isDoor,
    openingType,
  })
  // The weight estimate and the re-surfaced validation rules — see
  // docs/window_design_planing.md §1. `sashWeightKg` stays `null`
  // (no line shown) until there's an actual sash and glass to weigh.
  const currentGlass = glassKind === GlassKind.SINGLE ? glassQuery.data?.find((g) => formatScopedRef(g.scope, g.id) === glass) : undefined
  const currentCombination =
    glassKind === GlassKind.COMBINATION ? combinationsQuery.data?.find((c) => formatScopedRef(c.scope, c.id) === glass) : undefined
  // A plain single-pane glass has no colour field at all — only a
  // combination's sheets can reference a real Color (RAL code + hex),
  // the same shared table frame/sash colours use. Reflect whichever
  // sheet in the build-up has one set (first one found); a colourless
  // combination or a single glass falls back to WindowDrawing's own
  // neutral default tint.
  const coloredSheet = currentCombination?.items.find(
    (item) => item.kind === CombinationItemKind.SHEET && item.colorCode,
  )
  const glassHex = coloredSheet ? (colorOptions.find((c) => c.label === coloredSheet.colorCode)?.hex ?? null) : null
  // Georgian bars are a real physical grid embedded in the spacer gap,
  // not a decorative option — draw one whenever the build-up actually
  // has one. Takes the first Georgian gap found; a build-up with more
  // than one would be unusual and this is a reasonable default rather
  // than something worth a UI to disambiguate.
  let georgianGrid: { columns: number; rows: number } | null = null
  for (const item of currentCombination?.items ?? []) {
    if (item.kind === CombinationItemKind.GAP && item.isGeorgian && item.columnsCount && item.rowsCount) {
      georgianGrid = { columns: item.columnsCount, rows: item.rowsCount }
      break
    }
  }
  const glassWeightPerSqm = resolveGlassWeightPerSqm(glassKind, currentGlass, currentCombination, glassQuery.data ?? [])
  const firstSashRect = drawingLayout.parts.find((p) => p.kind === 'sash')?.rectMm
  const sashWeightKg =
    sash && (currentGlass ?? currentCombination) && firstSashRect
      ? computeSashWeightKg({ rectMm: firstSashRect, glassWeightPerSqm, sashProfile: sash })
      : null
  const maxSashWeight = frameCatalog?.maxSashWeight ?? null

  const sashPartIds = drawingLayout.parts.filter((p) => p.kind === 'sash').map((p) => p.id)
  const glassPartIds = drawingLayout.parts.filter((p) => p.kind === 'glass').map((p) => p.id)
  const flyScreenPartId = drawingLayout.parts.find((p) => p.kind === 'flyScreen')?.id ?? null

  // A brand-new window starts with every required field empty — showing
  // "Pick a sash profile." etc. before the user has touched anything
  // reads as the dialog already complaining. Editing an existing window
  // always shows its real issues (there's real data to be wrong about);
  // creating one stays quiet until the first submit attempt, same as
  // any other "don't yell before I've done anything" form.
  const showValidation = isEdit || isSubmitted

  const rawIssues = showValidation
    ? collectWindowIssues({
        frameProfile: frame,
        sashProfile: sash,
        hasGlass: !!glass,
        glassThickness: currentGlass?.thickness ?? currentCombination?.totalThickness ?? null,
        maxGlassAllowed,
        sashWeightKg,
        maxSashWeight,
        hasFlyScreen,
        flyScreenAllowed,
        sashPartIds,
        glassPartIds,
        flyScreenPartId,
      })
    : []
  const issuesByPart = new Map<string, TranslatedIssue[]>()
  for (const issue of rawIssues) {
    const translated: TranslatedIssue = {
      severity: issue.severity,
      messageKey: issue.messageKey,
      message: t(`windowDialog.design.issues.${issue.messageKey}`, issue.values),
    }
    issuesByPart.set(issue.partId, [...(issuesByPart.get(issue.partId) ?? []), translated])
  }
  // The strip below the drawing — one row per distinct message, not per
  // part (a sliding window's two sashes both missing a profile would
  // otherwise repeat "Pick a sash profile." twice).
  const stripIssues: { partId: string; severity: TranslatedIssue['severity']; message: string }[] = []
  const seenMessages = new Set<string>()
  for (const [partId, issues] of issuesByPart) {
    for (const issue of issues) {
      if (seenMessages.has(issue.message)) continue
      seenMessages.add(issue.message)
      stripIssues.push({ partId, ...issue })
    }
  }

  // The drawing borrows the other face's colour when only one is set —
  // a window is realistically painted the same on both sides more often
  // than not, so this saves re-picking it twice. Purely a rendering
  // fallback: the interior/exterior fields themselves stay exactly what
  // the user actually chose (one still shows its real placeholder), and
  // the moment they pick the other face's own colour this stops
  // applying — each face then shows only its own value.
  const shownFaceColor = drawingFace === 'interior' ? interiorColor : exteriorColor
  const otherFaceColor = drawingFace === 'interior' ? exteriorColor : interiorColor
  const drawingFaceColorRef = shownFaceColor ?? otherFaceColor

  // The toggle only matters when it would actually show something
  // different — both colours picked, and they don't resolve to the same
  // hex (two different colour entries can still be visually identical).
  const interiorHex = colorOptions.find((c) => c.value === interiorColor)?.hex ?? null
  const exteriorHex = colorOptions.find((c) => c.value === exteriorColor)?.hex ?? null
  const showFaceToggle = !!interiorColor && !!exteriorColor && interiorHex !== exteriorHex

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* FIXED height and width (not max-h/max-w) with a constant 2rem
          viewport margin on every side — an intrinsic/auto height up to
          a cap still resizes the whole centered box every time inner
          content changes height (a validation message appearing, a
          tree branch expanding), which reads as the dialog visibly
          jumping/flickering. Fixing both dimensions means only the
          inner scroll regions ever move, and Step 2's three columns
          (tree/drawing/panel) get the full available width to lay out
          in rather than being capped at some fraction of the screen. */}
      <DialogContent className="flex h-[calc(100svh-4rem)] flex-col sm:max-w-[calc(100vw-4rem)]">
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

          {/* A frame profile tree (22rem) + the drawing (1fr) + a
              fixed-width options column, so all three stay put and
              never reflow when a different part is selected, per
              docs/window_design_planing.md's decisions table. */}
          <div className="mt-6 grid min-h-0 flex-1 grid-cols-[22rem_1fr_26rem] gap-4 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-col border-e border-border ps-1 pe-3">
              <FieldLabel htmlFor="window-frame" required>
                {t('fields.frameProfile')}
              </FieldLabel>
              <div className="mt-1.5 min-h-0 min-w-0 flex-1">
                <ProfileTreePicker
                  profileType={ProfileType.FRAME}
                  value={frameProfile || null}
                  onChange={onFrameChange}
                  favoriteRef={project?.favoriteFrameProfile}
                  onSetFavorite={project ? onSetFavorite : undefined}
                  preferredCatalogRef={isEdit ? undefined : project?.defaultSystemCatalog}
                  preferredBrandRef={isEdit ? undefined : project?.defaultSystemBrand}
                />
              </div>
              {showValidation && errors.frameProfile && (
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
                  systemType={systemType}
                  hasFrame={!!frame}
                  isDoor={isDoor}
                  openingType={openingType}
                  glassHex={glassHex}
                  georgianGrid={georgianGrid}
                  frameHex={colorOptions.find((c) => c.value === drawingFaceColorRef)?.hex ?? null}
                  selectedPartId={selectedPartId}
                  hoveredPartId={hoveredPartId}
                  onSelect={setSelectedPartId}
                  onHover={setHoveredPartId}
                  widthMm={widthMm}
                  heightMm={heightMm}
                  onWidthChange={(mm) => setValue('widthMm', mm, { shouldValidate: true })}
                  onHeightChange={(mm) => setValue('heightMm', mm, { shouldValidate: true })}
                  widthLabel={t('fields.widthMm')}
                  heightLabel={t('fields.heightMm')}
                  issuesByPart={issuesByPart}
                />
              </div>
              {stripIssues.length > 0 && (
                <ul className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1.5 text-xs">
                  {stripIssues.map((issue) => (
                    <li key={issue.partId + issue.message}>
                      <button
                        type="button"
                        onClick={() => setSelectedPartId(issue.partId)}
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
                  ))}
                </ul>
              )}
            </div>

            <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-s border-border px-3 pe-0 pb-4">
              <WindowPartPanel
                layout={drawingLayout}
                selectedPartId={selectedPartId}
                issuesByPart={issuesByPart}
                name={watch('name')}
                onNameChange={(value) => setValue('name', value, { shouldValidate: true })}
                nameError={showValidation && errors.name ? t('fields.windowNameRequired') : undefined}
                quantity={quantity}
                onQuantityChange={(value) => setValue('quantity', value, { shouldValidate: true })}
                quantityError={showValidation && errors.quantity ? t('fields.quantityRequired') : undefined}
                widthMm={widthMm}
                heightMm={heightMm}
                onWidthChange={(mm) => setValue('widthMm', mm, { shouldValidate: true })}
                onHeightChange={(mm) => setValue('heightMm', mm, { shouldValidate: true })}
                widthError={showValidation && errors.widthMm ? t('fields.widthMmRequired') : undefined}
                heightError={showValidation && errors.heightMm ? t('fields.heightMmRequired') : undefined}
                interiorColor={interiorColor ?? null}
                exteriorColor={exteriorColor ?? null}
                onInteriorColorChange={(value) =>
                  setValue('interiorColor', value as ScopedRef | null, { shouldValidate: true })
                }
                onExteriorColorChange={(value) =>
                  setValue('exteriorColor', value as ScopedRef | null, { shouldValidate: true })
                }
                colorOptions={colorOptions}
                showDoor={showDoor}
                isDoor={isDoor}
                onDoorChange={(value) => setValue('isDoor', value, { shouldValidate: true })}
                showOpeningTypes={showOpeningTypes}
                openingType={openingType}
                onOpeningTypeChange={(value) => setValue('openingType', value, { shouldValidate: true })}
                sashProfile={sashProfile}
                sashOptions={sashOptions}
                onSashChange={(ref) => {
                  setValue('sashProfile', ref, { shouldValidate: true })
                  setValue('glass', '' as ScopedRef, { shouldValidate: true })
                }}
                sashWeightKg={sashWeightKg}
                maxSashWeight={maxSashWeight}
                glassValue={glassValue}
                glassOptions={glassOptions}
                onGlassChange={(kind, ref) => {
                  setValue('glassKind', kind, { shouldValidate: true })
                  setValue('glass', ref, { shouldValidate: true })
                }}
                maxGlassAllowed={maxGlassAllowed}
                sashMaxGlassThickness={sashMaxGlassThickness}
                hasFlyScreen={hasFlyScreen}
                flyScreenAllowed={flyScreenAllowed}
                onFlyScreenChange={(value) => setValue('hasFlyScreen', value, { shouldValidate: true })}
                location={watch('location') ?? null}
                onLocationChange={(value) => setValue('location', value, { shouldValidate: true })}
                notes={watch('notes') ?? null}
                onNotesChange={(value) => setValue('notes', value, { shouldValidate: true })}
              />
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
  )
}

function emptyWindow(projectId: string, favoriteFrameProfile?: string | null): CreateWindowInput {
  return {
    projectId,
    name: '',
    frameProfile: (favoriteFrameProfile ?? '') as ScopedRef,
    sashProfile: '' as ScopedRef,
    widthMm: NaN,
    heightMm: NaN,
    quantity: 1,
    hasFlyScreen: false,
    isDoor: false,
    openingType: null,
    glassKind: GlassKind.SINGLE,
    glass: '' as ScopedRef,
    interiorColor: null,
    exteriorColor: null,
    location: null,
    notes: null,
  }
}
