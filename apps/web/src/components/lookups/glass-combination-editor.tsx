import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import {
  CombinationItemKind,
  GlassGapType,
  type CreateGlassCombinationInput,
} from '@repo/types/lookups'
import {
  LookupScope,
  createCompanyGlassCombinationSchema,
  formatScopedRef,
  parseScopedRef,
  type CreateCompanyGlassCombinationInput,
  type ScopedRef,
} from '@repo/types/company-lookups'
import { apiErrorMessage } from '@/lib/api-client'
import * as lookupsApi from '@/lib/lookups-api'
import * as companyLookupsApi from '@/lib/company-lookups-api'
import {
  useColorsQuery,
  useCreateGlassCombinationMutation,
  useDeleteGlassCombinationMutation,
  useGlassCombinationsQuery,
  useGlassQuery,
  useUpdateGlassCombinationMutation,
} from '@/lib/lookups-queries'
import {
  useCreateCompanyGlassCombinationMutation,
  useDeleteCompanyGlassCombinationMutation,
  useUpdateCompanyGlassCombinationMutation,
} from '@/lib/company-lookups-queries'
import {
  platformComboToMerged,
  type MergedGlassCombinationItemSummary,
  type MergedGlassCombinationSummary,
} from '@/lib/lookup-merge'
import type { LookupRowScope } from './lookup-table-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type DraftItem =
  | { kind: 'sheet'; glass: ScopedRef | ''; color: ScopedRef | null }
  | {
      kind: 'gap'
      gapType: GlassGapType
      gapThickness: number
      gapColor: ScopedRef | null
      isGeorgian: boolean
      columnsCount: number | null
      rowsCount: number | null
    }

// Every reference (glass sheet, sheet colour, gap colour) is a ScopedRef
// string internally — the same "platform:<uuid>" / "company:<uuid>"
// encoding lookup-merge.ts's summaries already use — so the dialog and
// its save-time validation (createCompanyGlassCombinationSchema) are one
// code path for both consoles. The admin console never has a
// company-owned glass/colour to reference, but wrapping its
// platform-only rows in the same shape (platformComboToMerged, imported
// from lookup-merge.ts) means it doesn't need a second implementation
// — `toAdminInput` below is the only place the two consoles' wire
// formats actually diverge, right at the mutation boundary.
function describeCombination(combo: MergedGlassCombinationSummary, t: (key: string) => string): string {
  return combo.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => {
      if (item.kind === CombinationItemKind.SHEET) {
        const colorLabel = item.colorCode ?? t('combinationEditor.clear')
        return `${item.glassThickness}mm ${colorLabel}`
      }
      if (item.gapType === GlassGapType.LAMINATED) {
        return t('combinationEditor.gapTypeLaminated')
      }
      const georgianSuffix = item.isGeorgian
        ? ` · ${t('combinationEditor.isGeorgian')} ${item.columnsCount ?? ''}×${item.rowsCount ?? ''}`
        : ''
      return `${t('combinationEditor.gapTypeSpacer')} ${item.gapThickness}mm${georgianSuffix}`
    })
    .join(' + ')
}

function fromSummary(items: MergedGlassCombinationItemSummary[]): DraftItem[] {
  return items.map((item) =>
    item.kind === CombinationItemKind.SHEET
      ? { kind: 'sheet', glass: item.glass, color: item.color }
      : {
          kind: 'gap',
          gapType: item.gapType,
          gapThickness: item.gapThickness,
          gapColor: item.gapColor,
          isGeorgian: item.isGeorgian ?? false,
          columnsCount: item.columnsCount,
          rowsCount: item.rowsCount,
        },
  )
}

// Translates the dialog's ScopedRef-based output down to the admin
// endpoint's plain-uuid shape — safe unconditionally, since every option
// the admin console ever offers is itself platform-scoped (there is no
// company data for a super admin to reference).
function toAdminItems(items: CreateCompanyGlassCombinationInput['items']): CreateGlassCombinationInput['items'] {
  return items.map((item) =>
    item.kind === CombinationItemKind.SHEET
      ? {
          kind: CombinationItemKind.SHEET,
          glassId: parseScopedRef(item.glass).id,
          colorId: item.color ? parseScopedRef(item.color).id : null,
        }
      : {
          kind: CombinationItemKind.GAP,
          gapType: item.gapType,
          gapThickness: item.gapThickness,
          gapColorId: item.gapColor ? parseScopedRef(item.gapColor).id : null,
          isGeorgian: item.isGeorgian ?? null,
          columnsCount: item.columnsCount ?? null,
          rowsCount: item.rowsCount ?? null,
        },
  )
}

