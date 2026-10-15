import type { LoginResponse } from '@repo/types/auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`API error ${status}`)
    this.status = status
    this.body = body
  }
}

// The global exception filter always shapes error bodies as
// `{ message, ... }`. Surfacing that message (a validation failure, a
// business-rule rejection like "already archived") is more useful to the
// admin than a generic "something went wrong" — fall back to that only
// when the body doesn't have one.
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object' && 'message' in err.body) {
    const message = (err.body as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return fallback
}

let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

// One refresh in flight per tab, ever: a burst of 401s and the session
// restore on page load all queue behind the same call. This is not just
// a request-count optimisation — the refresh token is single-use and
// rotates, so two parallel calls would each rotate it and one of them
// would be left holding a token the server has already replaced. The
// server keeps the rotated-away token valid for a short grace window to
// cover the same race *across* tabs, which this can't see.
let refreshPromise: Promise<LoginResponse | null> | null = null

// Told the outcome of every refresh, including the silent ones behind a
// 401 retry: the new user when it worked — the API refuses a token as
// soon as the user's access changes, so a refresh is how a new role
// arrives (stability S3) — or null when the server said the session is
// gone (deactivated, password reset, moved, company archived). Not on a
// network error or a 429: those don't mean the user was logged out.
type SessionListener = (session: LoginResponse | null) => void
const sessionListeners = new Set<SessionListener>()

export function onSessionChange(listener: SessionListener): () => void {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

export function refreshSession(): Promise<LoginResponse | null> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        if (res.status === 401) {
          setAccessToken(null)
          sessionListeners.forEach((listener) => listener(null))
        }
        return null
      }
      const data = (await res.json()) as LoginResponse
      setAccessToken(data.accessToken)
      sessionListeners.forEach((listener) => listener(data))
      return data
    } catch {
      return null
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

interface RequestOptions {
  method?: string
  body?: unknown
  skipAuthRetry?: boolean
  /** `blob` for a file download (the report PDF); JSON otherwise. */
  responseType?: 'json' | 'blob'
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // FormData (file uploads) must keep its own multipart Content-Type
  // with browser-generated boundary — setting it manually or
  // JSON.stringify-ing the body would break the upload.
  const isFormData = options.body instanceof FormData
  const doFetch = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: isFormData ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
    })

  let res = await doFetch(accessToken)

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshSession()
    if (refreshed) res = await doFetch(refreshed.accessToken)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as T
  if (options.responseType === 'blob') return res.blob() as Promise<T>
  return res.json() as Promise<T>
}
