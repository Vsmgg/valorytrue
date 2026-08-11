import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Building2,
  MapPin,
  AlertTriangle,
  Loader2,
  Pencil,
  MessageCircle,
  ExternalLink,
  Sparkles,
  Link2,
  Scale,
  BarChart3,
  Target,
  Gauge,
  Banknote,
  FileCheck,
} from 'lucide-react'
import { IqgGauge } from '@/components/ui/iqg-gauge'
import { FinanciabilidadeBadge } from '@/components/ui/financiabilidade-badge'
import { ChatInput, type PendingAttachment } from '@/components/ui/chat-input'
import type { AvaliacaoResultado, GrauNBR } from '@/lib/avaliacao-types'
import { currency } from '@/lib/format'

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

const GRAU_STYLE: Record<GrauNBR, string> = {
  III: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-400',
  II: 'bg-brand-500/10 border-brand-400/30 text-brand-400',
  I: 'bg-amber-500/10 border-amber-400/30 text-amber-300',
}

function GrauBadge({ grau }: { grau: GrauNBR }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[11.5px] font-semibold ${GRAU_STYLE[grau]}`}>
      Grau {grau}
    </span>
  )
}

interface ChatMsg {
  role: 'user' | 'model'
  text: string
  attachment?: PendingAttachment
}

interface RevisionProposal {
  parecer: AvaliacaoResultado['parecer']
  justificativa: string
  amostras?: AvaliacaoResultado['amostras']
  tratamentoEstatistico?: AvaliacaoResultado['tratamentoEstatistico']
  grauFundamentacao?: AvaliacaoResultado['grauFundamentacao']
  grauPrecisao?: AvaliacaoResultado['grauPrecisao']
  valorFinal?: AvaliacaoResultado['valorFinal']
  dadosInsuficientes?: boolean
  dadosInsuficientesMotivo?: string
}

interface Fase3Props {
  resultado: AvaliacaoResultado
  onApprove: (final: AvaliacaoResultado, adjusted: boolean) => void
}

export function Fase3Analista({ resultado: initialResultado, onApprove }: Fase3Props) {
  const [current, setCurrent] = useState(initialResultado)
  const [adjusting, setAdjusting] = useState(false)
  const [valorMercado, setValorMercado] = useState(String(current.parecer.valorMercado))
  const [faixaMin, setFaixaMin] = useState(String(current.parecer.faixaMin))
  const [faixaMax, setFaixaMax] = useState(String(current.parecer.faixaMax))
  const [liquidez, setLiquidez] = useState(current.parecer.liquidez)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [revisionProposal, setRevisionProposal] = useState<RevisionProposal | null>(null)
  const [revisionLoading, setRevisionLoading] = useState(false)

  const handleApprove = () => onApprove(current, false)

  const handleSaveAdjustment = () => {
    const adjusted: AvaliacaoResultado = {
      ...current,
      parecer: {
        ...current.parecer,
        valorMercado: Number(valorMercado) || current.parecer.valorMercado,
        faixaMin: Number(faixaMin) || current.parecer.faixaMin,
        faixaMax: Number(faixaMax) || current.parecer.faixaMax,
        liquidez,
      },
    }
    onApprove(adjusted, true)
  }

  const requestRevision = async (history: ChatMsg[]) => {
    setRevisionLoading(true)
    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resultado: current,
          history: history.map((m) => ({ role: m.role, text: m.text })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        revisar?: boolean
        parecer?: AvaliacaoResultado['parecer']
        justificativa?: string
        amostras?: AvaliacaoResultado['amostras']
        tratamentoEstatistico?: AvaliacaoResultado['tratamentoEstatistico']
        grauFundamentacao?: AvaliacaoResultado['grauFundamentacao']
        grauPrecisao?: AvaliacaoResultado['grauPrecisao']
        valorFinal?: AvaliacaoResultado['valorFinal']
        dadosInsuficientes?: boolean
        dadosInsuficientesMotivo?: string
      }
      if (data.revisar && data.parecer) {
        setRevisionProposal({
          parecer: data.parecer,
          justificativa: data.justificativa || '',
          amostras: data.amostras,
          tratamentoEstatistico: data.tratamentoEstatistico,
          grauFundamentacao: data.grauFundamentacao,
          grauPrecisao: data.grauPrecisao,
          valorFinal: data.valorFinal,
          dadosInsuficientes: data.dadosInsuficientes,
          dadosInsuficientesMotivo: data.dadosInsuficientesMotivo,
        })
      }
    } catch {
      // Silently skip — a failed revision check shouldn't block the chat itself.
    } finally {
      setRevisionLoading(false)
    }
  }

  const applyRevision = () => {
    if (!revisionProposal) return
    const updated: AvaliacaoResultado = {
      ...current,
      parecer: revisionProposal.parecer,
      ...(revisionProposal.amostras ? { amostras: revisionProposal.amostras } : {}),
      ...(revisionProposal.tratamentoEstatistico ? { tratamentoEstatistico: revisionProposal.tratamentoEstatistico } : {}),
      ...(revisionProposal.grauFundamentacao ? { grauFundamentacao: revisionProposal.grauFundamentacao } : {}),
      ...(revisionProposal.grauPrecisao ? { grauPrecisao: revisionProposal.grauPrecisao } : {}),
      ...(revisionProposal.valorFinal ? { valorFinal: revisionProposal.valorFinal } : {}),
      ...(revisionProposal.dadosInsuficientes !== undefined ? { dadosInsuficientes: revisionProposal.dadosInsuficientes } : {}),
      ...(revisionProposal.dadosInsuficientesMotivo ? { dadosInsuficientesMotivo: revisionProposal.dadosInsuficientesMotivo } : {}),
    }
    setCurrent(updated)
    setValorMercado(String(revisionProposal.parecer.valorMercado))
    setFaixaMin(String(revisionProposal.parecer.faixaMin))
    setFaixaMax(String(revisionProposal.parecer.faixaMax))
    setLiquidez(revisionProposal.parecer.liquidez)
    setRevisionProposal(null)
  }

  const handleSend = async (text: string, attachment?: PendingAttachment) => {
    const next = [...messages, { role: 'user' as const, text, attachment }]
    setMessages(next)
    setChatBusy(true)
    setRevisionProposal(null)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          history: next.map((m) => ({ role: m.role, text: m.text })),
          image: attachment ? { url: attachment.blobUrl, mimeType: attachment.mimeType } : undefined,
          context: current,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string }
      const withReply = [...next, { role: 'model' as const, text: data.reply || data.error || 'Não foi possível responder.' }]
      setMessages(withReply)
      if (data.reply) requestRevision(withReply)
    } catch {
      setMessages((m) => [...m, { role: 'model', text: 'Não foi possível conectar à IA.' }])
    } finally {
      setChatBusy(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Fase 3 — Analista</h2>
        <p className="mt-1 text-[13.5px] text-muted">Revise o parecer gerado pela IA antes de aprovar.</p>
      </div>

      {current.dadosInsuficientes && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-red-300 uppercase tracking-wide">
            <AlertTriangle className="size-4" /> Amostras reais insuficientes
          </h3>
          <p className="mt-2 text-[13px] text-red-200/90 leading-relaxed">
            {current.dadosInsuficientesMotivo ||
              'Não foi possível reunir amostras reais suficientes num raio de até 500m do imóvel para uma precificação confiável pelo método comparativo direto.'}
          </p>
          <p className="mt-2 text-[12px] text-red-200/70">
            O valor abaixo é apenas uma estimativa aproximada — recomendamos pesquisa de campo complementar antes de aprovar este parecer.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11.5px] text-ink/90">{current.tipoImovel}</span>
              <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11.5px] text-ink/90">{current.finalidade}</span>
            </div>
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <Building2 className="size-4 text-brand-400" /> Caracterização
            </h3>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <p><span className="text-faint">Padrão construtivo: </span><span className="text-ink/90">{current.caracterizacao.padraoConstrutivo}</span></p>
              <p><span className="text-faint">Estado de conservação: </span><span className="text-ink/90">{current.caracterizacao.estadoConservacao}</span></p>
              <p className="sm:col-span-2"><span className="text-faint">Entorno: </span><span className="text-ink/90">{current.caracterizacao.descricaoEntorno}</span></p>
              <p className="sm:col-span-2"><span className="text-faint">Zoneamento: </span><span className="text-ink/90">{current.caracterizacao.zoneamento}</span></p>
            </div>
            {current.caracterizacao.patologias.length > 0 && (
              <div className="mt-4">
                <p className="text-[12px] text-faint mb-1.5">Patologias identificadas</p>
                <div className="flex flex-wrap gap-1.5">
                  {current.caracterizacao.patologias.map((p) => (
                    <span key={p} className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11.5px] text-amber-300">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <Scale className="size-4 text-brand-400" /> Método de avaliação
            </h3>
            <p className="mt-2 text-[13px] text-ink/90 font-medium">{current.metodo.metodo}</p>
            <p className="mt-1 text-[12.5px] text-muted leading-relaxed">{current.metodo.justificativa}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <MapPin className="size-4 text-brand-400" /> Amostras de mercado e homogeneização
            </h3>
            <p className="mt-1.5 text-[11.5px] text-faint">
              Todas as amostras vêm de anúncios reais encontrados na internet (link "Ver anúncio real") — a IA nunca inventa um comparável.
            </p>
            {current.buscaResumo && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
                <p className="text-[11.5px] text-muted">
                  A busca encontrou <span className="font-medium text-ink/90">{current.buscaResumo.total}</span> imóvel(is) real(is) na região
                  (todos os tipos, incluindo os que não viraram amostra por serem de tipo incompatível com o avaliando):
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(current.buscaResumo.porTipo).map(([tipo, qtd]) => (
                    <span key={tipo} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted">
                      {tipo}: {qtd}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {current.amostras.length === 0 ? (
              <p className="mt-4 text-[13px] text-muted italic">Nenhuma amostra real foi encontrada num raio de até 1000m deste imóvel.</p>
            ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-faint text-left">
                    <th className="font-medium pb-2 pr-3">Amostra</th>
                    <th className="font-medium pb-2 pr-3">Distância</th>
                    <th className="font-medium pb-2 pr-3">Área</th>
                    <th className="font-medium pb-2 pr-3">Valor unit.</th>
                    <th className="font-medium pb-2 pr-3">Fatores aplicados</th>
                    <th className="font-medium pb-2 pr-3">Valor unit. homog.</th>
                    <th className="font-medium pb-2">Mapa</th>
                  </tr>
                </thead>
                <tbody>
                  {current.amostras.map((a) => (
                    <tr key={a.id} className="border-t border-white/8 align-top">
                      <td className="py-2 pr-3 text-ink/90">
                        <div className="font-medium">{a.id} · {a.endereco}</div>
                        <div className="text-[11px] text-faint">{a.fonte} · {a.data}</div>
                        {a.url && (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 mt-0.5 text-[11px] text-emerald-400 hover:text-emerald-300"
                          >
                            <Link2 className="size-3" /> Ver anúncio real
                          </a>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted">{a.distanciaM} m</td>
                      <td className="py-2 pr-3 text-muted">{a.areaM2} m²</td>
                      <td className="py-2 pr-3 text-ink/90 font-medium">{currency(a.valorUnitario)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {a.fatoresAplicados.map((f) => (
                            <span
                              key={f.fator}
                              title={f.justificativa}
                              className="rounded-lg border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10.5px] text-muted"
                            >
                              {f.fator}: {f.valor.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-ink/90 font-semibold">{currency(a.valorUnitarioHomogeneizado)}</td>
                      <td className="py-2">
                        <a
                          href={mapsUrl(a.endereco)}
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
            {current.tratamentoEstatistico.amostrasExcluidas.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-[11.5px] text-faint">Amostras excluídas do tratamento:</p>
                {current.tratamentoEstatistico.amostrasExcluidas.map((e) => (
                  <p key={e.id} className="text-[11.5px] text-amber-300/90">{e.id}: {e.motivo}</p>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <BarChart3 className="size-4 text-brand-400" /> Tratamento estatístico
            </h3>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-[12.5px]">
              <p><span className="block text-faint text-[11px]">Média</span><span className="text-ink/90 font-medium">{currency(current.tratamentoEstatistico.media)}</span></p>
              <p><span className="block text-faint text-[11px]">Mediana</span><span className="text-ink/90 font-medium">{currency(current.tratamentoEstatistico.mediana)}</span></p>
              <p><span className="block text-faint text-[11px]">Mínimo</span><span className="text-ink/90 font-medium">{currency(current.tratamentoEstatistico.minimo)}</span></p>
              <p><span className="block text-faint text-[11px]">Máximo</span><span className="text-ink/90 font-medium">{currency(current.tratamentoEstatistico.maximo)}</span></p>
              <p><span className="block text-faint text-[11px]">Coef. de variação</span><span className="text-ink/90 font-medium">{current.tratamentoEstatistico.coeficienteVariacao.toFixed(1)}%</span></p>
              <p><span className="block text-faint text-[11px]">Amplitude</span><span className="text-ink/90 font-medium">{current.tratamentoEstatistico.amplitude.toFixed(1)}%</span></p>
              <p><span className="block text-faint text-[11px]">Amostras utilizadas</span><span className="text-ink/90 font-medium">{current.tratamentoEstatistico.amostrasUtilizadas}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
                  <Gauge className="size-4 text-brand-400" /> Grau de fundamentação
                </h3>
                <GrauBadge grau={current.grauFundamentacao.grauFinal} />
              </div>
              <div className="mt-4 space-y-2.5">
                {current.grauFundamentacao.itens.map((it) => (
                  <div key={it.item} className="text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="text-ink/90 font-medium">{it.item}</span>
                      <GrauBadge grau={it.grauAtingido} />
                    </div>
                    <p className="text-faint mt-0.5">{it.descricao}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 pt-3 border-t border-white/8 text-[12px] text-muted leading-relaxed">{current.grauFundamentacao.justificativa}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
                  <Target className="size-4 text-brand-400" /> Grau de precisão
                </h3>
                <GrauBadge grau={current.grauPrecisao.grauFinal} />
              </div>
              <div className="mt-4 space-y-2 text-[12.5px]">
                <p><span className="text-faint">Estimativa pontual: </span><span className="text-ink/90 font-medium">{currency(current.grauPrecisao.estimativaPontual)}</span></p>
                <p><span className="text-faint">Intervalo de confiança (80%): </span><span className="text-ink/90">{currency(current.grauPrecisao.limiteInferior)} – {currency(current.grauPrecisao.limiteSuperior)}</span></p>
                <p><span className="text-faint">Amplitude: </span><span className="text-ink/90 font-medium">{current.grauPrecisao.amplitude.toFixed(1)}%</span></p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <Banknote className="size-4 text-brand-400" /> Valor final
            </h3>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[12.5px]">
              <p><span className="block text-faint text-[11px]">Valor unitário</span><span className="text-ink/90 font-medium">{currency(current.valorFinal.valorUnitario)}/m²</span></p>
              <p><span className="block text-faint text-[11px]">Área avaliada</span><span className="text-ink/90 font-medium">{current.valorFinal.areaAvalianda} m²</span></p>
              <p><span className="block text-faint text-[11px]">Valor total</span><span className="text-ink/90 font-medium">{currency(current.valorFinal.valorTotal)}</span></p>
              <p><span className="block text-faint text-[11px]">Intervalo</span><span className="text-ink/90 font-medium">{currency(current.valorFinal.intervaloMin)} – {currency(current.valorFinal.intervaloMax)}</span></p>
              <p className="col-span-2 sm:col-span-1"><span className="block text-faint text-[11px]">Valor adotado</span><span className="text-ink/90 font-semibold">{currency(current.valorFinal.valorAdotado)}</span></p>
            </div>
            <p className="mt-3 pt-3 border-t border-white/8 text-[12px] text-muted leading-relaxed">{current.valorFinal.justificativaAdocao}</p>
          </div>

          {current.documentosAnalisados?.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
                <FileCheck className="size-4 text-brand-400" /> Documentação e fotos analisadas
              </h3>
              <div className="mt-4 space-y-3">
                {current.documentosAnalisados.map((d, i) => (
                  <div key={i} className="text-[13px]">
                    <p className="text-ink/90 font-medium">{d.label}</p>
                    <p className="text-muted">{d.resumo}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {current.divergencias.length > 0 && (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.04] p-5 sm:p-6">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-amber-300 uppercase tracking-wide">
                <AlertTriangle className="size-4" /> Divergências identificadas
              </h3>
              <div className="mt-4 space-y-3">
                {current.divergencias.map((d, i) => (
                  <div key={i} className="text-[13px]">
                    <p className="text-ink/90 font-medium">{d.campo} — {d.percentual}% de diferença</p>
                    <p className="text-muted">Vistoria: {d.valorVistoria} · Documento: {d.valorDocumento}</p>
                    <p className="text-amber-300/90 mt-0.5">{d.mensagem}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <MessageCircle className="size-4 text-brand-400" /> Perguntar ao Motor Central
            </h3>
            <p className="mt-1.5 mb-4 text-[12.5px] text-muted">
              Tire dúvidas ou questione o parecer — se o argumento for tecnicamente válido, a IA pode revisar o valor.
            </p>
            {messages.length > 0 && (
              <div className="mb-4 space-y-3 max-h-72 overflow-y-auto pr-1">
                {messages.map((m, i) => (
                  <div key={i} className={`text-[13px] ${m.role === 'user' ? 'text-ink' : 'text-muted'}`}>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-faint mr-1.5">
                      {m.role === 'user' ? 'Você' : 'IA'}
                    </span>
                    {m.text}
                  </div>
                ))}
                {chatBusy && <Loader2 className="size-3.5 animate-spin text-faint" />}
              </div>
            )}

            {revisionLoading && (
              <div className="mb-4 flex items-center gap-2 text-[12.5px] text-faint">
                <Loader2 className="size-3.5 animate-spin" /> Avaliando se o parecer deve ser revisado...
              </div>
            )}

            {revisionProposal && (
              <div className="mb-4 rounded-xl border border-brand-400/25 bg-brand-500/[0.06] p-4">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-300">
                  <Sparkles className="size-3.5" />
                  {revisionProposal.amostras ? 'A IA revisou as amostras e o parecer' : 'A IA sugere revisar o parecer'}
                </p>
                {revisionProposal.amostras && (
                  <p className="mt-1 text-[12px] text-brand-300/80">
                    {revisionProposal.amostras.length} amostra(s) atualizada(s) — estatísticas e graus recalculados.
                  </p>
                )}
                <p className="mt-1.5 text-[13px] text-ink/90">
                  Novo valor: <span className="font-semibold">{currency(revisionProposal.parecer.valorMercado)}</span>
                  {' '}(faixa {currency(revisionProposal.parecer.faixaMin)} – {currency(revisionProposal.parecer.faixaMax)}, liquidez {revisionProposal.parecer.liquidez})
                </p>
                <p className="mt-1.5 text-[12.5px] text-muted leading-relaxed">{revisionProposal.justificativa}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={applyRevision}
                    className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
                  >
                    Aplicar revisão
                  </button>
                  <button
                    onClick={() => setRevisionProposal(null)}
                    className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-white/5 hover:bg-white/10 text-muted transition-colors"
                  >
                    Manter valor atual
                  </button>
                </div>
              </div>
            )}

            <ChatInput onSend={handleSend} disabled={chatBusy} placeholder="Ex: por que a liquidez ficou Normal e não Alta?" />
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 flex flex-col items-center text-center">
            <IqgGauge score={current.iqg.score} classificacao={current.iqg.classificacao} size={130} />
            <p className="mt-3 text-[12px] text-muted">Índice de Qualidade da Garantia</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Parecer de valor</h3>
              <button onClick={() => setAdjusting((a) => !a)} className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300">
                <Pencil className="size-3" /> Ajustar
              </button>
            </div>

            {!adjusting ? (
              <>
                <p className="text-2xl font-display font-semibold text-ink">{currency(current.parecer.valorMercado)}</p>
                <p className="text-[12px] text-muted">Faixa: {currency(current.parecer.faixaMin)} – {currency(current.parecer.faixaMax)}</p>
                <p className="text-[12.5px] text-ink/80"><span className="text-faint">Liquidez: </span>{current.parecer.liquidez}</p>
                <p className="text-[12.5px] text-muted leading-relaxed border-t border-white/8 pt-3">{current.parecer.fundamentacao}</p>
              </>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-[11.5px] text-faint">Valor de mercado (R$)</span>
                  <input value={valorMercado} onChange={(e) => setValorMercado(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:border-brand-400/50" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11.5px] text-faint">Faixa mín.</span>
                    <input value={faixaMin} onChange={(e) => setFaixaMin(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:border-brand-400/50" />
                  </label>
                  <label className="block">
                    <span className="text-[11.5px] text-faint">Faixa máx.</span>
                    <input value={faixaMax} onChange={(e) => setFaixaMax(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:border-brand-400/50" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11.5px] text-faint">Liquidez</span>
                  <select value={liquidez} onChange={(e) => setLiquidez(e.target.value as typeof liquidez)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:border-brand-400/50">
                    {['Muito Alta', 'Alta', 'Normal', 'Baixa', 'Muito Baixa'].map((l) => (
                      <option key={l} value={l} className="bg-surface">{l}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <FinanciabilidadeBadge status={current.financiabilidade.status} detail={current.financiabilidade.motivos[0]} />

          <div className="flex flex-col gap-2">
            {adjusting ? (
              <button onClick={handleSaveAdjustment} className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all active:scale-95">
                Salvar ajuste e aprovar
              </button>
            ) : (
              <button onClick={handleApprove} className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-all active:scale-95 shadow-[0_0_20px_rgba(22,63,158,0.35)]">
                Aprovar parecer da IA
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default Fase3Analista
