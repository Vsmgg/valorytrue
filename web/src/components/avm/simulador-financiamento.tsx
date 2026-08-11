import { useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
import { currency } from '@/lib/format'

interface SimuladorProps {
  valorImovel: number
}

/** Tabela Price (parcelas fixas): PMT = PV · i / (1 - (1+i)^-n). */
function calcularPrice(valorFinanciado: number, taxaMensal: number, parcelas: number): number {
  if (taxaMensal === 0) return valorFinanciado / parcelas
  return (valorFinanciado * taxaMensal) / (1 - Math.pow(1 + taxaMensal, -parcelas))
}

export function SimuladorFinanciamento({ valorImovel }: SimuladorProps) {
  const [entradaPct, setEntradaPct] = useState(20)
  const [prazoAnos, setPrazoAnos] = useState(30)
  const [taxaAnual, setTaxaAnual] = useState(11.5)

  const resultado = useMemo(() => {
    const entrada = valorImovel * (entradaPct / 100)
    const valorFinanciado = valorImovel - entrada
    const parcelas = prazoAnos * 12
    const taxaMensal = Math.pow(1 + taxaAnual / 100, 1 / 12) - 1
    const parcela = calcularPrice(valorFinanciado, taxaMensal, parcelas)
    const totalPago = parcela * parcelas + entrada
    const totalJuros = totalPago - valorImovel
    return { entrada, valorFinanciado, parcela, totalPago, totalJuros }
  }, [valorImovel, entradaPct, prazoAnos, taxaAnual])

  return (
    <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-5">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
        <Calculator className="size-4 text-brand-400" /> Simulador de financiamento
      </h3>
      <p className="text-[11.5px] text-faint -mt-2">Cálculo real pela Tabela Price, sobre o valor estimado acima. Ajuste os campos livremente.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-[12px] font-medium text-muted">Entrada (%)</span>
          <input
            type="number"
            min={0}
            max={90}
            value={entradaPct}
            onChange={(e) => setEntradaPct(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-muted">Prazo (anos)</span>
          <input
            type="number"
            min={1}
            max={35}
            value={prazoAnos}
            onChange={(e) => setPrazoAnos(Math.max(1, Math.min(35, Number(e.target.value) || 1)))}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-muted">Juros ao ano (%)</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.1}
            value={taxaAnual}
            onChange={(e) => setTaxaAnual(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:border-brand-400/50"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/8">
        <div>
          <p className="text-[11px] text-faint">Entrada</p>
          <p className="text-[14px] font-semibold text-ink">{currency(resultado.entrada)}</p>
        </div>
        <div>
          <p className="text-[11px] text-faint">Valor financiado</p>
          <p className="text-[14px] font-semibold text-ink">{currency(resultado.valorFinanciado)}</p>
        </div>
        <div>
          <p className="text-[11px] text-faint">Parcela mensal</p>
          <p className="text-[14px] font-semibold text-brand-400">{currency(resultado.parcela)}</p>
        </div>
        <div>
          <p className="text-[11px] text-faint">Total de juros</p>
          <p className="text-[14px] font-semibold text-ink">{currency(resultado.totalJuros)}</p>
        </div>
      </div>
    </div>
  )
}

export default SimuladorFinanciamento
