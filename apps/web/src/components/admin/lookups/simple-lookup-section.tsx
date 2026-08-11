import { useState } from 'react'
import {
  Controller,
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { ZodType } from 'zod'
import { apiErrorMessage } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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

export interface LookupFieldSpec<TInput extends FieldValues> {
  name: Path<TInput>
  label: string
  type: 'text' | 'number' | 'select'
  step?: number
  min?: number
  options?: { value: string; label: string }[]
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
export function SimpleLookupSection<
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
}) {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('admin')
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

  const rows = data ?? []
  // Search/filters narrow what's shown and what "select all" acts on —
  // bulk duplicate/delete still resolve selected ids against the full
  // `rows`, so a selection made before narrowing the view isn't lost.
  const trimmedQuery = searchQuery.trim()
  const visibleRows = rows.filter((row) => {
    if (search && trimmedQuery && !search.match(row, trimmedQuery)) return false
    for (const filter of filters ?? []) {
      const value = filterValues[filter.key]
      if (value && value !== '__all' && !filter.match(row, value)) return false
    }
    return true
  })
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

  const onCreate = async (values: TCreate) => {
    try {
      await createMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.createSuccess'))
      createForm.reset(createDefaults)
      setCreateOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onEdit = async (values: TUpdate) => {
    try {
      await updateMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.updateSuccess'))
      setEditTarget(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDelete = async () => {
    try {
      await deleteMutation.mutateAsync()
      toast.success(t('dataWarehousePage.messages.deleteSuccess'))
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
      if (blockedIds.length > 0) {
        toast.error(
          t('dataWarehousePage.messages.bulkDeletePartial', {
            failed: blockedIds.length,
            succeeded: deletedIds.length,
          }),
        )
      } else {
        toast.success(t('dataWarehousePage.messages.bulkDeleteSuccess', { count: deletedIds.length }))
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
      toast.success(t('dataWarehousePage.messages.bulkDuplicateSuccess', { count: created.length }))
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
        <div className="flex items-center gap-2">
          {headerExtra}
          <Dialog
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next)
              if (!next) createForm.reset(createDefaults)
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
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
        </div>
      </div>

      {(search || (filters && filters.length > 0) || someSelected) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {search && (
              <div className="relative w-full max-w-xs">
                <Search
                  className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={search.placeholder}
                  className="ps-8"
                />
              </div>
            )}
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
          </div>

          {someSelected && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/60 px-3 py-0.5">
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
        </div>
      )}

      <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-10">
              {visibleRows.length > 0 && (
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t('dataWarehousePage.bulk.selectAll')} />
              )}
            </TableHead>
            {columns.map((col) => (
              <TableHead key={col.header}>{col.header}</TableHead>
            ))}
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(isLoading || isError || rows.length === 0) && (
            <TableRow>
              <TableCell
                colSpan={columns.length + 2}
                className={isError ? 'text-center text-destructive' : 'text-center text-muted-foreground'}
              >
                {isError ? errorLabel : emptyLabel}
              </TableCell>
            </TableRow>
          )}
          {!isLoading && !isError && rows.length > 0 && visibleRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + 2} className="text-center text-muted-foreground">
                {t('dataWarehousePage.messages.noResults')}
              </TableCell>
            </TableRow>
          )}
          {!isLoading &&
            !isError &&
            visibleRows.map((row) => (
              <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggleOne(row.id)}
                    aria-label={rowLabel(row)}
                  />
                </TableCell>
                {columns.map((col) => (
                  <TableCell key={col.header}>{col.cell(row)}</TableCell>
                ))}
                <TableCell className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => {
                      setEditTarget(row)
                      editForm.reset(toEditDefaults(row))
                    }}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>

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
              {deleteTarget ? t('dataWarehousePage.messages.deleteConfirmTitle', { name: rowLabel(deleteTarget) }) : ''}
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
              {t('dataWarehousePage.bulk.deleteConfirmTitle', { count: selected.size })}
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
    formState: { errors },
  } = form
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const fieldId = `${idPrefix}-${field.name}`
        const error = errors[field.name]
        return (
          <div key={field.name}>
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
                className="mt-1.5"
                aria-invalid={!!error}
                {...register(field.name, field.type === 'number' ? { valueAsNumber: true } : undefined)}
              />
            )}
            {error && <p className="mt-1 text-xs text-destructive">{String(error.message ?? '')}</p>}
          </div>
        )
      })}
    </div>
  )
}
