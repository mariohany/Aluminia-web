import { useState } from 'react'
import { ChevronDown, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The property sheet's value controls — docs/inspector_redesign_planing.md
 * §1. They share one look: a 30px muted fill with no border until
 * hover/focus, so a group reads as a list of values rather than a stack
 * of form boxes.
 */

const FIELD = 'h-7.5 w-full min-w-0 rounded-md bg-muted outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The value of a picker row — a button that opens its popover (pass it
 * as a `PopoverTrigger asChild` child). A lead glyph (swatch, opening
 * icon, glass layers), the value, a muted sub-label, a ★ when it is the
 * favourite.
 */
export function PropertyValueButton({
  lead,
  value,
  placeholder,
  sub,
  favourite = false,
  mono = true,
  invalid = false,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value'> & {
  lead?: React.ReactNode
  value: React.ReactNode
  placeholder?: string
  sub?: React.ReactNode
  favourite?: boolean
  mono?: boolean
  invalid?: boolean
}) {
  const empty = value === null || value === undefined || value === ''
  return (
    <button
      type="button"
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD,
        'flex items-center gap-2 px-2 text-start text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-destructive',
        className,
      )}
      {...props}
    >
      {lead && <span className="flex shrink-0 items-center">{lead}</span>}
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap">
        <span className={cn('truncate', mono && !empty && 'font-mono', empty && 'text-muted-foreground')}>{empty ? placeholder : value}</span>
        {favourite && <Star className="size-3 shrink-0 fill-primary text-primary" aria-hidden="true" />}
        {sub && <span className="ms-1 truncate text-[11.5px] text-muted-foreground">{sub}</span>}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

/**
 * A number with its unit, committed on Enter or blur — never per key, so
 * typing "1500" doesn't resize through 1, 15 and 150 (the same rule as
 * the divider position field). Re-seeds when the value changes from
 * elsewhere (a drag, undo). Empty or invalid input snaps back.
 */
export function PropertyNumber({
  id,
  value,
  onCommit,
  unit = 'mm',
  min = 1,
  max,
  disabled = false,
  invalid = false,
  placeholder,
}: {
  id: string
  value: number | null
  onCommit: (value: number) => void
  unit?: string
  min?: number
  max?: number
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
}) {
  const shown = value !== null && Number.isFinite(value) ? String(value) : ''
  const [draft, setDraft] = useState(shown)
  // Re-seed during render (not in an effect) when the value moves from
  // elsewhere — React's "adjust state on prop change" pattern.
  const [seededFrom, setSeededFrom] = useState(shown)
  if (seededFrom !== shown) {
    setSeededFrom(shown)
    setDraft(shown)
  }

  const commit = () => {
    const parsed = Number(draft)
    const ok = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= min && (max === undefined || parsed <= max)
    if (ok && parsed !== value) onCommit(parsed)
    else if (!ok) setDraft(shown)
  }

  return (
    <span
      className={cn(
        FIELD,
        'flex items-center gap-1 px-2 focus-within:ring-2 focus-within:ring-ring',
        disabled && 'opacity-50',
        invalid && 'ring-1 ring-destructive',
      )}
    >
      <input
        id={id}
        type="number"
        dir="ltr"
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setDraft(shown)
          }
        }}
        className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none [appearance:textfield] disabled:cursor-not-allowed [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
    </span>
  )
}

/** An on/off switch — Door, Fly screen. Labelled by its row. */
export function PropertySwitch({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  title,
  ...aria
}: {
  id?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Why it's disabled — a native tooltip. */
  title?: string
  'aria-label'?: string
}) {
  return (
    <span className="flex w-full px-1">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        title={title}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        )}
        {...aria}
      >
        <span
          className={cn(
            'block size-4 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-4.5 rtl:-translate-x-4.5' : 'translate-x-0.5 rtl:-translate-x-0.5',
          )}
        />
      </button>
    </span>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Shown instead of the label (the label becomes its aria-label/title). */
  icon?: React.ReactNode
  disabled?: boolean
  /** Tooltip while disabled. */
  disabledReason?: string
}

/** A one-of-few choice — Fixed / Opening, the head shapes. */
export function PropertySegment<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string
  /** The group's accessible name (its row label). */
  label: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
}) {
  return (
    <div id={id} role="group" aria-label={label} className="flex h-7.5 w-full gap-0.5 rounded-md bg-muted p-0.5">
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            aria-label={opt.icon ? opt.label : undefined}
            title={opt.disabled ? opt.disabledReason : opt.icon ? opt.label : undefined}
            disabled={opt.disabled}
            // Re-picking the selected option is a no-op, so a handler that
            // writes fresh defaults (head shape → rise) can't clobber edits.
            onClick={() => {
              if (!selected) onChange(opt.value)
            }}
            className={cn(
              'flex flex-1 items-center justify-center rounded-[5px] text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
              selected ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.icon ?? opt.label}
          </button>
        )
      })}
    </div>
  )
}
