import * as Sentry from '@sentry/react'
import type { ErrorEvent } from '@sentry/react'

// What the browser sends to Sentry (docs/sentry_planing.md §4.1, §5, §7,
// §8). The only file that imports @sentry/react, besides the lazily
// loaded monitoring-replay.ts. No VITE_SENTRY_DSN (laptops, CI) = off, and
// every function here does nothing.

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined
// Our own address (Q4), which Vercel forwards to Sentry, so ad blockers
// don't drop the report. `none` sends straight to Sentry (local checks).
const TUNNEL = (import.meta.env.VITE_SENTRY_TUNNEL as string | undefined) ?? '/api/monitoring'

/** Our own limit (§7.2; the free plan has none per key): one broken
 * screen being refreshed can't use up the month's 5,000. */
const MAX_EVENTS_PER_PAGE_LOAD = 10
let sentThisPageLoad = 0
const sentErrors = new Set<string>()

export function initMonitoring(): void {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined,
    // The git commit, passed in by vite.config.ts on Vercel.
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tunnel: TUNNEL === 'none' ? undefined : TUNNEL,
    // Collect nothing about the user or the requests (§8) except the
    // browser's User-Agent: which browser and version failed is the point
    // (bug-121). The user id is set by hand (setMonitoringUser).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    // Errors only, no tracing (Q6). Replay only around an error (Q3).
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    // Noise that isn't ours to fix (§7.3).
    ignoreErrors: ['ResizeObserver loop', 'AbortError', 'The operation was aborted', 'Non-Error promise rejection captured'],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari(-web)?-extension:\/\//],
    beforeSend,
  })
  // The replay recorder is the biggest part of Sentry; load it after the
  // app has started so the first page load doesn't wait for it.
  void import('./monitoring-replay')
    .then(({ replay }) => Sentry.addIntegration(replay()))
    .catch(() => undefined)
}

export interface ReportContext {
  /** Where it happened: `screen`, `pdf-draw`, `solve`, `api`. */
  area: string
  tags?: Record<string, string | number>
  extra?: Record<string, unknown>
}

/** Reports a failure the app caught itself (uncaught ones go
 * automatically). */
export function reportError(error: unknown, context: ReportContext): void {
  if (!Sentry.isInitialized()) return
  Sentry.captureException(error, {
    tags: { area: context.area, ...context.tags },
    extra: context.extra,
  })
}

/** Who the errors belong to (Q5): ids and role only, never the email. */
export function setMonitoringUser(user: { id: string; companyId: string | null; role: string } | null): void {
  if (!Sentry.isInitialized()) return
  Sentry.setUser(user ? { id: user.id } : null)
  Sentry.setTags({ companyId: user?.companyId ?? undefined, role: user?.role ?? undefined })
}

/** The cap, then the scrub: nothing secret, and no search terms, leave the
 * browser in the error itself. (The replay shows the screen as it was: Q3.) */
function beforeSend(event: ErrorEvent): ErrorEvent | null {
  const exception = event.exception?.values?.at(-1)
  const key = `${exception?.type ?? ''}: ${exception?.value ?? event.message ?? ''}`
  if (sentErrors.has(key) || sentThisPageLoad >= MAX_EVENTS_PER_PAGE_LOAD) return null
  sentErrors.add(key)
  sentThisPageLoad++
  return scrubEvent(event)
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies
    delete event.request.data
    delete event.request.query_string
    if (event.request.url) event.request.url = withoutQuery(event.request.url)
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {}
  if (event.message) event.message = withoutQuery(event.message)
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = withoutQuery(exception.value)
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.url === 'string') crumb.data.url = withoutQuery(crumb.data.url)
    if (typeof crumb.data?.to === 'string') crumb.data.to = withoutQuery(crumb.data.to)
    if (typeof crumb.data?.from === 'string') crumb.data.from = withoutQuery(crumb.data.from)
  }
  return event
}

/** `/clients?q=Villa` → `/clients`, anywhere in a text. */
function withoutQuery(text: string): string {
  return text.replace(/(\/[^\s?]*)\?[^\s'"]*/g, '$1')
}
