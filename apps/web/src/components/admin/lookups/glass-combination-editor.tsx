import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Copy, Plus, Search, Trash2 } from 'lucide-react'
import {
  createGlassCombinationSchema,
  GlassGapType,
  type CreateGlassCombinationInput,
  type GlassCombinationSummary,
} from '@repo/types/lookups'
import { apiErrorMessage } from '@/lib/api-client'
import * as lookupsApi from '@/lib/lookups-api'
import {
  useColorsQuery,
  useCreateGlassCombinationMutation,
  useDeleteGlassCombinationMutation,
  useGlassCombinationsQuery,
  useGlassQuery,
  useUpdateGlassCombinationMutation,
} from '@/lib/lookups-queries'
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
  | { kind: 'sheet'; glassId: string; colorId: string | null }
  | {
      kind: 'gap'
      gapType: GlassGapType
      gapThickness: number
      gapColorId: string | null
      isGeorgian: boolean
      columnsCount: number | null
      rowsCount: number | null
    }

// Human-readable build-up for the list table, e.g. "6mm Clear + Spacer
// (air gap) 12mm + 6mm Clear" — derived straight from the combination's
// own items rather than duplicating that shape in a separate field.
// Deliberately shows thickness + colour, not the glass catalogue name —
// name is a free-text label (e.g. "Clear 6mm" or a supplier SKU) that
// doesn't reliably tell you what's actually installed at a glance.
function describeCombination(combo: GlassCombinationSummary, t: (key: string) => string): string {
  return combo.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => {
      if (item.kind === 'sheet') {
        const colorLabel = item.colorCode ?? t('dataWarehousePage.combinationEditor.clear')
        return `${item.glassThickness}mm ${colorLabel}`
      }
      // Laminated interlayers don't track a thickness (stored as 0, not
      // shown in the editor) so it's left out of the description too —
      // "Laminated (interlayer) 0mm" would misleadingly imply a real value.
      if (item.gapType === GlassGapType.LAMINATED) {
        return t('dataWarehousePage.combinationEditor.gapTypeLaminated')
      }
      const georgianSuffix = item.isGeorgian
        ? ` · ${t('dataWarehousePage.combinationEditor.isGeorgian')} ${item.columnsCount ?? ''}×${item.rowsCount ?? ''}`
        : ''
      return `${t('dataWarehousePage.combinationEditor.gapTypeSpacer')} ${item.gapThickness}mm${georgianSuffix}`
    })
    .join(' + ')
}

function fromSummary(combo: GlassCombinationSummary): DraftItem[] {
  return combo.items.map((item) =>
    item.kind === 'sheet'
      ? { kind: 'sheet', glassId: item.glassId, colorId: item.colorId }
      : {
          kind: 'gap',
          gapType: item.gapType,
          gapThickness: item.gapThickness,
          gapColorId: item.gapColorId,
          isGeorgian: item.isGeorgian ?? false,
          columnsCount: item.columnsCount,
          rowsCount: item.rowsCount,
        },
  )
}

