import { useMemo, useState } from 'react'
import { Percent, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { currency } from '@/lib/format'

function classificarLtv(ltv: number): { label: string; cls: string; icon: typeof CheckCircle2 } {
  if (ltv <= 80) return { label: 'Dentro do limite usual (até 80%)', cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25', icon: CheckCircle2 }
  if (ltv <= 90) return { label: 'Acima do usual — exige garantias adicionais', cls: 'text-amber-400 bg-amber-500/10 border-amber-400/25', icon: AlertTriangle }
  return { label: 'Fora da faixa recomendada para financiamento imobiliário', cls: 'text-red-400 bg-red-500/10 border-red-400/25', icon: XCircle }
}

export function LtvCalculadora() {
  const [valorImovel, setValorImovel] = useState('500000')
  const [valorEmprestimo, setValorEmprestimo] = useState('350000')

  const ltv = useMemo(() => {
    const imovel = Number(valorImovel) || 0
    const emprestimo = Number(valorEmprestimo) || 0
    if (imovel <= 0) return 0
    return (emprestimo / imovel) * 100
  }, [valorImovel, valorEmprestimo])

  const status = classificarLtv(ltv)

  return (
    <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
        <Percent className="size-4 text-brand-400" /> Calculadora de LTV
      </h3>
      <p className="text-[11.5px] text-faint -mt-2">Loan-to-Value = valor do empréstimo ÷ valor do imóvel. Cálculo determinístico, sem IA.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[12px] font-medium text-muted">Valor do imóvel (R$)</span>
          <input
            type="number"
            value={valorImovel}
            onChange={(e) => setValorImovel(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-muted">Valor do empréstimo (R$)</span>
          <input
            type="number"
            value={valorEmprestimo}
            onChange={(e) => setValorEmprestimo(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
          />
        </label>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
        <div>
          <p className="text-[11px] text-faint">LTV calculado</p>
          <p className="text-xl font-display font-semibold text-ink">{ltv.toFixed(1)}%</p>
        </div>
        <p className="text-[11.5px] text-muted text-right max-w-[60%]">
          Empréstimo de {currency(Number(valorEmprestimo) || 0)} sobre imóvel de {currency(Number(valorImovel) || 0)}
        </p>
      </div>

      <div className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${status.cls}`}>
        <status.icon className="size-4 shrink-0" /> {status.label}
      </div>
    </div>
  )
}

export default LtvCalculadora
