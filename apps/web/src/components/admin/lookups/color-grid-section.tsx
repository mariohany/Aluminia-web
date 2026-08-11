import { useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Plus, Trash2, Upload } from 'lucide-react'
import {
  createColorSchema,
  updateColorSchema,
  type ColorImportResult,
  type ColorSummary,
  type CreateColorInput,
  type UpdateColorInput,
} from '@repo/types/lookups'
import { apiErrorMessage } from '@/lib/api-client'
import * as lookupsApi from '@/lib/lookups-api'
import {
  useColorsQuery,
  useCreateColorMutation,
  useDeleteColorMutation,
  useImportColorsMutation,
  useUpdateColorMutation,
} from '@/lib/lookups-queries'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

const CREATE_DEFAULTS: CreateColorInput = { code: '', hex: '#' }

// Colours read as a swatch wall, not a data table — the point of a RAL
// code is what it looks like, so the hex value gets shown as a colour,
// not as a string in a column. Same CRUD + bulk-select shape as
// SimpleLookupSection, just a different layout for the list.
export function ColorGridSection() {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useColorsQuery()
  const rows = data ?? []

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ColorSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ColorSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [importResult, setImportResult] = useState<ColorImportResult | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const createMutation = useCreateColorMutation()
  const updateMutation = useUpdateColorMutation(editTarget?.id ?? '')
  const deleteMutation = useDeleteColorMutation(deleteTarget?.id ?? '')
  const importMutation = useImportColorsMutation()

  const createForm = useForm<CreateColorInput>({
    resolver: zodResolver(createColorSchema),
    defaultValues: CREATE_DEFAULTS,
  })
  const editForm = useForm<UpdateColorInput>({ resolver: zodResolver(updateColorSchema) })

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someSelected = selected.size > 0
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onCreate = async (values: CreateColorInput) => {
    try {
      await createMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.createSuccess'))
      createForm.reset(CREATE_DEFAULTS)
      setCreateOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    }
  }

  const onEdit = async (values: UpdateColorInput) => {
    try {
      await updateMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.updateSuccess'))
      setEditTarget(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    }
  }

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
      const { deletedIds, blockedIds } = await lookupsApi.bulkDeleteColors(ids)
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
      const created = await lookupsApi.bulkDuplicateColors(
        targets.map((row) => ({ code: `${row.code} ${t('dataWarehousePage.bulk.copySuffix')}`, hex: row.hex })),
      )
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      toast.success(t('dataWarehousePage.messages.bulkDuplicateSuccess', { count: created.length }))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.messages.error')))
    } finally {
      setBulkBusy(false)
      setSelected(new Set())
    }
  }

  const onImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const result = await importMutation.mutateAsync(file)
      setImportResult(result)
      toast.success(t('dataWarehousePage.colorImport.success'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.colorImport.error')))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-foreground">{t('dataWarehousePage.tables.colors')}</h2>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              {t('dataWarehousePage.bulk.selectAll')}
            </label>
          )}
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => void onImportFileSelected(e)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={importMutation.isPending}
            title={t('dataWarehousePage.colorImport.description')}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden="true" />
            {importMutation.isPending
              ? t('dataWarehousePage.colorImport.importing')
              : t('dataWarehousePage.createButtons.colorImport')}
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next)
              if (!next) createForm.reset(CREATE_DEFAULTS)
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-4" aria-hidden="true" />
                {t('dataWarehousePage.createButtons.color')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={(e) => void createForm.handleSubmit(onCreate)(e)} noValidate className="flex flex-col gap-4">
                <DialogHeader>
                  <DialogTitle>{t('dataWarehousePage.createButtons.color')}</DialogTitle>
                </DialogHeader>
                <ColorFormFields form={createForm} idPrefix="create" />
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

      {someSelected && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-0.5">
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

      {isLoading || isError || rows.length === 0 ? (
        <div className={`rounded-lg border border-border p-6 text-center text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {isError ? t('dataWarehousePage.messages.error') : t('dataWarehousePage.empty.color')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4">
            {rows.map((color) => (
              <div key={color.id} className="flex flex-col items-center gap-1.5">
                <div className="relative w-full">
                  <button
                    type="button"
                    className="aspect-square w-full rounded-lg border border-border shadow-sm transition-transform hover:scale-105"
                    style={{ backgroundColor: color.hex }}
                    onClick={() => {
                      setEditTarget(color)
                      editForm.reset({ code: color.code, hex: color.hex })
                    }}
                    aria-label={color.code}
                  />
                  <span className="absolute start-1 top-1 rounded bg-background/80 p-0.5">
                    <Checkbox checked={selected.has(color.id)} onCheckedChange={() => toggleOne(color.id)} />
                  </span>
                  <button
                    type="button"
                    className="absolute end-1 top-1 rounded bg-background/80 p-1 text-destructive hover:bg-background"
                    onClick={() => setDeleteTarget(color)}
                    aria-label={tCommon('actions.delete')}
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </button>
                </div>
                <span className="text-xs font-medium text-foreground">{color.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!editTarget} onOpenChange={(next) => !next && setEditTarget(null)}>
        <DialogContent>
          <form onSubmit={(e) => void editForm.handleSubmit(onEdit)(e)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editTarget?.code ?? ''}</DialogTitle>
            </DialogHeader>
            <ColorFormFields form={editForm} idPrefix="edit" />
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
              {deleteTarget ? t('dataWarehousePage.messages.deleteConfirmTitle', { name: deleteTarget.code }) : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('dataWarehousePage.deleteWarnings.color')}</AlertDialogDescription>
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
            <AlertDialogDescription>{t('dataWarehousePage.deleteWarnings.color')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={bulkBusy} onClick={() => void onBulkDelete()}>
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!importResult} onOpenChange={(next) => !next && setImportResult(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dataWarehousePage.colorImport.resultTitle')}</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="flex flex-col gap-3 text-sm">
              {importResult.created.length === 0 &&
              importResult.updated.length === 0 &&
              importResult.unchangedCount === 0 &&
              importResult.duplicates.length === 0 &&
              importResult.errors.length === 0 ? (
                <p className="text-muted-foreground">{t('dataWarehousePage.colorImport.noChanges')}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {importResult.created.length > 0 && (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                        {t('dataWarehousePage.colorImport.created', { count: importResult.created.length })}
                      </span>
                    )}
                    {importResult.updated.length > 0 && (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                        {t('dataWarehousePage.colorImport.updated', { count: importResult.updated.length })}
                      </span>
                    )}
                    {importResult.unchangedCount > 0 && (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {t('dataWarehousePage.colorImport.unchanged', { count: importResult.unchangedCount })}
                      </span>
                    )}
                    {importResult.duplicates.length > 0 && (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {t('dataWarehousePage.colorImport.duplicates', {
                          count: importResult.duplicates.reduce((sum, d) => sum + d.occurrences, 0),
                        })}
                      </span>
                    )}
                  </div>

                  {importResult.updated.length > 0 && (
                    <div>
                      <p className="mb-1 font-medium text-foreground">
                        {t('dataWarehousePage.colorImport.updatedListTitle')}
                      </p>
                      <ul className="flex flex-col gap-1 text-muted-foreground">
                        {importResult.updated.map((u) => (
                          <li key={u.code} className="flex items-center gap-2">
                            <span
                              className="size-3.5 shrink-0 rounded-full border border-border"
                              style={{ backgroundColor: u.oldHex }}
                              aria-hidden="true"
                            />
                            {t('dataWarehousePage.colorImport.hexChange', {
                              code: u.code,
                              oldHex: u.oldHex,
                              newHex: u.newHex,
                            })}
                            <span
                              className="size-3.5 shrink-0 rounded-full border border-border"
                              style={{ backgroundColor: u.newHex }}
                              aria-hidden="true"
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {importResult.duplicates.length > 0 && (
                    <div>
                      <p className="mb-1 font-medium text-foreground">
                        {t('dataWarehousePage.colorImport.duplicates', {
                          count: importResult.duplicates.reduce((sum, d) => sum + d.occurrences, 0),
                        })}
                      </p>
                      <ul className="flex flex-col gap-1 text-muted-foreground">
                        {importResult.duplicates.map((d) => (
                          <li key={d.code}>
                            {t('dataWarehousePage.colorImport.duplicateItem', {
                              code: d.code,
                              occurrences: d.occurrences,
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {importResult.errors.length > 0 && (
                    <div>
                      <p className="mb-1 font-medium text-destructive">
                        {t('dataWarehousePage.colorImport.errorsTitle')}
                      </p>
                      <ul className="flex flex-col gap-1 text-muted-foreground">
                        {importResult.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setImportResult(null)}>{t('dataWarehousePage.colorImport.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ColorFormFields({
  form,
  idPrefix,
}: {
  form: ReturnType<typeof useForm<CreateColorInput>> | ReturnType<typeof useForm<UpdateColorInput>>
  idPrefix: string
}) {
  const { t } = useTranslation('admin')
  const {
    register,
    control,
    formState: { errors },
  } = form
  // `hex` is a free-text field until it passes the schema's regex on
  // submit, so this preview has to tolerate a partial or invalid value
  // mid-typing — an invalid CSS colour just renders as a blank square,
  // never a crash, until the input becomes a real 6-digit hex.
  // `control`'s type is a union across the create/edit form generics
  // (CreateColorInput vs. the partial UpdateColorInput), which useWatch's
  // generics don't reconcile cleanly for a single shared component —
  // cast at this one boundary; both forms really do have a `hex` field.
  const hex = useWatch({ control: control as never, name: 'hex' }) as string | undefined

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor={`${idPrefix}-code`}>{t('dataWarehousePage.fields.code')}</Label>
        <Input id={`${idPrefix}-code`} className="mt-1.5" aria-invalid={!!errors.code} {...register('code')} />
        {errors.code && <p className="mt-1 text-xs text-destructive">{String(errors.code.message ?? '')}</p>}
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-hex`}>{t('dataWarehousePage.fields.hex')}</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className="size-9 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: hex || undefined }}
            aria-hidden="true"
          />
          <Input
            id={`${idPrefix}-hex`}
            className="flex-1"
            aria-invalid={!!errors.hex}
            {...register('hex')}
          />
        </div>
        {errors.hex && <p className="mt-1 text-xs text-destructive">{String(errors.hex.message ?? '')}</p>}
      </div>
    </div>
  )
}
