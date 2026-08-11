import { ArrowLeft, Landmark, Info } from 'lucide-react'
import { navigate } from '@/lib/router'
import { ApiTester } from '@/components/bancos/api-tester'
import { LtvCalculadora } from '@/components/bancos/ltv-calculadora'

const ROADMAP_CHIPS = ['CRIM', 'SISCRED', 'LOS']

export function Bancos() {
  return (
    <main className="min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-[13px] text-faint hover:text-ink mb-8 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Voltar para a home
        </button>

        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="flex items-center justify-center size-9 rounded-xl bg-brand-500/10 text-brand-400">
              <Landmark className="size-4.5" />
            </div>
            <h1 className="font-display text-2xl font-semibold text-ink">Módulo Bancos</h1>
          </div>
          <p className="text-[13.5px] text-muted">
            Integração via API para instituições financeiras: nosso Motor Central exposto como endpoint real, mais uma calculadora de LTV.
          </p>
        </div>

        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <Info className="size-4 text-faint shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-muted leading-relaxed">
            A API abaixo (<code className="text-ink/80">/api/avm</code>) é real e testável nesta própria página. Integrações diretas com bureaus
            fechados como {ROADMAP_CHIPS.join(', ')} exigem credenciais e contratos que não temos nesta demonstração — permanecem no roadmap de
            integração, não como funcionalidade ativa hoje.
          </p>
        </div>

        <div className="space-y-5">
          <ApiTester />
          <LtvCalculadora />
        </div>
      </div>
    </main>
  )
}

export default Bancos
