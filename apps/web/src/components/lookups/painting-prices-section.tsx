import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createPaintBrandSchema,
  updatePaintBrandSchema,
  type CreatePaintBrandInput,
  type UpdatePaintBrandInput,
} from '@repo/types/lookups'
import {
  LookupScope,
  createCompanyPaintingPriceSchema,
  formatScopedRef,
  parseScopedRef,
  updateCompanyPaintingPriceSchema,
  type CreateCompanyPaintingPriceInput,
  type ScopedRef,
  type UpdateCompanyPaintingPriceInput,
} from '@repo/types/company-lookups'
import { apiErrorMessage } from '@/lib/api-client'
import {
  usePaintBrandsQuery,
  usePaintingPricesQuery,
  useCreatePaintBrandMutation,
  useUpdatePaintBrandMutation,
  useDeletePaintBrandMutation,
  useCreatePaintingPriceMutation,
  useUpdatePaintingPriceMutation,
  useDeletePaintingPriceMutation,
} from '@/lib/lookups-queries'
import {
  useCreateCompanyPaintBrandMutation,
  useUpdateCompanyPaintBrandMutation,
  useDeleteCompanyPaintBrandMutation,
  useCreateCompanyPaintingPriceMutation,
  useUpdateCompanyPaintingPriceMutation,
  useDeleteCompanyPaintingPriceMutation,
} from '@/lib/company-lookups-queries'
import {
  platformBrandToMerged,
  platformPriceToMerged,
  type MergedPaintBrandSummary,
  type MergedPaintingPriceSummary,
} from '@/lib/lookup-merge'
import type { LookupRowScope } from './lookup-table-section'
import { Button } from '@/components/ui/button'
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

function usePlatformPaintBrandsQuery(): {
  data: MergedPaintBrandSummary[] | undefined
  isLoading: boolean
  isError: boolean
} {
  const { data, isLoading, isError } = usePaintBrandsQuery()
  const rows = useMemo(() => data?.map(platformBrandToMerged), [data])
  return { data: rows, isLoading, isError }
}
function usePlatformPaintingPricesQuery(): { data: MergedPaintingPriceSummary[] | undefined } {
  const { data } = usePaintingPricesQuery()
  const rows = useMemo(() => data?.map(platformPriceToMerged), [data])
  return { data: rows }
}

