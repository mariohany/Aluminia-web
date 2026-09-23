import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthenticatedUser, LoginResponse } from '@repo/types/auth'
import { apiFetch, refreshSession, setAccessToken } from '@/lib/api-client'

interface AuthContextValue {
  user: AuthenticatedUser | null
  isLoading: boolean
  // Returns the authenticated user so a caller can route on it
  // immediately. Reading `user` from the context right after awaiting
  // this would still see the previous value — the state update has not
  // been rendered yet at that point.
  login: (email: string, password: string) => Promise<AuthenticatedUser>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Module-level, not component state: refresh tokens are single-use and
// rotate on every call, so two concurrent restore attempts (React
// StrictMode double-invoking this effect in development) would race —
// the second call presents a token the first one already rotated away.
// `refreshSession` shares its in-flight call with the 401 retry in
// api-client too, so nothing in this tab can ever refresh twice at once;
// holding the settled promise here keeps a remount from re-refreshing a
// session it has already restored.
let sessionRestorePromise: Promise<LoginResponse | null> | null = null

function restoreSession(): Promise<LoginResponse | null> {
  sessionRestorePromise ??= refreshSession()
  return sessionRestorePromise
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // The access token lives only in memory, so a page reload loses it.
    // Try to restore the session from the httpOnly refresh cookie before
    // deciding the visitor is logged out.
    void restoreSession().then((data) => {
      setAccessToken(data?.accessToken ?? null)
      setUser(data?.user ?? null)
      setIsLoading(false)
    })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRetry: true,
    })
    setAccessToken(data.accessToken)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST', skipAuthRetry: true }).catch(() => {})
    setAccessToken(null)
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
