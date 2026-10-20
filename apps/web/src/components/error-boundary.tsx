import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/monitoring'
import { cn } from '@/lib/utils'

/**
 * Catches an error thrown while drawing its children and shows a message
 * with Reload in their place. Without one, React removes the whole app
 * and the user sees a blank white page — again on every refresh, since
 * the URL brings back the same screen. `page` fills the viewport (the
 * app's last line); `section` fills only the part of the screen it wraps,
 * so the rail and menus stay usable. Remount it with a `key` to clear it.
 */
export class ErrorBoundary extends Component<
  { variant: 'page' | 'section'; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    reportError(error, {
      area: 'screen',
      tags: { boundary: this.props.variant },
      extra: { componentStack: info.componentStack },
    })
  }

  render() {
    if (this.state.error) return <CrashMessage variant={this.props.variant} error={this.state.error} />
    return this.props.children
  }
}

function CrashMessage({ variant, error }: { variant: 'page' | 'section'; error: Error }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center justify-center p-6',
        variant === 'page' ? 'min-h-svh bg-background' : 'h-full min-h-60',
      )}
    >
      <div
        role="alert"
        className="flex w-[min(420px,100%)] flex-col gap-3 rounded-xl border border-destructive/40 bg-card p-5 shadow-lg"
      >
        <p className="flex items-start gap-2 text-sm font-semibold text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('crash.title')}
        </p>
        <p className="text-[13px] text-muted-foreground">{t('crash.body')}</p>
        {/* The browser's own message, so a user can send it to us. */}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('crash.details')}</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] break-words whitespace-pre-wrap" dir="ltr">
            {error.name}: {error.message}
          </pre>
        </details>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => window.location.reload()}>
            {t('crash.reload')}
          </Button>
        </div>
      </div>
    </div>
  )
}
