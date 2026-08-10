import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import type { SystemsImportEntityResult, SystemsImportResult } from '@repo/types/lookups'
import { apiErrorMessage } from '@/lib/api-client'
import * as lookupsApi from '@/lib/lookups-api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Mounted on all three Systems tabs (System brands/catalogues/profiles)
// via SimpleLookupSection's `headerExtra` slot — wherever you are in the
// Systems cluster, this is the same button, doing the same 3-sheet
// import. Each table's result is independent since each is its own
// lookup_meta version (see SystemLookupsService.importSystems).
export function SystemsImportButton() {
  const { t } = useTranslation('admin')
  const queryClient = useQueryClient()
  const [result, setResult] = useState<SystemsImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const importResult = await lookupsApi.importSystems(file)
      setResult(importResult)
      await queryClient.invalidateQueries({ queryKey: ['lookups'] })
      toast.success(t('dataWarehousePage.systemsImport.success'))
    } catch (err) {
      toast.error(apiErrorMessage(err, t('dataWarehousePage.systemsImport.error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={(e) => void onFileSelected(e)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        title={t('dataWarehousePage.systemsImport.description')}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" aria-hidden="true" />
        {busy ? t('dataWarehousePage.systemsImport.importing') : t('dataWarehousePage.systemsImport.button')}
      </Button>

      <Dialog open={!!result} onOpenChange={(next) => !next && setResult(null)}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dataWarehousePage.systemsImport.resultTitle')}</DialogTitle>
          </DialogHeader>
          {result && (
            <div className="flex flex-col gap-4 text-sm">
              <EntitySection title={t('dataWarehousePage.tables.systemBrands')} result={result.brands} />
              <EntitySection title={t('dataWarehousePage.tables.systemCatalogs')} result={result.catalogs} />
              <EntitySection title={t('dataWarehousePage.tables.systemProfiles')} result={result.profiles} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>{t('dataWarehousePage.systemsImport.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EntitySection({ title, result }: { title: string; result: SystemsImportEntityResult }) {
  const { t } = useTranslation('admin')
  const untouched =
    result.created.length === 0 &&
    result.updated.length === 0 &&
    result.unchangedCount === 0 &&
    result.errors.length === 0
  if (untouched) return null

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-3">
      <p className="font-medium text-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {result.created.length > 0 && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            {t('dataWarehousePage.systemsImport.created', { count: result.created.length })}
          </span>
        )}
        {result.updated.length > 0 && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            {t('dataWarehousePage.systemsImport.updated', { count: result.updated.length })}
          </span>
        )}
        {result.unchangedCount > 0 && (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {t('dataWarehousePage.systemsImport.unchanged', { count: result.unchangedCount })}
          </span>
        )}
      </div>
      {result.errors.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-destructive">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
