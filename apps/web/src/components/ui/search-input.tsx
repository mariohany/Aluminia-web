import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchInputProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
  /** Renders a leading search icon (`ps-8` on the input) — off by default. */
  icon?: boolean
}

/**
 * `Input` plus a trailing clear (×) button, shown only once there's
 * something to clear. Same wrapper shape as `PasswordInput`: the
 * caller's `className` (spacing) goes on the wrapper, sizing classes
 * stay on the input itself.
 *
 * `common.json`'s `actions.clearSearch`, not the caller's own
 * namespace — this is a shared primitive used from pages with
 * different active namespaces (workspace, lookups, admin).
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, icon, className, ...props },
  ref,
) {
  const { t } = useTranslation()
  const innerRef = React.useRef<HTMLInputElement>(null)
  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement)

  return (
    <div className={cn('relative', className)}>
      {icon && (
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      <Input
        ref={innerRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(icon && 'ps-8', value && 'pe-8')}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('')
            innerRef.current?.focus()
          }}
          className="absolute inset-y-0 end-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
          aria-label={t('actions.clearSearch')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
})
