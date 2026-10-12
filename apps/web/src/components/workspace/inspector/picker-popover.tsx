import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PropertyValueButton } from '@/components/workspace/inspector/property-controls'

/**
 * A picker row's value + the popover it opens —
 * docs/inspector_redesign_planing.md §1/§4: every picker in the
 * inspector sits closed as one row and opens on click, instead of
 * standing open in the panel. `children` gets `close` so a pick can
 * shut it.
 */
export function PickerPopover({
  id,
  button,
  contentClassName,
  children,
}: {
  id?: string
  button: Omit<React.ComponentProps<typeof PropertyValueButton>, 'id'>
  contentClassName?: string
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PropertyValueButton id={id} aria-haspopup="dialog" {...button} />
      </PopoverTrigger>
      {/* Radix aligns by physical side — the inspector is on the right in
          LTR and the left in RTL, so grow inward either way (CLAUDE.md). */}
      <PopoverContent align={isRtl ? 'start' : 'end'} className={cn('w-80 p-2', contentClassName)}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

export interface ColourOption {
  value: string
  label: string
  hex: string
}

/** A colour swatch — every colour selector shows one next to its code
 * (standing convention). */
export function Swatch({ hex, className }: { hex: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-3 w-4.5 shrink-0 rounded-[3px] border border-border', !hex && 'bg-transparent', className)}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  )
}

/** The colour popover's list: "None" first, then every RAL option. */
export function ColourList({
  value,
  options,
  noneLabel,
  onPick,
}: {
  value: string | null
  options: ColourOption[]
  noneLabel: string
  onPick: (value: string | null) => void
}) {
  const { t } = useTranslation('workspace')
  const rows: { value: string | null; label: string; hex: string | null }[] = [
    { value: null, label: noneLabel, hex: null },
    ...options.map((o) => ({ value: o.value, label: o.label, hex: o.hex })),
  ]
  return (
    <div role="listbox" aria-label={t('windowDialog.inspector.groups.finish')} className="flex max-h-80 flex-col overflow-y-auto">
      {rows.map((row) => {
        const selected = row.value === value
        return (
          <button
            key={row.value ?? '__none'}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onPick(row.value)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-start text-[12.5px] outline-none hover:bg-accent focus-visible:bg-accent',
              selected && 'bg-primary/10 font-medium text-primary',
            )}
          >
            <Swatch hex={row.hex} />
            <span className="flex-1 truncate">{row.label}</span>
            {selected && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}
