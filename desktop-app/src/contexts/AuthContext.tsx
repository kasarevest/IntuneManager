import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { User } from '../types/app'
import { ipcAuthValidateSession, ipcAuthLogin, ipcAuthLogout } from '../lib/api'

interface AuthState {
  user: User | null
  sessionToken: string | null
  isLoading: boolean
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; user?: User }>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const SESSION_KEY = 'intunemanager_session'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    sessionToken: null,
    isLoading: true
  })

  const refreshSession = useCallback(async () => {
    const token = sessionStorage.getItem(SESSION_KEY)
    if (!token) {
      setState({ user: null, sessionToken: null, isLoading: false })
      return
    }

    const res = await ipcAuthValidateSession(token)
    if (res.valid && res.user) {
      setState({ user: res.user, sessionToken: token, isLoading: false })
    } else {
      sessionStorage.removeItem(SESSION_KEY)
      setState({ user: null, sessionToken: null, isLoading: false })
    }
  }, [])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  const login = async (username: string, password: string) => {
    const res = await ipcAuthLogin({ username, password })
    if (res.success && res.sessionToken) {
      sessionStorage.setItem(SESSION_KEY, res.sessionToken)
      setState({ user: res.user ?? null, sessionToken: res.sessionToken, isLoading: false })
      return { success: true, user: res.user ?? undefined }
    }
    return { success: false, error: res.error ?? 'Login failed' }
  }

  const logout = async () => {
    const token = state.sessionToken
    if (token) {
      await ipcAuthLogout(token)
      sessionStorage.removeItem(SESSION_KEY)
    }
    setState({ user: null, sessionToken: null, isLoading: false })
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