export function GlassCombinationSection() {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const { data: combos, isLoading, isError } = useGlassCombinationsQuery()
  const { data: glassList } = useGlassQuery()
  const { data: colors } = useColorsQuery()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<GlassCombinationSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GlassCombinationSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const createMutation = useCreateGlassCombinationMutation()
  const updateMutation = useUpdateGlassCombinationMutation(editTarget?.id ?? '')
  const deleteMutation = useDeleteGlassCombinationMutation(deleteTarget?.id ?? '')

  const glassOptions = (glassList ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.thickness}mm)` }))
  const colorOptions = (colors ?? []).map((c) => ({ value: c.id, label: c.code }))

  const rows = combos ?? []
  // Matches on name and the same build-up text the table shows, so
  // searching "clear" or "spacer" finds combinations by what's in them,
  // not just by name.
  const trimmedQuery = searchQuery.trim().toLowerCase()
  const visibleRows = trimmedQuery
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(trimmedQuery) ||
          describeCombination(row, t).toLowerCase().includes(trimmedQuery),
      )
    : rows
  const allSelected = visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.id))
  const someSelected = selected.size > 0
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleRows.map((row) => row.id)))
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onDelete = async () => {
    try {
      await deleteMutation.mutateAsync()
      toast.success(t('dataWarehousePage.messages.deleteSuccess'))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    }
  }

  const onBulkDelete = async () => {
    const ids = [...selected]
    setBulkDeleteConfirmOpen(false)
    setBulkBusy(true)
    try {
      const { deletedIds } = await lookupsApi.bulkDeleteGlassCombinations(ids)
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      toast.success(t('dataWarehousePage.messages.bulkDeleteSuccess', { count: deletedIds.length }))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  const onBulkDuplicate = async () => {
    const targets = rows.filter((row) => selected.has(row.id))
    setBulkBusy(true)
    try {
      const created = await lookupsApi.bulkDuplicateGlassCombinations(
        targets.map((combo) => ({
          name: `${combo.name} ${t('dataWarehousePage.bulk.copySuffix')}`,
          items: combo.items.map((item) =>
            item.kind === 'sheet'
              ? { kind: 'sheet' as const, glassId: item.glassId, colorId: item.colorId }
              : {
                  kind: 'gap' as const,
                  gapType: item.gapType,
                  gapThickness: item.gapThickness,
                  gapColorId: item.gapColorId,
                  isGeorgian: item.isGeorgian,
                  columnsCount: item.columnsCount,
                  rowsCount: item.rowsCount,
                },
          ),
        })),
      )
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      if (created.failedCount > 0) {
        toast.error(
          t('dataWarehousePage.messages.bulkDuplicatePartial', {
            failed: created.failedCount,
            succeeded: created.created.length,
          }),
        )
      } else {
        toast.success(t('dataWarehousePage.messages.bulkDuplicateSuccess', { count: created.created.length }))
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {t('dataWarehousePage.tables.glassCombinations')}
        </h2>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t('dataWarehousePage.combinationEditor.createButton')}
        </Button>
      </div>

      <div className="relative w-full max-w-xs">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('dataWarehousePage.search.glassCombinations')}
          className="ps-8"
        />
      </div>

      {someSelected && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2">
          <span className="text-sm font-medium text-foreground">
            {t('dataWarehousePage.bulk.selectedCount', { count: selected.size })}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void onBulkDuplicate()}>
              <Copy className="size-4" aria-hidden="true" />
              {t('dataWarehousePage.bulk.duplicate')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={bulkBusy}
              onClick={() => setBulkDeleteConfirmOpen(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('dataWarehousePage.bulk.delete')}
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              {t('dataWarehousePage.bulk.clear')}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {visibleRows.length > 0 && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label={t('dataWarehousePage.bulk.selectAll')}
                  />
                )}
              </TableHead>
              <TableHead>{t('dataWarehousePage.combinationEditor.name')}</TableHead>
              <TableHead>{t('dataWarehousePage.combinationEditor.totalThickness')}</TableHead>
              <TableHead>{t('dataWarehousePage.combinationEditor.items')}</TableHead>
              <TableHead>{t('dataWarehousePage.combinationEditor.buildUp')}</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(isLoading || isError || rows.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className={isError ? 'text-center text-destructive' : 'text-center text-muted-foreground'}
                >
                  {isError ? t('dataWarehousePage.messages.error') : t('dataWarehousePage.combinationEditor.empty')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && rows.length > 0 && visibleRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t('dataWarehousePage.messages.noResults')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              visibleRows.map((combo) => (
                <TableRow key={combo.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(combo.id)}
                      onCheckedChange={() => toggleOne(combo.id)}
                      aria-label={combo.name}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{combo.name}</TableCell>
                  <TableCell>{combo.totalThickness} mm</TableCell>
                  <TableCell>{combo.items.length}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground" title={describeCombination(combo, t)}>
                    {describeCombination(combo, t)}
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditTarget(combo)}>
                      {t('dataWarehousePage.combinationEditor.editButton')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(combo)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {createOpen && (
        <CombinationDialog
          title={t('dataWarehousePage.combinationEditor.createButton')}
          initialName=""
          initialItems={[]}
          glassOptions={glassOptions}
          colorOptions={colorOptions}
          glassList={glassList ?? []}
          onClose={() => setCreateOpen(false)}
          onSave={async (values) => {
            await createMutation.mutateAsync(values)
            toast.success(t('dataWarehousePage.messages.createSuccess'))
            setCreateOpen(false)
          }}
        />
      )}

      {editTarget && (
        <CombinationDialog
          title={editTarget.name}
          initialName={editTarget.name}
          initialItems={fromSummary(editTarget)}
          glassOptions={glassOptions}
          colorOptions={colorOptions}
          glassList={glassList ?? []}
          onClose={() => setEditTarget(null)}
          onSave={async (values) => {
            await updateMutation.mutateAsync(values)
            toast.success(t('dataWarehousePage.messages.updateSuccess'))
            setEditTarget(null)
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget
                ? t('dataWarehousePage.messages.deleteConfirmTitle', { name: deleteTarget.name })
                : ''}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={() => void onDelete()}>
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('dataWarehousePage.bulk.deleteConfirmTitle', { count: selected.size })}
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
  glassList,
  onClose,
  onSave,
}: {
  title: string
  initialName: string
  initialItems: DraftItem[]
  glassOptions: { value: string; label: string }[]
  colorOptions: { value: string; label: string }[]
  glassList: { id: string; thickness: number }[]
  onClose: () => void
  onSave: (values: CreateGlassCombinationInput) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [name, setName] = useState(initialName)
  const [items, setItems] = useState<DraftItem[]>(initialItems)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const glassThickness = (id: string) => glassList.find((g) => g.id === id)?.thickness ?? 0
  const runningTotal = items
    .reduce((sum, item) => sum + (item.kind === 'sheet' ? glassThickness(item.glassId) : item.gapThickness), 0)
    .toFixed(2)
  // A combination must strictly alternate sheet/gap (enforced for real by
  // createGlassCombinationSchema's alternation refine at save time — this
  // is just the add-button guard that stops the obvious mistake at entry).
  const lastItemKind = items[items.length - 1]?.kind

  const addSheet = () => setItems((prev) => [...prev, { kind: 'sheet', glassId: '', colorId: null }])
  const addGap = () =>
    setItems((prev) => [
      ...prev,
      {
        kind: 'gap',
        gapType: GlassGapType.SPACER,
        gapThickness: 16,
        gapColorId: null,
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
    const parsed = createGlassCombinationSchema.safeParse({
      name,
      items: items.map((item) =>
        item.kind === 'sheet'
          ? { kind: 'sheet', glassId: item.glassId, colorId: item.colorId }
          : {
              kind: 'gap',
              gapType: item.gapType,
              gapThickness: item.gapThickness,
              gapColorId: item.gapColorId,
              isGeorgian: item.gapType === GlassGapType.SPACER ? item.isGeorgian : null,
              columnsCount: item.gapType === GlassGapType.SPACER ? item.columnsCount : null,
              rowsCount: item.gapType === GlassGapType.SPACER ? item.rowsCount : null,
            },
      ),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('dataWarehousePage.messages.error'))
      return
    }
    setSaving(true)
    try {
      await onSave(parsed.data)
    } catch (err) {
      setError(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('dataWarehousePage.combinationEditor.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="combination-name">{t('dataWarehousePage.combinationEditor.name')}</Label>
            <Input
              id="combination-name"
              className="mt-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>{t('dataWarehousePage.combinationEditor.items')}</Label>
            <span className="text-sm font-medium text-foreground">
              {t('dataWarehousePage.combinationEditor.runningTotal', { total: runningTotal })}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('dataWarehousePage.combinationEditor.noItems')}</p>
            )}
            {items.length === 1 && (
              <p className="text-sm text-muted-foreground">{t('dataWarehousePage.combinationEditor.singleLayerHint')}</p>
            )}
            {items.map((item, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {index + 1}. {item.kind === 'sheet' ? t('dataWarehousePage.combinationEditor.kindSheet') : t('dataWarehousePage.combinationEditor.kindGap')}
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
                    <Select value={item.glassId} onValueChange={(v) => updateItem(index, { glassId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('dataWarehousePage.combinationEditor.selectGlass')} />
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
                      value={item.colorId ?? '__none'}
                      onValueChange={(v) => updateItem(index, { colorId: v === '__none' ? null : v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('dataWarehousePage.combinationEditor.selectColorOptional')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('dataWarehousePage.combinationEditor.noColor')}</SelectItem>
                        {colorOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
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
                            {t('dataWarehousePage.combinationEditor.gapTypeSpacer')}
                          </SelectItem>
                          <SelectItem value={GlassGapType.LAMINATED}>
                            {t('dataWarehousePage.combinationEditor.gapTypeLaminated')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {item.gapType === GlassGapType.SPACER && (
                        <Input
                          type="number"
                          step={0.01}
                          min={0}
                          value={item.gapThickness}
                          placeholder={t('dataWarehousePage.combinationEditor.gapThickness')}
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
                          {t('dataWarehousePage.combinationEditor.isGeorgian')}
                        </label>
                        {item.isGeorgian && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min={1}
                              placeholder={t('dataWarehousePage.combinationEditor.columns')}
                              value={item.columnsCount ?? ''}
                              onChange={(e) => updateItem(index, { columnsCount: Number(e.target.value) })}
                            />
                            <Input
                              type="number"
                              min={1}
                              placeholder={t('dataWarehousePage.combinationEditor.rows')}
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
              title={lastItemKind === 'sheet' ? t('dataWarehousePage.combinationEditor.addSheetDisabled') : undefined}
              onClick={addSheet}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('dataWarehousePage.combinationEditor.addSheet')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={lastItemKind === 'gap' || lastItemKind === undefined}
              title={
                lastItemKind === 'gap' || lastItemKind === undefined
                  ? t('dataWarehousePage.combinationEditor.addGapDisabled')
                  : undefined
              }
              onClick={addGap}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('dataWarehousePage.combinationEditor.addGap')}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" disabled={saving || items.length < 3 || !name.trim()} onClick={() => void handleSave()}>
            {t('dataWarehousePage.combinationEditor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
