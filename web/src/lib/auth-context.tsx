import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface AuthUser {
  id: number
  email: string
  isAdmin: boolean
  evaluationsUsed: number
  evaluationsLimit: number
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<string | null>
  register: (email: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function postAuth(path: string, body: unknown): Promise<{ user?: AuthUser; error?: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string }
  if (!res.ok) return { error: data.error || 'Algo deu errado. Tente novamente.' }
  return { user: data.user }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = async () => {
    try {
      const res = await fetch('/api/auth/me')
      const data = (await res.json()) as { user?: AuthUser | null }
      setUser(data.user ?? null)
    } catch {
      // keep whatever user state we already had rather than logging out on a transient failure
    }
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const { user: loggedIn, error } = await postAuth('/api/auth/login', { email, password })
    if (loggedIn) setUser(loggedIn)
    return error ?? null
  }

  const register = async (email: string, password: string) => {
    const { user: created, error } = await postAuth('/api/auth/register', { email, password })
    if (created) setUser(created)
    return error ?? null
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
