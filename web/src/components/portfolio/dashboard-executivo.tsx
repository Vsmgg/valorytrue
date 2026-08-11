import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, ExternalLink, Layers, TrendingUp, FileOutput, Loader2, CheckCircle2 } from 'lucide-react'
import { currency } from '@/lib/format'
import { toCsv, downloadCsv } from '@/lib/csv'
import type { ImovelCarteira, ResultadoCarteira } from '@/lib/portfolio-types'

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

const IQG_COLOR: Record<string, string> = {
  Premium: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
  'Atenção': 'text-gold-400 bg-gold-500/10 border-gold-500/25',
  Inadequada: 'text-red-400 bg-red-500/10 border-red-400/25',
}

interface DashboardProps {
  imoveis: ImovelCarteira[]
  resultados: ResultadoCarteira[]
}

export function DashboardExecutivo({ imoveis, resultados }: DashboardProps) {
  const [generatingReport, setGeneratingReport] = useState(false)
  const [reportDone, setReportDone] = useState(false)

  const rows = useMemo(() => {
    const byLinha = new Map(resultados.map((r) => [r.linha, r]))
    return imoveis
      .map((im) => ({ imovel: im, resultado: byLinha.get(im.linha) }))
      .filter((r): r is { imovel: ImovelCarteira; resultado: ResultadoCarteira } => !!r.resultado)
  }, [imoveis, resultados])

  const kpis = useMemo(() => {
    const total = rows.reduce((sum, r) => sum + r.resultado.valorEstimado, 0)
    const media = rows.length > 0 ? total / rows.length : 0
    const porClassificacao: Record<string, number> = {}
    for (const r of rows) {
      porClassificacao[r.resultado.classificacaoIqg] = (porClassificacao[r.resultado.classificacaoIqg] || 0) + 1
    }
    return { total, media, porClassificacao, count: rows.length }
  }, [rows])

  const clusters = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const r of rows) {
      const key = `${r.imovel.cidade}/${r.imovel.uf}`
      const c = map.get(key) || { count: 0, total: 0 }
      c.count += 1
      c.total += r.resultado.valorEstimado
      map.set(key, c)
    }
    return Array.from(map.entries())
      .map(([cidade, v]) => ({ cidade, ...v, media: v.total / v.count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  const handleExport = () => {
    const headers = ['endereco', 'cidade', 'uf', 'tipo', 'areaM2', 'valorEstimado', 'liquidez', 'iqgScore', 'classificacaoIqg']
    const csvRows = rows.map((r) => [
      r.imovel.endereco,
      r.imovel.cidade,
      r.imovel.uf,
      r.imovel.tipo,
      r.imovel.areaM2,
      r.resultado.valorEstimado,
      r.resultado.liquidez,
      r.resultado.iqgScore,
      r.resultado.classificacaoIqg,
    ])
    downloadCsv('carteira-reavaliada.csv', toCsv(headers, csvRows))
  }

  const handleGenerateReport = async () => {
    setGeneratingReport(true)
    try {
      const lines: string[] = []
      lines.push('RELATÓRIO EXECUTIVO — REAVALIAÇÃO DE CARTEIRA')
      lines.push('Processamento em lote via Motor Central de Inteligência Imobiliária.')
      lines.push('')
      lines.push('1. RESUMO EXECUTIVO')
      lines.push(`- Valor total da carteira: ${currency(kpis.total)}`)
      lines.push(`- Valor médio por imóvel: ${currency(kpis.media)}`)
      lines.push(`- Imóveis processados: ${kpis.count}`)
      lines.push(`- Cidades na carteira: ${clusters.length}`)
      lines.push('')
      lines.push('2. DISTRIBUIÇÃO POR CLASSIFICAÇÃO IQG')
      for (const [classificacao, count] of Object.entries(kpis.porClassificacao)) {
        lines.push(`- ${classificacao}: ${count}`)
      }
      lines.push('')
      lines.push('3. CLUSTERIZAÇÃO POR CIDADE')
      for (const c of clusters) {
        lines.push(`- ${c.cidade}: ${c.count} imóve${c.count === 1 ? 'l' : 'is'}, valor médio ${currency(c.media)}`)
      }
      lines.push('')
      lines.push('4. DETALHAMENTO POR IMÓVEL')
      for (const r of rows) {
        lines.push(
          `- ${r.imovel.endereco}, ${r.imovel.cidade}/${r.imovel.uf} — ${currency(r.resultado.valorEstimado)}, liquidez ${r.resultado.liquidez}, IQG ${r.resultado.iqgScore} (${r.resultado.classificacaoIqg})`,
        )
      }
      const { downloadLaudoPdf } = await import('@/lib/pdf')
      await downloadLaudoPdf(lines.join('\n'), 'Relatório Executivo — Reavaliação de Carteira')
      setReportDone(true)
    } finally {
      setGeneratingReport(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
          <p className="text-[11px] text-faint">Valor total da carteira</p>
          <p className="mt-1 text-[16px] font-display font-semibold text-ink">{currency(kpis.total)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
          <p className="text-[11px] text-faint">Valor médio</p>
          <p className="mt-1 text-[16px] font-display font-semibold text-ink">{currency(kpis.media)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
          <p className="text-[11px] text-faint">Imóveis processados</p>
          <p className="mt-1 text-[16px] font-display font-semibold text-ink">{kpis.count}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-surface/60 p-4">
          <p className="text-[11px] text-faint">Cidades na carteira</p>
          <p className="mt-1 text-[16px] font-display font-semibold text-ink">{clusters.length}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide mb-3">
          <TrendingUp className="size-4 text-brand-400" /> Distribuição por classificação IQG
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(kpis.porClassificacao).map(([classificacao, count]) => (
            <span key={classificacao} className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium ${IQG_COLOR[classificacao] || ''}`}>
              {classificacao}: {count}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide mb-3">
          <Layers className="size-4 text-brand-400" /> Clusterização por cidade
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {clusters.map((c) => (
            <div key={c.cidade} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-[12.5px]">
              <span className="text-ink/90">{c.cidade}</span>
              <span className="text-muted">{c.count} imóve{c.count === 1 ? 'l' : 'is'} · média {currency(c.media)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Detalhamento por imóvel</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleGenerateReport}
              disabled={generatingReport}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-60"
            >
              {generatingReport ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Gerando relatório...
                </>
              ) : reportDone ? (
                <>
                  <CheckCircle2 className="size-3.5" /> Baixar novamente
                </>
              ) : (
                <>
                  <FileOutput className="size-3.5" /> Gerar relatório (PDF)
                </>
              )}
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-medium bg-white/5 hover:bg-white/10 text-ink transition-colors"
            >
              <Download className="size-3.5" /> Exportar CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-faint text-left">
                <th className="font-medium pb-2 pr-3">Endereço</th>
                <th className="font-medium pb-2 pr-3">Valor estimado</th>
                <th className="font-medium pb-2 pr-3">Liquidez</th>
                <th className="font-medium pb-2 pr-3">IQG</th>
                <th className="font-medium pb-2">Mapa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.imovel.linha} className="border-t border-white/8">
                  <td className="py-2 pr-3 text-ink/90">{r.imovel.endereco}, {r.imovel.cidade}/{r.imovel.uf}</td>
                  <td className="py-2 pr-3 text-ink/90 font-medium">{currency(r.resultado.valorEstimado)}</td>
                  <td className="py-2 pr-3 text-muted">{r.resultado.liquidez}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-lg border px-2 py-0.5 text-[11px] ${IQG_COLOR[r.resultado.classificacaoIqg] || ''}`}>
                      {r.resultado.iqgScore} · {r.resultado.classificacaoIqg}
                    </span>
                  </td>
                  <td className="py-2">
                    <a
                      href={mapsUrl(`${r.imovel.endereco}, ${r.imovel.cidade}/${r.imovel.uf}`)}
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
      </div>
    </motion.div>
  )
}

export default DashboardExecutivo
