import { useState } from 'react'
import { motion } from 'framer-motion'
import { Gauge, Wallet, MapPin, ExternalLink, AlertTriangle, FileText, Link2, Download, Loader2, CheckCircle2 } from 'lucide-react'
import { FinanciabilidadeBadge } from '@/components/ui/financiabilidade-badge'
import { currency } from '@/lib/format'
import { formatEndereco, type PropertyData } from '@/lib/avaliacao-types'
import type { AvmResultado as AvmResultadoData } from '@/lib/avm-types'

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

function buildAvmLaudoText(propertyData: PropertyData, resultado: AvmResultadoData): string {
  const lines: string[] = []
  lines.push('RELATÓRIO DE ESTIMATIVA DE VALOR (AVM)')
  lines.push('Estimativa automatizada de valor de mercado — não substitui um laudo técnico completo conforme a NBR 14.653.')
  lines.push('')
  if (resultado.dadosInsuficientes) {
    lines.push('*** ATENÇÃO — COMPARÁVEIS REAIS INSUFICIENTES ***')
    lines.push(
      resultado.dadosInsuficientesMotivo ||
        'Não foi possível reunir comparáveis reais suficientes num raio de até 500m do imóvel. O valor apresentado é apenas uma estimativa aproximada.',
    )
    lines.push('')
  }
  lines.push('1. IDENTIFICAÇÃO DO IMÓVEL')
  lines.push(`- Endereço: ${formatEndereco(propertyData)}`)
  lines.push(`- CEP: ${propertyData.cep}`)
  lines.push(`- Tipo: ${propertyData.tipoImovel}`)
  lines.push(`- Área construída: ${propertyData.areaConstruida} m²`)
  lines.push(`- Dormitórios: ${propertyData.dormitorios} · Banheiros: ${propertyData.banheiros} · Vagas: ${propertyData.vagas}`)
  lines.push('')
  lines.push('2. COMPARÁVEIS DE MERCADO UTILIZADOS')
  if (resultado.comparaveis.length === 0) lines.push('- Nenhum comparável real foi encontrado num raio de até 500m deste imóvel.')
  for (const c of resultado.comparaveis) {
    lines.push(`- ${c.endereco} — ${c.areaM2} m², a ${c.distanciaM} m, ${currency(c.valor)} (fonte real localizada na internet)`)
  }
  lines.push('')
  if (resultado.divergencias.length > 0) {
    lines.push('3. DIVERGÊNCIAS IDENTIFICADAS NOS DOCUMENTOS')
    for (const d of resultado.divergencias) {
      lines.push(`- ${d.campo}: informado ${d.valorInformado} vs. documento ${d.valorDocumento} (${d.percentual}%) — ${d.mensagem}`)
    }
    lines.push('')
  }
  lines.push('4. ESTIMATIVA DE VALOR')
  lines.push(`- Valor de mercado: ${currency(resultado.valorMercado)}`)
  lines.push(`- Faixa de valores: ${currency(resultado.faixaMin)} a ${currency(resultado.faixaMax)}`)
  lines.push(`- Liquidez: ${resultado.liquidez}`)
  lines.push(`- Fundamentação: ${resultado.fundamentacao}`)
  lines.push('')
  lines.push('5. FINANCIABILIDADE')
  lines.push(`- Status: ${resultado.financiabilidade.status}`)
  for (const m of resultado.financiabilidade.motivos) lines.push(`- ${m}`)
  lines.push('')
  lines.push('6. ORIENTAÇÃO DE CRÉDITO')
  lines.push(`- LTV máximo recomendado: ${resultado.orientacaoCredito.ltvMaximoRecomendado}%`)
  lines.push(`- ${resultado.orientacaoCredito.texto}`)
  return lines.join('\n')
}

interface AvmResultadoProps {
  resultado: AvmResultadoData
  propertyData: PropertyData
  photos?: { label: string; url: string }[]
  documents?: { label: string; url: string }[]
}

