import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';

// What the API sends to Sentry (docs/sentry_planing.md §4.2, §7, §8). The
// only file besides instrument.ts that imports @sentry/nestjs. Without a
// DSN Sentry was never started, and every call here does nothing.

/** Crashes and every 5xx, and of the 4xx only 400 and 404 (Mario,
 * 2026-10-21). 401, 403, 409, 413, 422 and 429 are the app working. */
export function shouldReport(status: number): boolean {
  return status >= 500 || status === 400 || status === 404;
}

export interface FailureContext {
  status: number;
  method: string;
  /** The matched route pattern (`/projects/:id`), never the raw URL. */
  route: string;
  requestId?: string;
  userId?: string;
  companyId?: string | null;
  role?: string;
  /** The machine-readable reason the client got, if any. */
  code?: string;
}

/**
 * Our own limit (§7.2): the free plan has no per-key rate limit, so one
 * bug repeated by many users, or a bot asking for missing pages, could use
 * up the month's 5,000. Per process and per clock hour: at most
 * `PER_HOUR` events, and at most `PER_KEY_PER_HOUR` for the same
 * route + status. Past it, the pino log line is the only record.
 */
export class FailureCap {
  static readonly PER_HOUR = 100;
  static readonly PER_KEY_PER_HOUR = 10;
  private hour = -1;
  private total = 0;
  private readonly perKey = new Map<string, number>();

  allow(key: string, now: number): boolean {
    const hour = Math.floor(now / 3_600_000);
    if (hour !== this.hour) {
      this.hour = hour;
      this.total = 0;
      this.perKey.clear();
    }
    const forKey = this.perKey.get(key) ?? 0;
    if (
      this.total >= FailureCap.PER_HOUR ||
      forKey >= FailureCap.PER_KEY_PER_HOUR
    ) {
      return false;
    }
    this.total++;
    this.perKey.set(key, forKey + 1);
    return true;
  }
}

const cap = new FailureCap();

/** Sends one failed request to Sentry: crashes and 5xx as `error`,
 * grouped by their stack; 400 / 404 as `warning`, one issue per method +
 * route + status + code however often it happens. */
export function reportFailure(
  exception: unknown,
  context: FailureContext,
  now = Date.now(),
): void {
  if (!Sentry.isInitialized() || !shouldReport(context.status)) return;
  const key = `${context.method} ${context.route} ${context.status}`;
  if (!cap.allow(key, now)) return;

  const serverError = context.status >= 500;
  Sentry.withScope((scope) => {
    scope.setLevel(serverError ? 'error' : 'warning');
    if (context.userId) scope.setUser({ id: context.userId });
    scope.setTags({
      status: context.status,
      route: `${context.method} ${context.route}`,
      ...(context.requestId && { requestId: context.requestId }),
      ...(context.companyId && { companyId: context.companyId }),
      ...(context.role && { role: context.role }),
      ...(context.code && { code: context.code }),
    });
    if (!serverError) {
      scope.setFingerprint([
        'http',
        String(context.status),
        context.method,
        context.route,
        context.code ?? '',
      ]);
    }
    Sentry.captureException(exception);
  });
}

/** The API refused to start (pending migrations): sent before the process
 * exits, so a broken deploy shows up in Sentry and not only in Render's log. */
export async function reportFatal(message: string): Promise<void> {
  if (!Sentry.isInitialized()) return;
  Sentry.captureMessage(message, 'fatal');
  await Sentry.flush(2000);
}

/**
 * `beforeSend` (§8): nothing personal or secret leaves the server. No
 * request body (it can hold names, prices, passwords), no cookies, no
 * headers (`Authorization`), no query string — also cut out of URLs and
 * messages (Nest's 404 says "Cannot GET /x?q=<a search>") —, no stack
 * frame's local variables, and only the user's id. instrument.ts already
 * tells Sentry not to collect these; this is the second guard.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
  }
  if (event.message) event.message = withoutQuery(event.message);
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = withoutQuery(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  return event;
}

/** `/no-such-page?q=Villa` → `/no-such-page`, anywhere in a text. */
function withoutQuery(text: string): string {
  return text.replace(/(\/[^\s?]*)\?[^\s'"]*/g, '$1');
}
