import { useState } from 'react'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { navigate } from '@/lib/router'
import { AvmForm, type AvmFormResult } from '@/components/avm/avm-form'
import { AvmResultado } from '@/components/avm/avm-resultado'
import { SimuladorFinanciamento } from '@/components/avm/simulador-financiamento'
import { QuotaBadge } from '@/components/ui/quota-badge'
import { useAuth } from '@/lib/auth-context'
import type { AvmResultado as AvmResultadoData } from '@/lib/avm-types'
import type { PropertyData } from '@/lib/avaliacao-types'

interface ComparavelReal {
  endereco: string
  areaM2: number | null
  valorAnunciado: number | null
  distanciaM: number | null
  url: string
}

export function AvmClienteFinal() {
  const { refreshUser } = useAuth()
  const [propertyData, setPropertyData] = useState<PropertyData | null>(null)
  const [attachments, setAttachments] = useState<{ photos: AvmFormResult['photos']; documents: AvmFormResult['documents'] } | null>(null)
  const [resultado, setResultado] = useState<AvmResultadoData | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (form: AvmFormResult) => {
    setSubmitting(true)
    setError(null)
    try {
      // Mesma passada dedicada de busca de amostras reais usada no Empresa Avaliadora — sem
      // isso, o /api/avm cai no fallback de orçamento apertado (4s), tempo real demais
      // insuficiente pra achar anúncios de verdade (confirmado: é a causa de "amostras
      // insuficientes" aparecer com muito mais frequência neste módulo). Encadeamos várias
      // chamadas (cada uma uma invocação nova do Edge Function, com seu próprio limite de
      // 25s) pra buscar por mais tempo total, com meta de pelo menos 5 amostras reais.
      setBuscando(true)
      // Espelhado com src/components/wizard/fase2-processando.tsx — mesma meta de até 15
      // amostras reais, mesmo teto de chamadas/tempo, mesmo uso de `proximoOffsetBase`
      // devolvido por /api/find-amostras (em vez de um passo fixo `chamada * 10`, que deixava
      // páginas de resultado nunca consultadas a cada transição de chamada).
      const ALVO_AMOSTRAS_FRONTEND = 20
      const MAX_CHAMADAS_BUSCA = 10
      const TEMPO_MAX_BUSCA_MS = 300_000
      let comparaveisReais: ComparavelReal[] = []
      const urlsVistas = new Set<string>()
      let origemCoords: { lat: number; lon: number } | undefined
      let proximoOffsetBase = 0
      const inicioBusca = Date.now()
      for (let chamada = 0; chamada < MAX_CHAMADAS_BUSCA; chamada++) {
        if (comparaveisReais.length >= ALVO_AMOSTRAS_FRONTEND) break
        if (Date.now() - inicioBusca > TEMPO_MAX_BUSCA_MS) break
        try {
          const res0 = await fetch('/api/find-amostras', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ propertyData: form.propertyData, offsetBase: proximoOffsetBase, origemCoords }),
          })
          const data0 = (await res0.json().catch(() => ({}))) as {
            comparaveisReais?: ComparavelReal[]
            origem?: { lat: number; lon: number } | null
            proximoOffsetBase?: number
          }
          if (!res0.ok || !Array.isArray(data0.comparaveisReais)) break
          if (data0.origem && !origemCoords) origemCoords = data0.origem
          if (typeof data0.proximoOffsetBase === 'number') proximoOffsetBase = data0.proximoOffsetBase
          const novos = data0.comparaveisReais.filter((c) => !urlsVistas.has(c.url))
          if (novos.length === 0) break
          for (const c of novos) urlsVistas.add(c.url)
          comparaveisReais = [...comparaveisReais, ...novos]
        } catch {
          break
        }
      }
      setBuscando(false)

      const res = await fetch('/api/avm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, comparaveisReais }),
      })
      const data = (await res.json().catch(() => ({}))) as { resultado?: AvmResultadoData; error?: string }
      if (!res.ok || !data.resultado) {
        setError(data.error || 'Falha ao estimar o valor. Tente novamente.')
        return
      }
      setPropertyData(form.propertyData)
      setAttachments({ photos: form.photos, documents: form.documents })
      setResultado(data.resultado)
      refreshUser()
    } catch {
      setError('Não foi possível conectar ao motor de análise.')
    } finally {
      setSubmitting(false)
      setBuscando(false)
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="mx-auto max-w-2xl">
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
          <h1 className="font-display text-2xl font-semibold text-ink">Módulo AVM Cliente Final</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            Estimativa automática de valor de mercado e liquidez do seu imóvel, com simulador de financiamento.
          </p>
        </div>

        {!resultado || !propertyData ? (
          <>
            <AvmForm onSubmit={handleSubmit} submitting={submitting} />
            {submitting && (
              <p className="mt-3 text-center text-[12.5px] text-faint">
                {buscando
                  ? 'Pesquisando o mercado imobiliário da região — pode levar até alguns minutos...'
                  : 'Gerando a estimativa de valor...'}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-5">
            <AvmResultado
              resultado={resultado}
              propertyData={propertyData}
              photos={attachments?.photos}
              documents={attachments?.documents}
            />
            <SimuladorFinanciamento valorImovel={resultado.valorMercado} />
            <button
              onClick={() => setResultado(null)}
              className="text-[13px] font-medium text-brand-400 hover:text-brand-300"
            >
              Fazer nova estimativa
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

export default AvmClienteFinal
