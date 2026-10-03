import { useEffect, useState } from 'react'
import {
  Controller,
  useForm,
  useWatch,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { ZodType } from 'zod'
import { apiErrorMessage } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { ScopeSummary, ScopeToggle, type ScopeFilterValue } from '@/components/lookups/scope-summary'

export interface LookupFieldSpec<TInput extends FieldValues> {
  name: Path<TInput>
  label: string
  type: 'text' | 'number' | 'select' | 'boolean'
  step?: number
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  /** Render only while this holds over the form's live values — for a
   * field that only means something given OTHER fields (a sliding
   * frame's rail count). A hidden field keeps whatever value it has;
   * the API is expected to normalise it, never the form. */
  visibleWhen?: (values: Partial<TInput>) => boolean
  /** With `visibleWhen`: the value to put in when the field comes into
   * view holding nothing (null/undefined/NaN) — so a row saved without
   * it doesn't reappear as an empty required input. */
  shownDefault?: TInput[Path<TInput>]
}

export interface LookupColumnSpec<TSummary> {
  header: string
  cell: (row: TSummary) => React.ReactNode
}

export interface LookupSearchSpec<TSummary> {
  placeholder: string
  match: (row: TSummary, query: string) => boolean
}

export interface LookupFilterSpec<TSummary> {
  key: string
  allLabel: string
  options: { value: string; label: string }[]
  match: (row: TSummary, value: string) => boolean
}

// A row's origin: the shared platform catalogue, or a row this company
// added itself. Only meaningful once a caller passes `rowScope` — the
// four admin tabs never do, since every row they show is platform-owned.
export type LookupRowScope = 'platform' | 'company'

interface MutationLike<TInput, TOutput> {
  mutateAsync: (input: TInput) => Promise<TOutput>
  isPending: boolean
}

// Config-driven CRUD block (table + create dialog + edit dialog + delete
// confirm + bulk select/duplicate/delete) shared by the lookup entities
// that are plain field-in/field-out forms (Glass, SystemBrand,
// SystemCatalog, SystemProfile). GlassCombination is the one entity that
// doesn't fit this shape — its item list needs a dedicated editor, not a
// form generated from a field list — Color gets its own grid
// presentation, and PaintBrand/PaintingPrice get a brand-grouped
// accordion (PaintingPricesSection) instead of this flat table.
//
// Shared by two consoles: the admin Data Warehouse (every row is
// platform-owned, every row is editable, `readOnly`/`rowScope`/
// `canEdit`/`copyToScope` are all left at their defaults) and the
// workspace Data section (platform rows read-only, this company's own
// rows editable, once Phase 2 wires `canEdit`/`rowScope`/`copyToScope`
// — Phase 1 only ever passes `readOnly`).
//
// Follows the one-dialog-instance-per-section pattern from
// UserActionDialog: a single edit/delete dialog is mounted once, driven
// by `editTarget`/`deleteTarget` state, with the mutation hook called
// as `useUpdate(editTarget?.id ?? '')` — always called (satisfying the
// rules of hooks), inert until a row is actually selected.
//
// Bulk actions deliberately bypass those single-target hooks — a
// `useDelete(id)` hook bound to one id at call time can't serve an
// arbitrary set of selected ids — and instead call the raw `bulkDelete`/
// `bulkDuplicate` api functions, each a single backend request (and a
// single DB statement, so the lookup version advances by exactly 1 —
// see ColorLookupsService.bulkDeleteColors), followed by one broad
// `['lookups']` cache invalidation.
export function LookupTableSection<
  TSummary extends { id: string },
  TCreate extends FieldValues,
  TUpdate extends FieldValues,
>({
  title,
  createLabel,
  emptyLabel,
  errorLabel,
  createSchema,
  updateSchema,
  createDefaults,
  fields,
  columns,
  search,
  filters,
  useList,
  useCreate,
  useUpdate,
  useDelete,
  bulkDelete,
  bulkDuplicate,
  duplicate,
  toEditDefaults,
  rowLabel,
  deleteWarning,
  headerExtra,
  rowScope,
  canEdit,
  readOnly,
  copyToScope,
}: {
  title: string
  createLabel: string
  emptyLabel: string
  errorLabel: string
  createSchema: ZodType<TCreate>
  updateSchema: ZodType<TUpdate>
  createDefaults: TCreate
  fields: LookupFieldSpec<TCreate>[]
  columns: LookupColumnSpec<TSummary>[]
  search?: LookupSearchSpec<TSummary>
  filters?: LookupFilterSpec<TSummary>[]
  useList: () => { data: TSummary[] | undefined; isLoading: boolean; isError: boolean }
  useCreate: () => MutationLike<TCreate, TSummary>
  useUpdate: (id: string) => MutationLike<TUpdate, TSummary>
  useDelete: (id: string) => MutationLike<void, void>
  bulkDelete: (ids: string[]) => Promise<{ deletedIds: string[]; blockedIds: string[] }>
  bulkDuplicate: (items: TCreate[]) => Promise<TSummary[]>
  duplicate: (row: TSummary) => TCreate
  toEditDefaults: (row: TSummary) => TUpdate
  rowLabel: (row: TSummary) => string
  deleteWarning?: string
  // Slotted into the header row, before the create-dialog trigger —
  // used by the three Systems tabs to mount the shared 3-sheet
  // Brand/Catalogue/Profile importer (SystemsImportButton) without
  // this generic component knowing anything about that feature.
  headerExtra?: React.ReactNode
  // When present, renders an Origin badge column and a scope filter
  // chip — the workspace Data section's merged platform+company view.
  rowScope?: (row: TSummary) => LookupRowScope
  // Gates a row's edit/delete buttons and its bulk-select checkbox.
  // Defaults to "every row" — today's admin behaviour. Ignored (treated
  // as false for every row) when `readOnly` is set.
  canEdit?: (row: TSummary) => boolean
  // Hides the create button and every row action outright, regardless
  // of `canEdit` — the workspace Data section's Phase 1 mode, before
  // company-owned rows exist to make any of this editable.
  readOnly?: boolean
  // Lets a non-editable row seed a new row in the caller's own scope —
  // "Copy to our data". Rendered in place of the (absent) edit/delete
  // buttons on a row `canEdit` refuses. Not used until Phase 2.
  copyToScope?: { label: string; toDefaults: (row: TSummary) => TCreate }
}) {
  const { t: tCommon } = useTranslation('common')
  const { t, i18n } = useTranslation('lookups')
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useList()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>('__all')

  const createMutation = useCreate()
  const updateMutation = useUpdate(editTarget?.id ?? '')
  const deleteMutation = useDelete(deleteTarget?.id ?? '')

  // zodResolver's generics don't narrow cleanly against an abstract
  // `ZodType<TCreate>` prop (as opposed to a concrete schema literal) —
  // cast at this one boundary; every call site still passes a real,
  // fully-typed Create/UpdateXInput schema from packages/types.
  const createForm = useForm<TCreate>({
    resolver: zodResolver(createSchema as never) as Resolver<TCreate>,
    defaultValues: createDefaults as DefaultValues<TCreate>,
  })
  const editForm = useForm<TUpdate>({
    resolver: zodResolver(updateSchema as never) as Resolver<TUpdate>,
  })

  // `readOnly` overrides `canEdit` entirely rather than combining with
  // it — a caller in read-only mode has no business asking "but which
  // rows" at the same time.
  const rowIsEditable = (row: TSummary) => !readOnly && (canEdit ? canEdit(row) : true)

  const rows = data ?? []
  // Search/filters narrow what's shown and what "select all" acts on —
  // bulk duplicate/delete still resolve selected ids against the full
  // `rows`, so a selection made before narrowing the view isn't lost.
  const trimmedQuery = searchQuery.trim()
  const visibleRows = rows.filter((row) => {
    if (search && trimmedQuery && !search.match(row, trimmedQuery)) return false
    if (rowScope && scopeFilter !== '__all' && rowScope(row) !== scopeFilter) return false
    for (const filter of filters ?? []) {
      const value = filterValues[filter.key]
      if (value && value !== '__all' && !filter.match(row, value)) return false
    }
    return true
  })
  // "Select all" only ever selects rows this caller is allowed to act
  // on — a merged platform+company table would otherwise let "select
  // all" grab platform rows that bulk delete/duplicate can't touch.
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

  const onCreate = async (values: TCreate) => {
    try {
      await createMutation.mutateAsync(values)
      toast.success(t('messages.createSuccess'))
      createForm.reset(createDefaults)
      setCreateOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onEdit = async (values: TUpdate) => {
    try {
      await updateMutation.mutateAsync(values)
      toast.success(t('messages.updateSuccess'))
      setEditTarget(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDelete = async () => {
    try {
      await deleteMutation.mutateAsync()
      toast.success(t('messages.deleteSuccess'))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
      // Keep the dialog open on failure (e.g. delete-protection) so the
      // error is visible next to the thing that failed to delete.
    }
  }

  const onBulkDelete = async () => {
    const ids = [...selected]
    setBulkDeleteConfirmOpen(false)
    setBulkBusy(true)
    try {
      const { deletedIds, blockedIds } = await bulkDelete(ids)
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      await queryClient.invalidateQueries({ queryKey: ['company-lookups'] })
      if (blockedIds.length > 0) {
        toast.error(
          t('messages.bulkDeletePartial', {
            failed: blockedIds.length,
            succeeded: deletedIds.length,
          }),
        )
      } else {
        toast.success(t('messages.bulkDeleteSuccess', { count: deletedIds.length }))
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  const onBulkDuplicate = async () => {
    const targets = rows.filter((row) => selected.has(row.id))
    setBulkBusy(true)
    try {
      const created = await bulkDuplicate(targets.map((row) => duplicate(row)))
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      await queryClient.invalidateQueries({ queryKey: ['company-lookups'] })
      toast.success(t('messages.bulkDuplicateSuccess', { count: created.length }))
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  const onCopyToScope = (row: TSummary) => {
    if (!copyToScope) return
    createForm.reset(copyToScope.toDefaults(row) as DefaultValues<TCreate>)
    setCreateOpen(true)
  }

  // Per-row duplicate (an editable row copying itself), distinct from
  // onCopyToScope (a platform row copying itself into this caller's own
  // scope) — same bulkDuplicate endpoint as the multi-select bulk action,
  // just called with a single item.
  const onDuplicateRow = async (row: TSummary) => {
    try {
      const created = await bulkDuplicate([duplicate(row)])
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      await queryClient.invalidateQueries({ queryKey: ['company-lookups'] })
      toast.success(t('messages.bulkDuplicateSuccess', { count: created.length }))
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* The admin tab already names the table (Mario, 2026-10-03): kept
          for screen readers only. The company Data page (`rowScope`) shows
          it visibly with its counts instead — workspace redesign §4. */}
      {!rowScope && <h2 className="sr-only">{title}</h2>}

      {/* One toolbar row (Mario, 2026-10-03): search + filters at the start,
          the table's own actions at the end. Ticking rows swaps the whole
          row for the bulk bar until the selection is cleared. */}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2">
        {someSelected ? (
          <div className="flex flex-1 flex-wrap items-center gap-3 rounded-md bg-muted/60 px-3 py-0.5">
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
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              disabled={bulkBusy}
              onClick={() => setSelected(new Set())}
            >
              <X className="size-4" aria-hidden="true" />
              {t('bulk.clear')}
            </Button>
          </div>
        ) : (
          <>
            {rowScope && <ScopeSummary title={title} rows={rows} rowScope={rowScope} />}
            {search && (
              <SearchInput
                icon
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={search.placeholder}
                className="w-full max-w-xs"
              />
            )}
            {rowScope && <ScopeToggle value={scopeFilter} onChange={setScopeFilter} />}
            {filters?.map((filter) => (
              <Select
                key={filter.key}
                value={filterValues[filter.key] ?? '__all'}
                onValueChange={(v) => setFilterValues((prev) => ({ ...prev, [filter.key]: v }))}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{filter.allLabel}</SelectItem>
                  {filter.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            <div className="ms-auto flex items-center gap-2">
              {headerExtra}
              {!readOnly && (
              <Dialog
                open={createOpen}
                onOpenChange={(next) => {
                  setCreateOpen(next)
                  if (!next) createForm.reset(createDefaults)
                }}
              >
                <DialogTrigger asChild>
                  {/* Primary on the company Data page (Mario, 2026-10-04, matching the design); admin keeps outline. */}
                  <Button size="sm" variant={rowScope ? 'default' : 'outline'}>
                    <Plus className="size-4" aria-hidden="true" />
                    {createLabel}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form
                    onSubmit={(e) => void createForm.handleSubmit(onCreate)(e)}
                    noValidate
                    className="flex flex-col gap-4"
                  >
                    <DialogHeader>
                      <DialogTitle>{createLabel}</DialogTitle>
                    </DialogHeader>
                    <LookupFormFields fields={fields} form={createForm} idPrefix="create" />
                    <DialogFooter>
                      <Button type="submit" disabled={createForm.formState.isSubmitting}>
                        {tCommon('actions.save')}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              )}
            </div>
          </>
        )}
      </div>

      {(() => {
        const colCount = columns.length + (readOnly ? 0 : 1) + (rowScope ? 1 : 0) + (readOnly ? 0 : 1)
        return (
      <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {!readOnly && (
              <TableHead className="w-10">
                {selectableVisibleRows.length > 0 && (
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t('bulk.selectAll')} />
                )}
              </TableHead>
            )}
            {columns.map((col) => (
              <TableHead key={col.header}>{col.header}</TableHead>
            ))}
            {rowScope && <TableHead className="w-24">{t('scope.columnHeader')}</TableHead>}
            {!readOnly && (
              <TableHead className="w-12">
                <span className="sr-only">{t('rowMenu.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(isLoading || isError || rows.length === 0) && (
            <TableRow>
              <TableCell
                colSpan={colCount}
                className={isError ? 'text-center text-destructive' : 'text-center text-muted-foreground'}
              >
                {isError ? errorLabel : emptyLabel}
              </TableCell>
            </TableRow>
          )}
          {!isLoading && !isError && rows.length > 0 && visibleRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="text-center text-muted-foreground">
                {t('messages.noResults')}
              </TableCell>
            </TableRow>
          )}
          {!isLoading &&
            !isError &&
            visibleRows.map((row) => {
              const editable = rowIsEditable(row)
              return (
              <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                {!readOnly && (
                  <TableCell>
                    {editable && (
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleOne(row.id)}
                        aria-label={rowLabel(row)}
                      />
                    )}
                  </TableCell>
                )}
                {columns.map((col) => (
                  <TableCell key={col.header}>{col.cell(row)}</TableCell>
                ))}
                {rowScope && (
                  <TableCell>
                    <span
                      className={
                        rowScope(row) === 'company'
                          ? 'rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                      }
                    >
                      {rowScope(row) === 'company' ? t('scope.ours') : t('scope.platform')}
                    </span>
                  </TableCell>
                )}
                {!readOnly && (
                  <TableCell className="text-end">
                    {(editable || copyToScope) && (
                      // One ⋯ menu per row instead of a row of icon buttons
                      // (Mario, 2026-10-03). Radix positions by physical
                      // side, so the end alignment flips in Arabic.
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={t('rowMenu.label', { name: rowLabel(row) })}>
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align={i18n.dir() === 'rtl' ? 'start' : 'end'}
                          className="w-auto min-w-44 whitespace-nowrap *:data-[slot=dropdown-menu-item]:gap-2.5 *:data-[slot=dropdown-menu-item]:px-2.5 *:data-[slot=dropdown-menu-item]:py-1.5"
                        >
                          {editable ? (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditTarget(row)
                                  editForm.reset(toEditDefaults(row))
                                }}
                              >
                                <Pencil className="text-muted-foreground" aria-hidden="true" />
                                {t('rowMenu.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void onDuplicateRow(row)}>
                                <Copy className="text-muted-foreground" aria-hidden="true" />
                                {t('bulk.duplicate')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(row)}>
                                <Trash2 aria-hidden="true" />
                                {t('rowMenu.delete')}
                              </DropdownMenuItem>
                            </>
                          ) : (
                            copyToScope && (
                              <DropdownMenuItem onClick={() => onCopyToScope(row)}>
                                <Copy className="text-muted-foreground" aria-hidden="true" />
                                {copyToScope.label}
                              </DropdownMenuItem>
                            )
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
              )
            })}
        </TableBody>
      </Table>
        )
      })()}

      <Dialog
        open={!!editTarget}
        onOpenChange={(next) => {
          if (!next) setEditTarget(null)
        }}
      >
        <DialogContent>
          <form onSubmit={(e) => void editForm.handleSubmit(onEdit)(e)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editTarget ? rowLabel(editTarget) : ''}</DialogTitle>
            </DialogHeader>
            <LookupFormFields fields={fields as unknown as LookupFieldSpec<TUpdate>[]} form={editForm} idPrefix="edit" />
            <DialogFooter>
              <Button type="submit" disabled={editForm.formState.isSubmitting}>
                {tCommon('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget ? t('messages.deleteConfirmTitle', { name: rowLabel(deleteTarget) }) : ''}
            </AlertDialogTitle>
            {deleteWarning && <AlertDialogDescription>{deleteWarning}</AlertDialogDescription>}
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
              {t('bulk.deleteConfirmTitle', { count: selected.size })}
            </AlertDialogTitle>
            {deleteWarning && <AlertDialogDescription>{deleteWarning}</AlertDialogDescription>}
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

function LookupFormFields<TInput extends FieldValues>({
  fields,
  form,
  idPrefix,
}: {
  fields: LookupFieldSpec<TInput>[]
  form: ReturnType<typeof useForm<TInput>>
  idPrefix: string
}) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = form
  // One subscription for every `visibleWhen` — rerenders on any value
  // change, which is what a cross-field predicate needs.
  const values = useWatch({ control }) as Partial<TInput>
  const visible = fields.filter((field) => field.visibleWhen?.(values) ?? true)
  const visibleKey = visible.map((f) => f.name).join('|')

  useEffect(() => {
    for (const field of visible) {
      if (field.visibleWhen === undefined || field.shownDefault === undefined) continue
      const current = values[field.name]
      if (current === null || current === undefined || (typeof current === 'number' && Number.isNaN(current))) {
        setValue(field.name, field.shownDefault as never, { shouldDirty: true, shouldValidate: true })
      }
    }
    // Only when the SET of visible fields changes — a value edit inside
    // an already-visible field must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey])

  return (
    <div className="flex flex-col gap-3">
      {visible.map((field) => {
        const fieldId = `${idPrefix}-${field.name}`
        const error = errors[field.name]
        return (
          <div key={field.name}>
            {field.type === 'boolean' ? (
              <div className="mt-1.5 flex items-center gap-2">
                <Controller
                  name={field.name}
                  control={control}
                  render={({ field: controllerField }) => (
                    <Checkbox
                      id={fieldId}
                      checked={!!controllerField.value}
                      onCheckedChange={(checked) => controllerField.onChange(!!checked)}
                    />
                  )}
                />
                <Label htmlFor={fieldId} className="font-normal">
                  {field.label}
                </Label>
              </div>
            ) : (
              <>
                <Label htmlFor={fieldId}>{field.label}</Label>
                {field.type === 'select' ? (
                  <Controller
                    name={field.name}
                    control={control}
                    render={({ field: controllerField }) => (
                      <Select value={controllerField.value ?? ''} onValueChange={controllerField.onChange}>
                        <SelectTrigger id={fieldId} className="mt-1.5 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options ?? []).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    type={field.type === 'number' ? 'number' : 'text'}
                    step={field.step}
                    min={field.min}
                    max={field.max}
                    className="mt-1.5"
                    aria-invalid={!!error}
                    {...register(field.name, field.type === 'number' ? { valueAsNumber: true } : undefined)}
                  />
                )}
              </>
            )}
            {error && <p className="mt-1 text-xs text-destructive">{String(error.message ?? '')}</p>}
          </div>
        )
      })}
    </div>
  )
}
