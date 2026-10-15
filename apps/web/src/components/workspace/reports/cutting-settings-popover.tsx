import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import {
  CUTTING_LIMITS,
  DEFAULT_STOCK_LENGTHS_MM,
  type CuttingSettings,
} from '@repo/types/reports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSaveCuttingSettingsMutation } from '@/lib/reports-queries'

/**
 * The company's cutting settings, edited from the report itself — the
 * only place they are edited (docs/reports_planing.md D9), by any
 * company user (D10). 6000 / 6500 are always tried (D7); added lengths
 * can be removed. Saving makes every project's report stale, then
 * `onSaved` regenerates this one.
 */
export function CuttingSettingsPopover({
  settings,
  onSaved,
}: {
  settings: CuttingSettings
  onSaved: () => void
}) {
  const { t } = useTranslation('reports')
  const [open, setOpen] = useState(false)
  const [extras, setExtras] = useState<number[]>([])
  const [kerf, setKerf] = useState('')
  const [trim, setTrim] = useState('')
  const [newLength, setNewLength] = useState('')
  const [lengthError, setLengthError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const save = useSaveCuttingSettingsMutation()

  // Fresh copy of the saved settings each time it opens.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setExtras(settings.extraLengthsMm)
      setKerf(String(settings.kerfMm))
      setTrim(String(settings.endTrimMm))
      setNewLength('')
      setLengthError(null)
      setSubmitted(false)
      save.reset()
    }
    setOpen(next)
  }

  const kerfValue = Number(kerf)
  const kerfValid =
    kerf.trim() !== '' &&
    Number.isFinite(kerfValue) &&
    kerfValue >= CUTTING_LIMITS.kerfMm.min &&
    kerfValue <= CUTTING_LIMITS.kerfMm.max &&
    Number.isInteger(kerfValue / CUTTING_LIMITS.kerfMm.step)
  const trimValue = Number(trim)
  const trimValid =
    trim.trim() !== '' &&
    Number.isInteger(trimValue) &&
    trimValue >= CUTTING_LIMITS.endTrimMm.min &&
    trimValue <= CUTTING_LIMITS.endTrimMm.max

  const addLength = () => {
    const value = Number(newLength)
    if (
      !Number.isInteger(value) ||
      value < CUTTING_LIMITS.stockLengthMm.min ||
      value > CUTTING_LIMITS.stockLengthMm.max
    ) {
      setLengthError(t('settings.errors.lengthRange'))
      return
    }
    if ((DEFAULT_STOCK_LENGTHS_MM as readonly number[]).includes(value) || extras.includes(value)) {
      setLengthError(t('settings.errors.lengthDuplicate'))
      return
    }
    if (extras.length >= CUTTING_LIMITS.maxExtraLengths) {
      setLengthError(t('settings.errors.tooMany'))
      return
    }
    setExtras([...extras, value].sort((a, b) => b - a))
    setNewLength('')
    setLengthError(null)
  }

  const submit = () => {
    setSubmitted(true)
    if (!kerfValid || !trimValid) return
    save.mutate(
      { kerfMm: kerfValue, endTrimMm: trimValue, extraLengthsMm: extras },
      {
        onSuccess: () => {
          setOpen(false)
          onSaved()
        },
      },
    )
  }

  const chip = 'inline-flex h-7.5 items-center gap-1.5 rounded-lg border ps-2.5 pe-1.5 font-mono text-[13px] font-semibold'

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
          {t('editSettings')}
        </Button>
      </PopoverTrigger>
      {/* Radix places by physical side: open toward the reading end. */}
      <PopoverContent
        align={document.documentElement.dir === 'rtl' ? 'end' : 'start'}
        className="w-[380px] max-w-[calc(100vw-2rem)] gap-0 p-0"
      >
        <div className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{t('settings.title')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.scope')}</p>
        </div>

        <div className="flex flex-col gap-4 px-4 py-3.5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cutting-new-length" className="text-[12.5px]">
              {t('settings.lengths')}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {[...DEFAULT_STOCK_LENGTHS_MM]
                .sort((a, b) => b - a)
                .map((length) => (
                  <span key={length} className={`${chip} border-border bg-muted pe-2.5`}>
                    {length}
                    <span className="font-sans text-[10.5px] font-normal text-muted-foreground">
                      {t('settings.default')}
                    </span>
                  </span>
                ))}
              {extras.map((length) => (
                <span key={length} className={`${chip} border-primary bg-primary/10`}>
                  {length}
                  <button
                    type="button"
                    aria-label={t('settings.remove', { length })}
                    onClick={() => setExtras(extras.filter((l) => l !== length))}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <Input
                  id="cutting-new-length"
                  inputMode="numeric"
                  value={newLength}
                  onChange={(event) => {
                    setNewLength(event.target.value)
                    setLengthError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addLength()
                    }
                  }}
                  placeholder={t('settings.addPlaceholder')}
                  aria-label={t('settings.newLength')}
                  aria-invalid={!!lengthError}
                  className="h-7.5 w-32 pe-9 font-mono"
                />
                <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-[11px] text-muted-foreground">
                  {t('settings.mm')}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-7.5" onClick={addLength}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t('settings.add')}
              </Button>
            </div>
            {lengthError ? (
              <p className="text-xs text-destructive">{lengthError}</p>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">{t('settings.hint')}</p>
            )}
          </div>

          <div className="flex gap-4">
            <NumberField
              id="cutting-kerf"
              label={t('settings.kerf')}
              unit={t('settings.mm')}
              value={kerf}
              onChange={setKerf}
              error={submitted && !kerfValid ? t('settings.errors.kerf') : null}
            />
            <NumberField
              id="cutting-trim"
              label={t('settings.trim')}
              unit={t('settings.mmPerEnd')}
              value={trim}
              onChange={setTrim}
              error={submitted && !trimValid ? t('settings.errors.trim') : null}
            />
          </div>
          {save.isError && <p className="text-xs text-destructive">{t('settings.errors.save')}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t('settings.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={submit} disabled={save.isPending}>
            {t('settings.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  error,
}: {
  id: string
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label htmlFor={id} className="text-[12.5px]">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!!error}
          className="h-8 pe-14 font-mono"
        />
        <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-[11px] text-muted-foreground">
          {unit}
        </span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
