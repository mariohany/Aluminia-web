import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * `Input type="password"` plus a show/hide toggle. A thin wrapper
 * rather than a change to `Input` itself, since every other input type
 * has no use for the toggle — this one only renders it because `type`
 * is fixed to password/text internally.
 *
 * `common.json`'s `password.show`/`hide`, not the caller's own i18n
 * namespace: this is a shared UI primitive used from pages with
 * different active namespaces (login, admin, workspace), so it can't
 * assume any one of them is loaded.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<typeof Input>, 'type'>>(
  function PasswordInput({ className, ...props }, ref) {
    const { t } = useTranslation()
    const [visible, setVisible] = React.useState(false)

    return (
      // The caller's className (typically spacing, e.g. `mt-1.5`) goes
      // on this wrapper, not the input inside it: `<input>` is a
      // replaced element, so a margin on it doesn't collapse into a
      // plain wrapper div the way it would between two block boxes —
      // it just inflates the wrapper, which then throws off the
      // toggle button's `inset-y-0` centering against the input's
      // actual (shorter) box.
      <div className={cn('relative', className)}>
        <Input ref={ref} type={visible ? 'text' : 'password'} className="pe-9" {...props} />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute inset-y-0 end-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
          aria-label={t(visible ? 'password.hide' : 'password.show')}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    )
  },
)
