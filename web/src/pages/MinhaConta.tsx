import { useEffect, useState } from 'react'
import { ArrowLeft, UserRound, Loader2, FileText, Layers, PieChart } from 'lucide-react'
import { navigate } from '@/lib/router'
import { useAuth } from '@/lib/auth-context'
import { currency } from '@/lib/format'

interface HistoryRow {
  id: number
  module: string
  resumo: string | null
  valorEstimado: number | null
  createdAt: string
}

const MODULE_LABEL: Record<string, { label: string; icon: typeof FileText }> = {
  empresa_avaliadora: { label: 'Empresa Avaliadora', icon: FileText },
  avm: { label: 'AVM Cliente Final', icon: PieChart },
  portfolio: { label: 'Reavaliação de Carteiras', icon: Layers },
}

export function MinhaConta() {
  const { user } = useAuth()
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/account/history')
        const data = (await res.json().catch(() => ({}))) as { history?: HistoryRow[]; error?: string }
        if (!res.ok) {
          setError(data.error || 'Falha ao carregar seu histórico.')
          return
        }
        setHistory(data.history || [])
      } catch {
        setError('Não foi possível conectar ao servidor.')
      }
    }
    load()
  }, [])

  if (!user) return null

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
            <UserRound className="size-4.5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">Minha Conta</h1>
            <p className="text-[13.5px] text-muted">{user.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
            <p className="text-[11px] text-faint">Avaliações usadas</p>
            <p className="mt-1 text-[18px] font-display font-semibold text-ink">{user.evaluationsUsed} / {user.evaluationsLimit}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
            <p className="text-[11px] text-faint">Plano</p>
            <p className="mt-1 text-[18px] font-display font-semibold text-ink">{user.isAdmin ? 'Administrador' : 'Gratuito'}</p>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">{error}</div>
        )}

        <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
          <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide mb-4">Histórico de avaliações</h3>
          {!history ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : history.length === 0 ? (
            <p className="text-[13px] text-muted">Você ainda não fez nenhuma avaliação.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-faint text-left">
                    <th className="font-medium pb-2 pr-3">Módulo</th>
                    <th className="font-medium pb-2 pr-3">Resumo</th>
                    <th className="font-medium pb-2 pr-3">Valor estimado</th>
                    <th className="font-medium pb-2">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const mod = MODULE_LABEL[h.module] ?? { label: h.module, icon: FileText }
                    return (
                      <tr key={h.id} className="border-t border-white/8">
                        <td className="py-2.5 pr-3 text-ink/90">
                          <span className="flex items-center gap-1.5">
                            <mod.icon className="size-3.5 text-brand-400" /> {mod.label}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-muted">{h.resumo || 'Sem detalhes registrados'}</td>
                        <td className="py-2.5 pr-3 text-ink/90 font-medium">
                          {h.valorEstimado != null ? currency(h.valorEstimado) : '—'}
                        </td>
                        <td className="py-2.5 text-muted">
                          {new Date(h.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export default MinhaConta