function usePlatformGlassCombinationsQuery(): {
  data: MergedGlassCombinationSummary[] | undefined
  isLoading: boolean
  isError: boolean
} {
  const { data, isLoading, isError } = useGlassCombinationsQuery()
  const rows = useMemo(() => data?.map(platformComboToMerged), [data])
  return { data: rows, isLoading, isError }
}

// `useGlassList`/`useColorList` default to the admin-only hooks; their
// plain `{id,name,thickness}`/`{id,code}` rows have no `scope` field,
// which the option-builder below treats as `platform` — so the
// workspace override (lookup-merge.ts's useMergedGlassQuery/
// useMergedColorsQuery, whose rows DO carry `scope`) needs no separate
// code path either.
//
// `scoped` switches every mutation/bulk-action to the company-lookups
// endpoints and skips the admin translation step — the workspace Data
// page is the only caller that sets it.
export function GlassCombinationSection({
  useList = usePlatformGlassCombinationsQuery,
  useGlassList = useGlassQuery,
  useColorList = useColorsQuery,
  scoped = false,
  rowScope,
  canEdit,
  copyToScope,
}: {
  useList?: () => { data: MergedGlassCombinationSummary[] | undefined; isLoading: boolean; isError: boolean }
  useGlassList?: () => { data: { id: string; name: string; thickness: number; scope?: LookupRowScope }[] | undefined }
  useColorList?: () => { data: { id: string; code: string; hex: string; scope?: LookupRowScope }[] | undefined }
  scoped?: boolean
  rowScope?: (row: MergedGlassCombinationSummary) => LookupRowScope
  canEdit?: (row: MergedGlassCombinationSummary) => boolean
  copyToScope?: { label: string }
} = {}) {
  const { t } = useTranslation('lookups')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const { data: combos, isLoading, isError } = useList()
  const { data: glassList } = useGlassList()
  const { data: colors } = useColorList()
  const rowIsEditable = (row: MergedGlassCombinationSummary) => (canEdit ? canEdit(row) : true)

  const [createOpen, setCreateOpen] = useState(false)
  const [copySeed, setCopySeed] = useState<{ name: string; items: DraftItem[] } | null>(null)
  const [editTarget, setEditTarget] = useState<MergedGlassCombinationSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MergedGlassCombinationSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const adminCreate = useCreateGlassCombinationMutation()
  const companyCreate = useCreateCompanyGlassCombinationMutation()
  const adminUpdate = useUpdateGlassCombinationMutation(editTarget?.id ?? '')
  const companyUpdate = useUpdateCompanyGlassCombinationMutation(editTarget?.id ?? '')
  const adminDelete = useDeleteGlassCombinationMutation(deleteTarget?.id ?? '')
  const companyDelete = useDeleteCompanyGlassCombinationMutation(deleteTarget?.id ?? '')

  const glassOptions = (glassList ?? []).map((g) => ({
    value: formatScopedRef(g.scope ?? LookupScope.PLATFORM, g.id),
    label:
      g.scope === LookupScope.COMPANY
        ? `${g.name} (${g.thickness}mm) · ${t('scope.ours')}`
        : `${g.name} (${g.thickness}mm)`,
  }))
  const colorOptions = (colors ?? []).map((c) => ({
    value: formatScopedRef(c.scope ?? LookupScope.PLATFORM, c.id),
    label: c.scope === LookupScope.COMPANY ? `${c.code} · ${t('scope.ours')}` : c.code,
    hex: c.hex,
  }))
  const glassThicknessByRef = (ref: ScopedRef) => {
    const { id } = parseScopedRef(ref)
    return (glassList ?? []).find((g) => g.id === id)?.thickness ?? 0
  }

  const rows = combos ?? []
  const trimmedQuery = searchQuery.trim().toLowerCase()
  const visibleRows = trimmedQuery
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(trimmedQuery) ||
          describeCombination(row, t).toLowerCase().includes(trimmedQuery),
      )
    : rows
  const selectableVisibleRows = visibleRows.filter(rowIsEditable)
  const allSelected = selectableVisibleRows.length > 0 && selectableVisibleRows.every((row) => selected.has(row.id))
  const someSelected = selected.size > 0
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableVisibleRows.map((row) => row.id)))
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onDelete = async () => {
    try {
      if (scoped) await companyDelete.mutateAsync()
      else await adminDelete.mutateAsync()
      toast.success(t('messages.deleteSuccess'))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('messages.error')))
    }
  }

  const onBulkDelete = async () => {
    const ids = [...selected]
    setBulkDeleteConfirmOpen(false)
    setBulkBusy(true)
    try {
      const { deletedIds } = scoped
        ? await companyLookupsApi.bulkDeleteCompanyGlassCombinations(ids)
        : await lookupsApi.bulkDeleteGlassCombinations(ids)
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      if (scoped) await queryClient.invalidateQueries({ queryKey: ['company-lookups'] })
      toast.success(t('messages.bulkDeleteSuccess', { count: deletedIds.length }))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('messages.error')))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  const duplicateRows = async (targets: MergedGlassCombinationSummary[]) => {
    const named = targets.map((combo) => ({ name: `${combo.name} ${t('bulk.copySuffix')}`, items: combo.items }))
    const { created, failedCount } = scoped
      ? await companyLookupsApi.bulkDuplicateCompanyGlassCombinations(named)
      : await lookupsApi.bulkDuplicateGlassCombinations(
          named.map((combo) => ({ name: combo.name, items: toAdminItems(combo.items) })),
        )
    await queryClient.invalidateQueries({ queryKey: ['lookups'] })
    if (scoped) await queryClient.invalidateQueries({ queryKey: ['company-lookups'] })
    if (failedCount > 0) {
      toast.error(t('messages.bulkDuplicatePartial', { failed: failedCount, succeeded: created.length }))
    } else {
      toast.success(t('messages.bulkDuplicateSuccess', { count: created.length }))
    }
  }

  const onBulkDuplicate = async () => {
    const targets = rows.filter((row) => selected.has(row.id))
    setBulkBusy(true)
    try {
      await duplicateRows(targets)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('messages.error')))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  const onDuplicateRow = async (combo: MergedGlassCombinationSummary) => {
    try {
      await duplicateRows([combo])
    } catch (err) {
      toast.error(apiErrorMessage(err, t('messages.error')))
    }
  }

  const onCopyToScope = (row: MergedGlassCombinationSummary) => {
    if (!copyToScope) return
    setCopySeed({ name: `${row.name} ${t('bulk.copySuffix')}`, items: fromSummary(row.items) })
    setCreateOpen(true)
  }

  const onSaveCreate = async (values: CreateCompanyGlassCombinationInput) => {
    if (scoped) await companyCreate.mutateAsync(values)
    else await adminCreate.mutateAsync({ name: values.name, items: toAdminItems(values.items) })
  }
  const onSaveEdit = async (values: CreateCompanyGlassCombinationInput) => {
    if (scoped) await companyUpdate.mutateAsync(values)
    else await adminUpdate.mutateAsync({ name: values.name, items: toAdminItems(values.items) })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {t('tables.glassCombinations')}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCopySeed(null)
            setCreateOpen(true)
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('combinationEditor.createButton')}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search.glassCombinations')}
            className="ps-8"
          />
        </div>

        {someSelected && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/60 px-3 py-0.5">
            <span className="text-sm font-medium text-foreground">
              {t('bulk.selectedCount', { count: selected.size })}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void onBulkDuplicate()}>
                <Copy className="size-4" aria-hidden="true" />
                {t('bulk.duplicate')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={bulkBusy}
                onClick={() => setBulkDeleteConfirmOpen(true)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t('bulk.delete')}
              </Button>
              <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
                {t('bulk.clear')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-10">
              {selectableVisibleRows.length > 0 && (
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t('bulk.selectAll')} />
              )}
            </TableHead>
            <TableHead>{t('combinationEditor.name')}</TableHead>
            <TableHead>{t('combinationEditor.totalThickness')}</TableHead>
            <TableHead>{t('combinationEditor.items')}</TableHead>
            <TableHead>{t('combinationEditor.buildUp')}</TableHead>
            {rowScope && <TableHead className="w-24">{t('scope.columnHeader')}</TableHead>}
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(isLoading || isError || rows.length === 0) && (
            <TableRow>
              <TableCell
                colSpan={5 + (rowScope ? 1 : 0) + 1}
                className={isError ? 'text-center text-destructive' : 'text-center text-muted-foreground'}
              >
                {isError ? t('messages.error') : t('combinationEditor.empty')}
              </TableCell>
            </TableRow>
          )}
          {!isLoading && !isError && rows.length > 0 && visibleRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5 + (rowScope ? 1 : 0) + 1} className="text-center text-muted-foreground">
                {t('messages.noResults')}
              </TableCell>
            </TableRow>
          )}
          {!isLoading &&
            !isError &&
            visibleRows.map((combo) => {
              const editable = rowIsEditable(combo)
              return (
              <TableRow key={combo.id}>
                <TableCell>
                  {editable && (
                    <Checkbox
                      checked={selected.has(combo.id)}
                      onCheckedChange={() => toggleOne(combo.id)}
                      aria-label={combo.name}
                    />
                  )}
                </TableCell>
                <TableCell className="font-medium text-foreground">{combo.name}</TableCell>
                <TableCell>{combo.totalThickness}</TableCell>
                <TableCell>{combo.items.length}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground" title={describeCombination(combo, t)}>
                  {describeCombination(combo, t)}
                </TableCell>
                {rowScope && (
                  <TableCell>
                    <span
                      className={
                        rowScope(combo) === 'company'
                          ? 'rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                      }
                    >
                      {rowScope(combo) === 'company' ? t('scope.ours') : t('scope.platform')}
                    </span>
                  </TableCell>
                )}
                <TableCell className="flex justify-end gap-2">
                  {editable ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title={t('combinationEditor.editButton')}
                        onClick={() => setEditTarget(combo)}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title={t('bulk.duplicate')}
                        onClick={() => void onDuplicateRow(combo)}
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(combo)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    copyToScope && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title={copyToScope.label}
                        onClick={() => onCopyToScope(combo)}
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </Button>
                    )
                  )}
                </TableCell>
              </TableRow>
              )
            })}
        </TableBody>
      </Table>

      {createOpen && (
        <CombinationDialog
          title={t('combinationEditor.createButton')}
          initialName={copySeed?.name ?? ''}
          initialItems={copySeed?.items ?? []}
          glassOptions={glassOptions}
          colorOptions={colorOptions}
          glassThicknessByRef={glassThicknessByRef}
          onClose={() => {
            setCreateOpen(false)
            setCopySeed(null)
          }}
          onSave={async (values) => {
            await onSaveCreate(values)
            toast.success(t('messages.createSuccess'))
            setCreateOpen(false)
            setCopySeed(null)
          }}
        />
      )}

      {editTarget && (
        <CombinationDialog
          title={editTarget.name}
          initialName={editTarget.name}
          initialItems={fromSummary(editTarget.items)}
          glassOptions={glassOptions}
          colorOptions={colorOptions}
          glassThicknessByRef={glassThicknessByRef}
          onClose={() => setEditTarget(null)}
          onSave={async (values) => {
            await onSaveEdit(values)
            toast.success(t('messages.updateSuccess'))
            setEditTarget(null)
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget
                ? t('messages.deleteConfirmTitle', { name: deleteTarget.name })
                : ''}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={scoped ? companyDelete.isPending : adminDelete.isPending}
              onClick={() => void onDelete()}
            >
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('bulk.deleteConfirmTitle', { count: selected.size })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={bulkBusy} onClick={() => void onBulkDelete()}>
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CombinationDialog({
  title,
  initialName,
  initialItems,
  glassOptions,
  colorOptions,
  glassThicknessByRef,
  onClose,
  onSave,
}: {
  title: string
  initialName: string
  initialItems: DraftItem[]
  glassOptions: { value: string; label: string }[]
  colorOptions: { value: string; label: string; hex: string }[]
  glassThicknessByRef: (ref: ScopedRef) => number
  onClose: () => void
  onSave: (values: CreateCompanyGlassCombinationInput) => Promise<void>
}) {
  const { t } = useTranslation('lookups')
  const [name, setName] = useState(initialName)
  const [items, setItems] = useState<DraftItem[]>(initialItems)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const runningTotal = items
    .reduce((sum, item) => sum + (item.kind === 'sheet' ? (item.glass ? glassThicknessByRef(item.glass) : 0) : item.gapThickness), 0)
    .toFixed(2)
  // A combination must strictly alternate sheet/gap (enforced for real by
  // createCompanyGlassCombinationSchema's alternation refine at save time
  // — this is just the add-button guard that stops the obvious mistake at
  // entry).
  const lastItemKind = items[items.length - 1]?.kind

  const addSheet = () => setItems((prev) => [...prev, { kind: 'sheet', glass: '', color: null }])
  const addGap = () =>
    setItems((prev) => [
      ...prev,
      {
        kind: 'gap',
        gapType: GlassGapType.SPACER,
        gapThickness: 16,
        gapColor: null,
        isGeorgian: false,
        columnsCount: null,
        rowsCount: null,
      },
    ])
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index))
  const moveItem = (index: number, direction: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  const updateItem = (index: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? ({ ...item, ...patch } as DraftItem) : item)))

  const handleSave = async () => {
    setError(null)
    const parsed = createCompanyGlassCombinationSchema.safeParse({
      name,
      items: items.map((item) =>
        item.kind === 'sheet'
          ? { kind: CombinationItemKind.SHEET, glass: item.glass, color: item.color }
          : {
              kind: CombinationItemKind.GAP,
              gapType: item.gapType,
              gapThickness: item.gapThickness,
              gapColor: item.gapColor,
              isGeorgian: item.gapType === GlassGapType.SPACER ? item.isGeorgian : null,
              columnsCount: item.gapType === GlassGapType.SPACER ? item.columnsCount : null,
              rowsCount: item.gapType === GlassGapType.SPACER ? item.rowsCount : null,
            },
      ),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('messages.error'))
      return
    }
    setSaving(true)
    try {
      await onSave(parsed.data)
    } catch (err) {
      setError(apiErrorMessage(err, t('messages.error')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('combinationEditor.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="combination-name">{t('combinationEditor.name')}</Label>
            <Input
              id="combination-name"
              className="mt-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>{t('combinationEditor.items')}</Label>
            <span className="text-sm font-medium text-foreground">
              {t('combinationEditor.runningTotal', { total: runningTotal })}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('combinationEditor.noItems')}</p>
            )}
            {items.length === 1 && (
              <p className="text-sm text-muted-foreground">{t('combinationEditor.singleLayerHint')}</p>
            )}
            {items.map((item, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {index + 1}. {item.kind === 'sheet' ? t('combinationEditor.kindSheet') : t('combinationEditor.kindGap')}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={index === items.length - 1}
                      onClick={() => moveItem(index, 1)}
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => removeItem(index)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {item.kind === 'sheet' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={item.glass} onValueChange={(v) => updateItem(index, { glass: v as ScopedRef })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('combinationEditor.selectGlass')} />
                      </SelectTrigger>
                      <SelectContent>
                        {glassOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={item.color ?? '__none'}
                      onValueChange={(v) => updateItem(index, { color: v === '__none' ? null : (v as ScopedRef) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('combinationEditor.selectColorOptional')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('combinationEditor.noColor')}</SelectItem>
                        {colorOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <span className="flex items-center gap-1.5">
                              <span
                                className="size-3 shrink-0 rounded-sm border border-border"
                                style={{ backgroundColor: opt.hex }}
                                aria-hidden="true"
                              />
                              {opt.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className={item.gapType === GlassGapType.SPACER ? 'grid grid-cols-2 gap-2' : ''}>
                      <Select
                        value={item.gapType}
                        onValueChange={(v) => {
                          const nextType = v as GlassGapType
                          updateItem(index, {
                            gapType: nextType,
                            // Laminated doesn't track a thickness (the field
                            // disappears below) — always store 0 for it, and
                            // restore a sensible default when switching back
                            // to spacer, since 0 there would silently zero
                            // the build-up.
                            gapThickness: nextType === GlassGapType.LAMINATED ? 0 : item.gapThickness || 16,
                          })
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={GlassGapType.SPACER}>
                            {t('combinationEditor.gapTypeSpacer')}
                          </SelectItem>
                          <SelectItem value={GlassGapType.LAMINATED}>
                            {t('combinationEditor.gapTypeLaminated')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {item.gapType === GlassGapType.SPACER && (
                        <Input
                          type="number"
                          step={0.01}
                          min={0}
                          value={item.gapThickness}
                          placeholder={t('combinationEditor.gapThickness')}
                          onChange={(e) => updateItem(index, { gapThickness: Number(e.target.value) })}
                        />
                      )}
                    </div>
                    {item.gapType === GlassGapType.SPACER && (
                      <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={item.isGeorgian}
                            onCheckedChange={(checked) => updateItem(index, { isGeorgian: !!checked })}
                          />
                          {t('combinationEditor.isGeorgian')}
                        </label>
                        {item.isGeorgian && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min={1}
                              placeholder={t('combinationEditor.columns')}
                              value={item.columnsCount ?? ''}
                              onChange={(e) => updateItem(index, { columnsCount: Number(e.target.value) })}
                            />
                            <Input
                              type="number"
                              min={1}
                              placeholder={t('combinationEditor.rows')}
                              value={item.rowsCount ?? ''}
                              onChange={(e) => updateItem(index, { rowsCount: Number(e.target.value) })}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={lastItemKind === 'sheet'}
              title={lastItemKind === 'sheet' ? t('combinationEditor.addSheetDisabled') : undefined}
              onClick={addSheet}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('combinationEditor.addSheet')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={lastItemKind === 'gap' || lastItemKind === undefined}
              title={
                lastItemKind === 'gap' || lastItemKind === undefined
                  ? t('combinationEditor.addGapDisabled')
                  : undefined
              }
              onClick={addGap}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('combinationEditor.addGap')}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" disabled={saving || items.length < 3 || !name.trim()} onClick={() => void handleSave()}>
            {t('combinationEditor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
