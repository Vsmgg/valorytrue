import { useState } from 'react'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { navigate } from '@/lib/router'
import { UploadPlanilha } from '@/components/portfolio/upload-planilha'
import { DashboardExecutivo } from '@/components/portfolio/dashboard-executivo'
import { QuotaBadge } from '@/components/ui/quota-badge'
import { useAuth } from '@/lib/auth-context'
import type { ImovelCarteira, ResultadoCarteira } from '@/lib/portfolio-types'

export function ReavaliacaoCarteiras() {
  const { refreshUser } = useAuth()
  const [imoveis, setImoveis] = useState<ImovelCarteira[]>([])
  const [resultados, setResultados] = useState<ResultadoCarteira[] | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleProcess = async (lista: ImovelCarteira[]) => {
    setImoveis(lista)
    setProcessing(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imoveis: lista }),
      })
      const data = (await res.json().catch(() => ({}))) as { resultados?: ResultadoCarteira[]; error?: string }
      if (!res.ok || !data.resultados) {
        setError(data.error || 'Falha ao processar a carteira. Tente novamente.')
        return
      }
      setResultados(data.resultados)
      refreshUser()
    } catch {
      setError('Não foi possível conectar ao motor de análise.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[13px] text-faint hover:text-ink transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Voltar para a home
          </button>
          <QuotaBadge />
        </div>

        <div className="mb-8">
          <h1 className="font-display text-2xl font-semibold text-ink">Módulo Reavaliação de Carteiras</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            Processamento em lote de uma carteira de imóveis com dashboard executivo — até 25 imóveis por vez nesta demonstração.
          </p>
        </div>

        {!resultados ? (
          <UploadPlanilha onProcess={handleProcess} processing={processing} />
        ) : (
          <div className="space-y-5">
            <DashboardExecutivo imoveis={imoveis} resultados={resultados} />
            <button
              onClick={() => { setResultados(null); setImoveis([]) }}
              className="text-[13px] font-medium text-brand-400 hover:text-brand-300"
            >
              Processar outra carteira
            </button>
          </div>
        )}

        {error && (
          <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            <AlertTriangle className="size-4 shrink-0" /> {error}
          </div>
        )}
      </div>
    </main>
  )
}

export default ReavaliacaoCarteiras
