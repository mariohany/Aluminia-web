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

// Queues concurrent 401s behind a single refresh call, instead of firing
// one refresh request per failed request.
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!res.ok) return null
      const data = (await res.json()) as { accessToken: string }
      setAccessToken(data.accessToken)
      return data.accessToken
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
    const newToken = await refreshAccessToken()
    if (newToken) res = await doFetch(newToken)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
