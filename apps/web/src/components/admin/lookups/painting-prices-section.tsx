import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createPaintBrandSchema,
  updatePaintBrandSchema,
  createPaintingPriceSchema,
  updatePaintingPriceSchema,
  type CreatePaintBrandInput,
  type UpdatePaintBrandInput,
  type CreatePaintingPriceInput,
  type UpdatePaintingPriceInput,
  type PaintBrandSummary,
  type PaintingPriceSummary,
} from '@repo/types/lookups'
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

// Merged brand + price screen, side by side: a brand table on the left,
// a price table for the selected brand on the right (master-detail,
// rather than a stacked/accordion layout) — clicking a brand "groups"
// the right-hand table down to just that brand's prices. Doesn't reuse
// SimpleLookupSection — that component is shared by four other tabs and
// is built around a single flat table with bulk actions; this is a
// two-table master-detail view instead. Bulk select/duplicate/delete
// (available on the old flat price table) is deliberately dropped —
// single-row create/edit/delete for both brands and prices is fully
// preserved.
export function PaintingPricesSection() {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('admin')
  const errorLabel = t('dataWarehousePage.messages.error')

  const { data: brands, isLoading: brandsLoading, isError: brandsError } = usePaintBrandsQuery()
  const { data: prices } = usePaintingPricesQuery()

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [createBrandOpen, setCreateBrandOpen] = useState(false)
  const [editBrand, setEditBrand] = useState<PaintBrandSummary | null>(null)
  const [deleteBrand, setDeleteBrand] = useState<PaintBrandSummary | null>(null)
  const [createPriceOpen, setCreatePriceOpen] = useState(false)
  const [editPrice, setEditPrice] = useState<PaintingPriceSummary | null>(null)
  const [deletePrice, setDeletePrice] = useState<PaintingPriceSummary | null>(null)

  const createBrandMutation = useCreatePaintBrandMutation()
  const updateBrandMutation = useUpdatePaintBrandMutation(editBrand?.id ?? '')
  const deleteBrandMutation = useDeletePaintBrandMutation(deleteBrand?.id ?? '')
  const createPriceMutation = useCreatePaintingPriceMutation()
  const updatePriceMutation = useUpdatePaintingPriceMutation(editPrice?.id ?? '')
  const deletePriceMutation = useDeletePaintingPriceMutation(deletePrice?.id ?? '')

  const createBrandForm = useForm<CreatePaintBrandInput>({
    resolver: zodResolver(createPaintBrandSchema),
    defaultValues: { name: '' },
  })
  const editBrandForm = useForm<UpdatePaintBrandInput>({
    resolver: zodResolver(updatePaintBrandSchema),
  })
  const createPriceForm = useForm<CreatePaintingPriceInput>({
    resolver: zodResolver(createPaintingPriceSchema),
    defaultValues: { brandId: '', type: '', price: 0 },
  })
  const editPriceForm = useForm<UpdatePaintingPriceInput>({
    resolver: zodResolver(updatePaintingPriceSchema),
  })

  const brandOptions = (brands ?? []).map((b) => ({ value: b.id, label: b.name }))
  // Falls back to the first brand whenever nothing is selected yet, or the
  // previously-selected brand no longer exists (e.g. it was just deleted)
  // — avoids a stale id in state without needing a useEffect to reconcile it.
  const selectedBrand =
    (brands ?? []).find((b) => b.id === selectedBrandId) ?? (brands ?? [])[0] ?? null
  const selectedBrandPrices = (prices ?? []).filter((p) => p.brandId === selectedBrand?.id)

  const onCreateBrand = async (values: CreatePaintBrandInput) => {
    try {
      const brand = await createBrandMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.createSuccess'))
      createBrandForm.reset({ name: '' })
      setCreateBrandOpen(false)
      setSelectedBrandId(brand.id)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onEditBrand = async (values: UpdatePaintBrandInput) => {
    try {
      await updateBrandMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.updateSuccess'))
      setEditBrand(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDeleteBrand = async () => {
    try {
      await deleteBrandMutation.mutateAsync()
      toast.success(t('dataWarehousePage.messages.deleteSuccess'))
      setDeleteBrand(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onCreatePrice = async (values: CreatePaintingPriceInput) => {
    try {
      await createPriceMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.createSuccess'))
      setCreatePriceOpen(false)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onEditPrice = async (values: UpdatePaintingPriceInput) => {
    try {
      await updatePriceMutation.mutateAsync(values)
      toast.success(t('dataWarehousePage.messages.updateSuccess'))
      setEditPrice(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  const onDeletePrice = async () => {
    try {
      await deletePriceMutation.mutateAsync()
      toast.success(t('dataWarehousePage.messages.deleteSuccess'))
      setDeletePrice(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, errorLabel))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <h2 className="shrink-0 font-heading text-base font-semibold text-foreground">
        {t('dataWarehousePage.tables.paintingPrices')}
      </h2>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-col gap-3 lg:w-72 lg:shrink-0">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t('dataWarehousePage.tables.paintBrands')}
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
                  {t('dataWarehousePage.createButtons.paintBrand')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form
                  onSubmit={(e) => void createBrandForm.handleSubmit(onCreateBrand)(e)}
                  noValidate
                  className="flex flex-col gap-4"
                >
                  <DialogHeader>
                    <DialogTitle>{t('dataWarehousePage.createButtons.paintBrand')}</DialogTitle>
                  </DialogHeader>
                  <div>
                    <Label htmlFor="create-brand-name">{t('dataWarehousePage.fields.name')}</Label>
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
            <p className="text-sm text-muted-foreground">{t('dataWarehousePage.empty.paintBrand')}</p>
          )}
          {(brands?.length ?? 0) > 0 && (
            <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>{t('dataWarehousePage.fields.name')}</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(brands ?? []).map((brand) => (
                  <TableRow
                    key={brand.id}
                    data-state={selectedBrand?.id === brand.id ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelectedBrandId(brand.id)}
                  >
                    <TableCell>{brand.name}</TableCell>
                    <TableCell className="flex justify-end gap-1">
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
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteBrand(brand)
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {selectedBrand ? selectedBrand.name : t('dataWarehousePage.tables.paintingPrices')}
            </h3>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedBrand}
              onClick={() => {
                if (!selectedBrand) return
                createPriceForm.reset({ brandId: selectedBrand.id, type: '', price: 0 })
                setCreatePriceOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('dataWarehousePage.createButtons.paintingPrice')}
            </Button>
          </div>

          {!selectedBrand ? (
            <p className="text-sm text-muted-foreground">{t('dataWarehousePage.empty.paintBrand')}</p>
          ) : selectedBrandPrices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dataWarehousePage.empty.paintingPrice')}</p>
          ) : (
            <Table containerClassName="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>{t('dataWarehousePage.fields.type')}</TableHead>
                  <TableHead>{t('dataWarehousePage.fields.pricePerKg')}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedBrandPrices.map((price) => (
                  <TableRow key={price.id}>
                    <TableCell>{price.type}</TableCell>
                    <TableCell>{price.price.toFixed(2)}</TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setEditPrice(price)
                          editPriceForm.reset({
                            brandId: price.brandId,
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
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeletePrice(price)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
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
              <Label htmlFor="edit-brand-name">{t('dataWarehousePage.fields.name')}</Label>
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
              {deleteBrand ? t('dataWarehousePage.messages.deleteConfirmTitle', { name: deleteBrand.name }) : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('dataWarehousePage.deleteWarnings.paintBrand')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={deleteBrandMutation.isPending} onClick={() => void onDeleteBrand()}>
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
                  ? `${t('dataWarehousePage.createButtons.paintingPrice')} · ${selectedBrand.name}`
                  : ''}
              </DialogTitle>
            </DialogHeader>
            <div>
              <Label htmlFor="create-price-type">{t('dataWarehousePage.fields.type')}</Label>
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
              <Label htmlFor="create-price-price">{t('dataWarehousePage.fields.pricePerKg')}</Label>
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
              <Label htmlFor="edit-price-brand">{t('dataWarehousePage.fields.brand')}</Label>
              <Controller
                name="brandId"
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
              <Label htmlFor="edit-price-type">{t('dataWarehousePage.fields.type')}</Label>
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
              <Label htmlFor="edit-price-price">{t('dataWarehousePage.fields.pricePerKg')}</Label>
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
                ? t('dataWarehousePage.messages.deleteConfirmTitle', {
                    name: `${deletePrice.brandName} · ${deletePrice.type}`,
                  })
                : ''}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={deletePriceMutation.isPending} onClick={() => void onDeletePrice()}>
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