export function AvmResultado({ resultado, propertyData, photos, documents }: AvmResultadoProps) {
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)

  const handleGenerateReport = async () => {
    setGenerating(true)
    try {
      const text = buildAvmLaudoText(propertyData, resultado)
      const { downloadLaudoPdf } = await import('@/lib/pdf')
      await downloadLaudoPdf(text, 'Relatório de Estimativa de Valor (AVM)', { photos, documents })
      setDone(true)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      {resultado.dadosInsuficientes && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-red-300 uppercase tracking-wide">
            <AlertTriangle className="size-4" /> Comparáveis reais insuficientes
          </h3>
          <p className="mt-2 text-[13px] text-red-200/90 leading-relaxed">
            {resultado.dadosInsuficientesMotivo ||
              'Não foi possível reunir comparáveis reais suficientes num raio de até 500m do imóvel para uma estimativa confiável.'}
          </p>
          <p className="mt-2 text-[12px] text-red-200/70">O valor abaixo é apenas uma estimativa aproximada.</p>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-6 sm:p-7 text-center">
        <p className="text-[12px] text-faint uppercase tracking-wide">Valor de mercado estimado</p>
        <p className="mt-2 text-3xl sm:text-4xl font-display font-semibold text-ink">{currency(resultado.valorMercado)}</p>
        <p className="mt-1.5 text-[13px] text-muted">
          Faixa: {currency(resultado.faixaMin)} – {currency(resultado.faixaMax)} · Liquidez {resultado.liquidez}
        </p>
        <button
          onClick={handleGenerateReport}
          disabled={generating}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all disabled:opacity-60 active:scale-95"
        >
          {generating ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Gerando relatório...
            </>
          ) : done ? (
            <>
              <CheckCircle2 className="size-3.5" /> Baixar novamente
            </>
          ) : (
            <>
              <Download className="size-3.5" /> Gerar relatório em PDF
            </>
          )}
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
          <MapPin className="size-4 text-brand-400" /> Como chegamos nesse valor — comparáveis usados
        </h3>
        <p className="mt-1.5 text-[11.5px] text-faint">
          Todos os comparáveis vêm de anúncios reais encontrados na internet (link "Ver anúncio real") — a IA nunca inventa um comparável. O ícone de mapa sempre abre a localização aproximada.
        </p>
        {resultado.comparaveis.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted italic">Nenhum comparável real foi encontrado num raio de até 500m deste imóvel.</p>
        ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-faint text-left">
                <th className="font-medium pb-2 pr-3">Endereço</th>
                <th className="font-medium pb-2 pr-3">Distância</th>
                <th className="font-medium pb-2 pr-3">Área</th>
                <th className="font-medium pb-2 pr-3">Valor</th>
                <th className="font-medium pb-2">Mapa</th>
              </tr>
            </thead>
            <tbody>
              {resultado.comparaveis.map((c, i) => (
                <tr key={i} className="border-t border-white/8">
                  <td className="py-2 pr-3 text-ink/90">
                    <div>{c.endereco}</div>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 mt-0.5 text-[11px] text-emerald-400 hover:text-emerald-300"
                      >
                        <Link2 className="size-3" /> Ver anúncio real
                      </a>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted">{c.distanciaM} m</td>
                  <td className="py-2 pr-3 text-muted">{c.areaM2} m²</td>
                  <td className="py-2 pr-3 text-ink/90 font-medium">{currency(c.valor)}</td>
                  <td className="py-2">
                    <a
                      href={mapsUrl(c.endereco)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-brand-400 hover:text-brand-300"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <p className="mt-4 text-[12.5px] text-muted leading-relaxed border-t border-white/8 pt-3">{resultado.fundamentacao}</p>
      </div>

      {resultado.divergencias.length > 0 && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.04] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-amber-300 uppercase tracking-wide">
            <AlertTriangle className="size-4" /> Divergências identificadas nos documentos
          </h3>
          <div className="mt-4 space-y-3">
            {resultado.divergencias.map((d, i) => (
              <div key={i} className="text-[13px]">
                <p className="text-ink/90 font-medium">{d.campo} — {d.percentual}% de diferença</p>
                <p className="text-muted">Informado: {d.valorInformado} · Documento: {d.valorDocumento}</p>
                <p className="text-amber-300/90 mt-0.5">{d.mensagem}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <FinanciabilidadeBadge status={resultado.financiabilidade.status} detail={resultado.financiabilidade.motivos[0]} />

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
          <Gauge className="size-4 text-brand-400" /> Fatores considerados
        </h3>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {resultado.fatoresConsiderados.map((f) => (
            <span key={f} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11.5px] text-muted">
              {f}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-brand-400/20 bg-brand-500/[0.05] p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-brand-300 uppercase tracking-wide">
          <Wallet className="size-4" /> Orientação de crédito
        </h3>
        <p className="mt-2 text-[13px] text-ink/90">
          LTV máximo recomendado: <span className="font-semibold">{resultado.orientacaoCredito.ltvMaximoRecomendado}%</span>
        </p>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">{resultado.orientacaoCredito.texto}</p>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-faint">
        <FileText className="size-3" /> Estimativa automatizada (AVM) — não substitui um laudo técnico completo.
      </p>
    </motion.div>
  )
}

export default AvmResultado
