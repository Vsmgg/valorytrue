import { useState } from 'react'
import { motion } from 'framer-motion'
import { FileOutput, Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { formatEndereco, type AvaliacaoResultado, type PropertyData } from '@/lib/avaliacao-types'
import { currency } from '@/lib/format'

interface Fase5LaudoProps {
  propertyData: PropertyData
  resultado: AvaliacaoResultado
  photos?: { label: string; url: string }[]
  documents?: { label: string; url: string }[]
}

export function Fase5Laudo({ propertyData, resultado, photos, documents }: Fase5LaudoProps) {
  const [generating, setGenerating] = useState(false)
  const [redigindo, setRedigindo] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cacheado pra não gerar de novo (nova chamada ao Gemini) a cada clique em "baixar
  // novamente" — o texto narrativo não muda entre downloads do mesmo laudo aprovado.
  const [narrativeText, setNarrativeText] = useState<string | null>(null)

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      let texto = narrativeText
      if (!texto) {
        setRedigindo(true)
        const res = await fetch('/api/generate-laudo-narrativo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ propertyData, resultado, photos, documents }),
        })
        const data = (await res.json().catch(() => ({}))) as { texto?: string; error?: string }
        setRedigindo(false)
        if (!res.ok || !data.texto) {
          setError(data.error || 'Não foi possível gerar o laudo narrativo. Tente novamente.')
          return
        }
        texto = data.texto
        setNarrativeText(texto)
      }
      const { downloadLaudoPdf } = await import('@/lib/pdf')
      await downloadLaudoPdf(texto, 'Laudo de Avaliação Imobiliária', { photos, documents })
      setDone(true)
    } catch {
      setError('Não foi possível conectar ao motor de geração do laudo.')
    } finally {
      setRedigindo(false)
      setGenerating(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Fase 5 — Geração de Laudo</h2>
        <p className="mt-1 text-[13.5px] text-muted">Parecer aprovado. Gere o laudo final em PDF, aderente à ABNT NBR 14.653 e às orientações do IBAPE.</p>
        <p className="mt-1 text-[12px] text-faint">A redação do documento completo pode levar até 1 minuto.</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-8 sm:p-10 flex flex-col items-center text-center gap-5">
        <div className="flex items-center justify-center size-16 rounded-2xl bg-brand-500/10 text-brand-400">
          <FileOutput className="size-7" />
        </div>
        <div>
          <p className="font-display text-lg font-semibold text-ink">{formatEndereco(propertyData)}</p>
          <p className="mt-1 text-[13.5px] text-muted">Valor de mercado: {currency(resultado.parecer.valorMercado)} · Liquidez {resultado.parecer.liquidez} · IQG {resultado.iqg.score}/100</p>
          {(photos?.length || documents?.length) ? (
            <p className="mt-1 text-[11.5px] text-faint">
              O PDF incluirá {photos?.length ?? 0} foto(s) no relatório fotográfico
              {documents?.length ? ` e ${documents.length} documento(s) anexado(s)` : ''}.
            </p>
          ) : null}
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-60 active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]"
        >
          {generating ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {redigindo ? 'Redigindo o laudo narrativo...' : 'Gerando PDF...'}
            </>
          ) : done ? (
            <>
              <CheckCircle2 className="size-4" /> Baixar novamente
            </>
          ) : (
            <>
              <Download className="size-4" /> Baixar laudo em PDF
            </>
          )}
        </button>

        {done && <p className="text-[12.5px] text-emerald-400">Laudo gerado com sucesso.</p>}

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
            <button onClick={handleGenerate} className="ml-1 shrink-0 font-medium text-red-200 hover:text-red-100 underline underline-offset-2">
              Tentar novamente
            </button>
          </div>
        )}

        <p className="text-[11.5px] text-faint max-w-md">
          Exportação em Word, XML e assinatura digital (ICP-Brasil, Gov.br ou certificado digital) fazem parte do roadmap da plataforma.
        </p>
      </div>
    </motion.div>
  )
}

export default Fase5Laudo
