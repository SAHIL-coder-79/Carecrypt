import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api.js'
import { AuthContext } from './context.js'

// The session (token + basic user info) lives in sessionStorage, so it ends when
// the tab closes. The server remains the only authority on what the user may see:
// the role stored here is used for navigation only, never for access decisions.
const STORAGE_KEY = 'carecrypt.session'

function loadSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(STORAGE_KEY))
    if (!session || new Date(session.expiresAt) <= new Date()) return null
    return session
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(loadSession)

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setSession(null)
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } })
    const next = { token: data.token, user: data.user, expiresAt: data.expiresAt }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
    return next.user
  }, [])

  // Authenticated request. A 401 means the token is no longer valid: sign out.
  const request = useCallback(
    async (path, options = {}) => {
      try {
        return await apiRequest(path, { ...options, token: session?.token })
      } catch (err) {
        if (err.status === 401) logout()
        throw err
      }
    },
    [session, logout],
  )

  // Sign out automatically when the token expires.
  useEffect(() => {
    if (!session) return undefined
    const timer = setTimeout(logout, Math.max(new Date(session.expiresAt) - Date.now(), 0))
    return () => clearTimeout(timer)
  }, [session, logout])

  const value = useMemo(
    () => ({ user: session?.user ?? null, isAuthenticated: Boolean(session), login, logout, request }),
    [session, login, logout, request],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
