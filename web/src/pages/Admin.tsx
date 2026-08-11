import { useEffect, useState } from 'react'
import { ArrowLeft, ShieldCheck, Loader2, Check } from 'lucide-react'
import { navigate } from '@/lib/router'

interface AdminUserRow {
  id: number
  email: string
  isAdmin: boolean
  evaluationsUsed: number
  evaluationsLimit: number
  createdAt: string
}

export function Admin() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null)
  const [stats, setStats] = useState<{ totalUsers: number; totalEvaluations: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/admin/users')
      const data = (await res.json().catch(() => ({}))) as {
        users?: AdminUserRow[]
        stats?: { totalUsers: number; totalEvaluations: number }
        error?: string
      }
      if (!res.ok) {
        setError(data.error || 'Falha ao carregar usuários.')
        return
      }
      setUsers(data.users || [])
      setStats(data.stats || null)
    } catch {
      setError('Não foi possível conectar ao servidor.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const updateUser = async (userId: number, patch: { evaluationsLimit?: number; isAdmin?: boolean }) => {
    setSavingId(userId)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, ...patch }),
      })
      if (res.ok) {
        setUsers((prev) => prev?.map((u) => (u.id === userId ? { ...u, ...patch } : u)) ?? null)
        setSavedId(userId)
        setTimeout(() => setSavedId(null), 1500)
      }
    } finally {
      setSavingId(null)
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-[13px] text-faint hover:text-ink mb-8 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Voltar para a home
        </button>

        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex items-center justify-center size-9 rounded-xl bg-brand-500/10 text-brand-400">
            <ShieldCheck className="size-4.5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">Painel de administração</h1>
            <p className="text-[13.5px] text-muted">Gerencie usuários e limites de avaliações gratuitas.</p>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">{error}</div>
        )}

        {stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
              <p className="text-[11px] text-faint">Usuários cadastrados</p>
              <p className="mt-1 text-[18px] font-display font-semibold text-ink">{stats.totalUsers}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
              <p className="text-[11px] text-faint">Avaliações realizadas</p>
              <p className="mt-1 text-[18px] font-display font-semibold text-ink">{stats.totalEvaluations}</p>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
          <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide mb-4">Usuários</h3>
          {!users ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-faint text-left">
                    <th className="font-medium pb-2 pr-3">E-mail</th>
                    <th className="font-medium pb-2 pr-3">Cadastro</th>
                    <th className="font-medium pb-2 pr-3">Avaliações</th>
                    <th className="font-medium pb-2 pr-3">Limite</th>
                    <th className="font-medium pb-2">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-white/8">
                      <td className="py-2.5 pr-3 text-ink/90">{u.email}</td>
                      <td className="py-2.5 pr-3 text-muted">{new Date(u.createdAt).toLocaleDateString('pt-BR')}</td>
                      <td className="py-2.5 pr-3 text-muted">{u.evaluationsUsed}</td>
                      <td className="py-2.5 pr-3">
                        <input
                          type="number"
                          defaultValue={u.evaluationsLimit}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (Number.isFinite(v) && v !== u.evaluationsLimit) updateUser(u.id, { evaluationsLimit: v })
                          }}
                          className="w-16 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[12.5px] text-ink focus:outline-none focus:border-brand-400/50"
                        />
                      </td>
                      <td className="py-2.5">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={u.isAdmin}
                            onChange={(e) => updateUser(u.id, { isAdmin: e.target.checked })}
                            className="size-3.5"
                          />
                          {savingId === u.id && <Loader2 className="size-3 animate-spin text-faint" />}
                          {savedId === u.id && <Check className="size-3 text-emerald-400" />}
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export default Admin