// Merged brand + price screen, side by side: a brand table on the left,
// a price table for the selected brand on the right (master-detail,
// rather than a stacked/accordion layout) — clicking a brand "groups"
// the right-hand table down to just that brand's prices. Doesn't reuse
// LookupTableSection — that component is built around a single flat
// table with bulk actions; this is a two-table master-detail view
// instead. Bulk select/duplicate/delete is deliberately dropped for both
// brands and prices, in both consoles.
//
// A price's parent brand is a ScopedRef internally (same reasoning as
// GlassCombinationSection) — the admin console's default list hooks wrap
// its plain platform-only queries through the same platformBrandToMerged/
// platformPriceToMerged transforms lookup-merge.ts uses for the
// workspace, so there's one internal shape and one `toAdminPriceInput`
// translation right at the mutation boundary, not two parallel
// implementations.
//
// `scoped` switches every mutation to the company-lookups endpoints —
// the workspace Data page is the only caller that sets it. `canEdit`/
// `rowScope` apply to both the brand and price tables (both merged rows
// carry `scope`); `copyToScope` covers both "copy a platform brand" and
// "copy a platform price" (which may keep referencing a platform brand —
// cross-scope references are allowed).
export function PaintingPricesSection({
  useBrandsList = usePlatformPaintBrandsQuery,
  usePricesList = usePlatformPaintingPricesQuery,
  scoped = false,
  rowScope,
  canEdit,
  copyToScope,
}: {
  useBrandsList?: () => { data: MergedPaintBrandSummary[] | undefined; isLoading: boolean; isError: boolean }
  usePricesList?: () => { data: MergedPaintingPriceSummary[] | undefined }
  scoped?: boolean
  rowScope?: (row: { scope: LookupRowScope }) => LookupRowScope
  canEdit?: (row: { scope: LookupRowScope }) => boolean
  copyToScope?: { label: string }
} = {}) {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('lookups')
  const errorLabel = t('messages.error')
  const copySuffix = t('bulk.copySuffix')
  const rowIsEditable = (row: { scope: LookupRowScope }) => (canEdit ? canEdit(row) : true)

  const { data: brands, isLoading: brandsLoading, isError: brandsError } = useBrandsList()
  const { data: prices } = usePricesList()

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [createBrandOpen, setCreateBrandOpen] = useState(false)
  const [editBrand, setEditBrand] = useState<MergedPaintBrandSummary | null>(null)
  const [deleteBrand, setDeleteBrand] = useState<MergedPaintBrandSummary | null>(null)
  const [createPriceOpen, setCreatePriceOpen] = useState(false)
  const [editPrice, setEditPrice] = useState<MergedPaintingPriceSummary | null>(null)
  const [deletePrice, setDeletePrice] = useState<MergedPaintingPriceSummary | null>(null)

  const adminCreateBrand = useCreatePaintBrandMutation()
  const companyCreateBrand = useCreateCompanyPaintBrandMutation()
  const adminUpdateBrand = useUpdatePaintBrandMutation(editBrand?.id ?? '')
  const companyUpdateBrand = useUpdateCompanyPaintBrandMutation(editBrand?.id ?? '')
  const adminDeleteBrand = useDeletePaintBrandMutation(deleteBrand?.id ?? '')
  const companyDeleteBrand = useDeleteCompanyPaintBrandMutation(deleteBrand?.id ?? '')
  const adminCreatePrice = useCreatePaintingPriceMutation()
  const companyCreatePrice = useCreateCompanyPaintingPriceMutation()
  const adminUpdatePrice = useUpdatePaintingPriceMutation(editPrice?.id ?? '')
  const companyUpdatePrice = useUpdateCompanyPaintingPriceMutation(editPrice?.id ?? '')
  const adminDeletePrice = useDeletePaintingPriceMutation(deletePrice?.id ?? '')
  const companyDeletePrice = useDeleteCompanyPaintingPriceMutation(deletePrice?.id ?? '')

  const createBrandForm = useForm<CreatePaintBrandInput>({
    resolver: zodResolver(createPaintBrandSchema),
    defaultValues: { name: '' },
  })
  const editBrandForm = useForm<UpdatePaintBrandInput>({
    resolver: zodResolver(updatePaintBrandSchema),
  })
  const createPriceForm = useForm<CreateCompanyPaintingPriceInput>({
    resolver: zodResolver(createCompanyPaintingPriceSchema),
    defaultValues: { brand: '' as ScopedRef, type: '', price: 0 },
  })
  const editPriceForm = useForm<UpdateCompanyPaintingPriceInput>({
    resolver: zodResolver(updateCompanyPaintingPriceSchema),
  })

  const brandOptions = (brands ?? []).map((b) => ({
    value: formatScopedRef(b.scope, b.id),
    label: b.scope === LookupScope.COMPANY ? `${b.name} · ${t('scope.ours')}` : b.name,
  }))
  // Falls back to the first brand whenever nothing is selected yet, or the
  // previously-selected brand no longer exists (e.g. it was just deleted)
  // — avoids a stale id in state without needing a useEffect to reconcile it.
  const selectedBrand =
    (brands ?? []).find((b) => b.id === selectedBrandId) ?? (brands ?? [])[0] ?? null
  const selectedBrandRef = selectedBrand ? formatScopedRef(selectedBrand.scope, selectedBrand.id) : null
  const selectedBrandPrices = (prices ?? []).filter((p) => p.brand === selectedBrandRef)

  const onCreateBrand = async (values: CreatePaintBrandInput) => {
    try {
      const brand = scoped
        ? await companyCreateBrand.mutateAsync(values)
        : await adminCreateBrand.mutateAsync(values)
      toast.success(t('messages.createSuccess'))
      createBrandForm.reset({ name: '' })
      setCreateBrandOpen(false)
      setSelectedBrandId(brand.id)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onEditBrand = async (values: UpdatePaintBrandInput) => {
    try {
      if (scoped) await companyUpdateBrand.mutateAsync(values)
      else await adminUpdateBrand.mutateAsync(values)
      toast.success(t('messages.updateSuccess'))
      setEditBrand(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDeleteBrand = async () => {
    try {
      if (scoped) await companyDeleteBrand.mutateAsync()
      else await adminDeleteBrand.mutateAsync()
      toast.success(t('messages.deleteSuccess'))
      setDeleteBrand(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onCreatePrice = async (values: CreateCompanyPaintingPriceInput) => {
    try {
      if (scoped) {
        await companyCreatePrice.mutateAsync(values)
      } else {
        await adminCreatePrice.mutateAsync({ brandId: parseScopedRef(values.brand).id, type: values.type, price: values.price })
      }
      toast.success(t('messages.createSuccess'))
      setCreatePriceOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onEditPrice = async (values: UpdateCompanyPaintingPriceInput) => {
    try {
      if (scoped) {
        await companyUpdatePrice.mutateAsync(values)
      } else {
        await adminUpdatePrice.mutateAsync({
          brandId: values.brand ? parseScopedRef(values.brand).id : undefined,
          type: values.type,
          price: values.price,
        })
      }
      toast.success(t('messages.updateSuccess'))
      setEditPrice(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDeletePrice = async () => {
    try {
      if (scoped) await companyDeletePrice.mutateAsync()
      else await adminDeletePrice.mutateAsync()
      toast.success(t('messages.deleteSuccess'))
      setDeletePrice(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDuplicateBrand = async (brand: MergedPaintBrandSummary) => {
    try {
      if (scoped) await companyCreateBrand.mutateAsync({ name: `${brand.name} ${copySuffix}` })
      else await adminCreateBrand.mutateAsync({ name: `${brand.name} ${copySuffix}` })
      toast.success(t('messages.createSuccess'))
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDuplicatePrice = async (price: MergedPaintingPriceSummary) => {
    try {
      if (scoped) {
        await companyCreatePrice.mutateAsync({ brand: price.brand, type: `${price.type} ${copySuffix}`, price: price.price })
      } else {
        await adminCreatePrice.mutateAsync({
          brandId: parseScopedRef(price.brand).id,
          type: `${price.type} ${copySuffix}`,
          price: price.price,
        })
      }
      toast.success(t('messages.createSuccess'))
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onCopyBrand = (brand: MergedPaintBrandSummary) => {
    if (!copyToScope) return
    createBrandForm.reset({ name: `${brand.name} ${copySuffix}` })
    setCreateBrandOpen(true)
  }
  const onCopyPrice = (price: MergedPaintingPriceSummary) => {
    if (!copyToScope) return
    if (!selectedBrand) return
    createPriceForm.reset({ brand: price.brand, type: `${price.type} ${copySuffix}`, price: price.price })
    setCreatePriceOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <h2 className="shrink-0 font-heading text-base font-semibold text-foreground">
        {t('tables.paintingPrices')}
      </h2>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-col gap-3 lg:w-72 lg:shrink-0">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t('tables.paintBrands')}
            </h3>
            <Dialog
              open={createBrandOpen}
              onOpenChange={(next) => {
                setCreateBrandOpen(next)
                if (!next) createBrandForm.reset({ name: '' })
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="size-4" aria-hidden="true" />
                  {t('createButtons.paintBrand')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form
                  onSubmit={(e) => void createBrandForm.handleSubmit(onCreateBrand)(e)}
                  noValidate
                  className="flex flex-col gap-4"
                >
                  <DialogHeader>
                    <DialogTitle>{t('createButtons.paintBrand')}</DialogTitle>
                  </DialogHeader>
                  <div>
                    <Label htmlFor="create-brand-name">{t('fields.name')}</Label>
                    <Input
                      id="create-brand-name"
                      className="mt-1.5"
                      aria-invalid={!!createBrandForm.formState.errors.name}
                      {...createBrandForm.register('name')}
                    />
                    {createBrandForm.formState.errors.name && (
                      <p className="mt-1 text-xs text-destructive">
                        {String(createBrandForm.formState.errors.name.message ?? '')}
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createBrandForm.formState.isSubmitting}>
                      {tCommon('actions.save')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {brandsError && <p className="text-sm text-destructive">{errorLabel}</p>}
          {!brandsLoading && !brandsError && (brands?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">{t('empty.paintBrand')}</p>
          )}
          {(brands?.length ?? 0) > 0 && (
            <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>{t('fields.name')}</TableHead>
                  {rowScope && <TableHead className="w-20">{t('scope.columnHeader')}</TableHead>}
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(brands ?? []).map((brand) => {
                  const editable = rowIsEditable(brand)
                  return (
                  <TableRow
                    key={brand.id}
                    data-state={selectedBrand?.id === brand.id ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedBrandId(brand.id)}
                  >
                    <TableCell>{brand.name}</TableCell>
                    {rowScope && (
                      <TableCell>
                        <span
                          className={
                            rowScope(brand) === 'company'
                              ? 'rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                              : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                          }
                        >
                          {rowScope(brand) === 'company' ? t('scope.ours') : t('scope.platform')}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="flex justify-end gap-1">
                      {editable ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditBrand(brand)
                              editBrandForm.reset({ name: brand.name })
                            }}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title={t('bulk.duplicate')}
                            onClick={(e) => {
                              e.stopPropagation()
                              void onDuplicateBrand(brand)
                            }}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteBrand(brand)
                            }}
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
                            onClick={(e) => {
                              e.stopPropagation()
                              onCopyBrand(brand)
                            }}
                            title={copyToScope.label}
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
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {selectedBrand ? selectedBrand.name : t('tables.paintingPrices')}
            </h3>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedBrand}
              onClick={() => {
                if (!selectedBrand) return
                createPriceForm.reset({ brand: formatScopedRef(selectedBrand.scope, selectedBrand.id), type: '', price: 0 })
                setCreatePriceOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('createButtons.paintingPrice')}
            </Button>
          </div>

          {!selectedBrand ? (
            <p className="text-sm text-muted-foreground">{t('empty.paintBrand')}</p>
          ) : selectedBrandPrices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty.paintingPrice')}</p>
          ) : (
            <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>{t('fields.type')}</TableHead>
                  <TableHead>{t('fields.pricePerKg')}</TableHead>
                  {rowScope && <TableHead className="w-20">{t('scope.columnHeader')}</TableHead>}
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedBrandPrices.map((price) => {
                  const editable = rowIsEditable(price)
                  return (
                  <TableRow key={price.id}>
                    <TableCell>{price.type}</TableCell>
                    <TableCell>{price.price.toFixed(2)}</TableCell>
                    {rowScope && (
                      <TableCell>
                        <span
                          className={
                            rowScope(price) === 'company'
                              ? 'rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                              : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                          }
                        >
                          {rowScope(price) === 'company' ? t('scope.ours') : t('scope.platform')}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="flex justify-end gap-1">
                      {editable ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => {
                              setEditPrice(price)
                              editPriceForm.reset({
                                brand: price.brand,
                                type: price.type,
                                price: price.price,
                              })
                            }}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title={t('bulk.duplicate')}
                            onClick={() => void onDuplicatePrice(price)}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => setDeletePrice(price)}
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
                            onClick={() => onCopyPrice(price)}
                            title={copyToScope.label}
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
          )}
        </div>
      </div>

      <Dialog open={!!editBrand} onOpenChange={(next) => { if (!next) setEditBrand(null) }}>
        <DialogContent>
          <form onSubmit={(e) => void editBrandForm.handleSubmit(onEditBrand)(e)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editBrand?.name ?? ''}</DialogTitle>
            </DialogHeader>
            <div>
              <Label htmlFor="edit-brand-name">{t('fields.name')}</Label>
              <Input
                id="edit-brand-name"
                className="mt-1.5"
                aria-invalid={!!editBrandForm.formState.errors.name}
                {...editBrandForm.register('name')}
              />
              {editBrandForm.formState.errors.name && (
                <p className="mt-1 text-xs text-destructive">
                  {String(editBrandForm.formState.errors.name.message ?? '')}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={editBrandForm.formState.isSubmitting}>
                {tCommon('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteBrand} onOpenChange={(next) => !next && setDeleteBrand(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteBrand ? t('messages.deleteConfirmTitle', { name: deleteBrand.name }) : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('deleteWarnings.paintBrand')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={scoped ? companyDeleteBrand.isPending : adminDeleteBrand.isPending}
              onClick={() => void onDeleteBrand()}
            >
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createPriceOpen} onOpenChange={setCreatePriceOpen}>
        <DialogContent>
          <form onSubmit={(e) => void createPriceForm.handleSubmit(onCreatePrice)(e)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {selectedBrand
                  ? `${t('createButtons.paintingPrice')} · ${selectedBrand.name}`
                  : ''}
              </DialogTitle>
            </DialogHeader>
            <div>
              <Label htmlFor="create-price-brand">{t('fields.brand')}</Label>
              <Controller
                name="brand"
                control={createPriceForm.control}
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger id="create-price-brand" className="mt-1.5 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {brandOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div>
              <Label htmlFor="create-price-type">{t('fields.type')}</Label>
              <Input
                id="create-price-type"
                className="mt-1.5"
                aria-invalid={!!createPriceForm.formState.errors.type}
                {...createPriceForm.register('type')}
              />
              {createPriceForm.formState.errors.type && (
                <p className="mt-1 text-xs text-destructive">
                  {String(createPriceForm.formState.errors.type.message ?? '')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="create-price-price">{t('fields.pricePerKg')}</Label>
              <Input
                id="create-price-price"
                type="number"
                step={0.01}
                min={0}
                className="mt-1.5"
                aria-invalid={!!createPriceForm.formState.errors.price}
                {...createPriceForm.register('price', { valueAsNumber: true })}
              />
              {createPriceForm.formState.errors.price && (
                <p className="mt-1 text-xs text-destructive">
                  {String(createPriceForm.formState.errors.price.message ?? '')}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createPriceForm.formState.isSubmitting}>
                {tCommon('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPrice} onOpenChange={(next) => { if (!next) setEditPrice(null) }}>
        <DialogContent>
          <form onSubmit={(e) => void editPriceForm.handleSubmit(onEditPrice)(e)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editPrice ? `${editPrice.brandName} · ${editPrice.type}` : ''}</DialogTitle>
            </DialogHeader>
            <div>
              <Label htmlFor="edit-price-brand">{t('fields.brand')}</Label>
              <Controller
                name="brand"
                control={editPriceForm.control}
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger id="edit-price-brand" className="mt-1.5 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {brandOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div>
              <Label htmlFor="edit-price-type">{t('fields.type')}</Label>
              <Input
                id="edit-price-type"
                className="mt-1.5"
                aria-invalid={!!editPriceForm.formState.errors.type}
                {...editPriceForm.register('type')}
              />
              {editPriceForm.formState.errors.type && (
                <p className="mt-1 text-xs text-destructive">
                  {String(editPriceForm.formState.errors.type.message ?? '')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="edit-price-price">{t('fields.pricePerKg')}</Label>
              <Input
                id="edit-price-price"
                type="number"
                step={0.01}
                min={0}
                className="mt-1.5"
                aria-invalid={!!editPriceForm.formState.errors.price}
                {...editPriceForm.register('price', { valueAsNumber: true })}
              />
              {editPriceForm.formState.errors.price && (
                <p className="mt-1 text-xs text-destructive">
                  {String(editPriceForm.formState.errors.price.message ?? '')}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={editPriceForm.formState.isSubmitting}>
                {tCommon('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePrice} onOpenChange={(next) => !next && setDeletePrice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletePrice
                ? t('messages.deleteConfirmTitle', {
                    name: `${deletePrice.brandName} · ${deletePrice.type}`,
                  })
                : ''}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={scoped ? companyDeletePrice.isPending : adminDeletePrice.isPending}
              onClick={() => void onDeletePrice()}
            >
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
