import type { ReactNode } from 'react'
import {
  Building2,
  MapPin,
  AlertTriangle,
  ExternalLink,
  Link2,
  Scale,
  BarChart3,
  Target,
  Gauge,
  Banknote,
  FileCheck,
  Wallet,
} from 'lucide-react'
import { IqgGauge } from '@/components/ui/iqg-gauge'
import { FinanciabilidadeBadge } from '@/components/ui/financiabilidade-badge'
import { currency } from '@/lib/format'
import type { AvaliacaoResultado, GrauNBR } from '@/lib/avaliacao-types'
import type { AvmResultado as AvmResultadoData } from '@/lib/avm-types'

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

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-surface/60 p-5 sm:p-6 ${className ?? ''}`}>{children}</div>
}

/** Versão SOMENTE LEITURA da Fase 3 (Analista) — mesmos blocos visuais, sem chat/edição/
 * aprovação, usada pra reexibir um laudo do Empresa Avaliadora já entregue, a partir do
 * histórico salvo em "Minha Conta". */
function DetalheEmpresaAvaliadora({ r }: { r: AvaliacaoResultado }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        {r.dadosInsuficientes && (
          <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-red-300 uppercase tracking-wide">
              <AlertTriangle className="size-4" /> Amostras reais insuficientes
            </h3>
            <p className="mt-2 text-[13px] text-red-200/90 leading-relaxed">{r.dadosInsuficientesMotivo}</p>
          </div>
        )}

        <Card>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11.5px] text-ink/90">{r.tipoImovel}</span>
            <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11.5px] text-ink/90">{r.finalidade}</span>
          </div>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
            <Building2 className="size-4 text-brand-400" /> Caracterização
          </h3>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <p><span className="text-faint">Padrão construtivo: </span><span className="text-ink/90">{r.caracterizacao.padraoConstrutivo}</span></p>
            <p><span className="text-faint">Estado de conservação: </span><span className="text-ink/90">{r.caracterizacao.estadoConservacao}</span></p>
            <p className="sm:col-span-2"><span className="text-faint">Entorno: </span><span className="text-ink/90">{r.caracterizacao.descricaoEntorno}</span></p>
            <p className="sm:col-span-2"><span className="text-faint">Zoneamento: </span><span className="text-ink/90">{r.caracterizacao.zoneamento}</span></p>
          </div>
          {r.caracterizacao.patologias.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {r.caracterizacao.patologias.map((p) => (
                <span key={p} className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11.5px] text-amber-300">{p}</span>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
            <Scale className="size-4 text-brand-400" /> Método de avaliação
          </h3>
          <p className="mt-2 text-[13px] text-ink/90 font-medium">{r.metodo.metodo}</p>
          <p className="mt-1 text-[12.5px] text-muted leading-relaxed">{r.metodo.justificativa}</p>
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
            <MapPin className="size-4 text-brand-400" /> Amostras de mercado e homogeneização
          </h3>
          {r.buscaResumo && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
              <p className="text-[11.5px] text-muted">
                A busca encontrou <span className="font-medium text-ink/90">{r.buscaResumo.total}</span> imóvel(is) real(is) na região:
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(r.buscaResumo.porTipo).map(([tipo, qtd]) => (
                  <span key={tipo} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted">{tipo}: {qtd}</span>
                ))}
              </div>
            </div>
          )}
          {r.amostras.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted italic">Nenhuma amostra real foi encontrada dentro do raio de busca deste imóvel.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-faint text-left">
                    <th className="font-medium pb-2 pr-3">Amostra</th>
                    <th className="font-medium pb-2 pr-3">Distância</th>
                    <th className="font-medium pb-2 pr-3">Área</th>
                    <th className="font-medium pb-2 pr-3">Valor unit.</th>
                    <th className="font-medium pb-2 pr-3">Valor unit. homog.</th>
                    <th className="font-medium pb-2">Mapa</th>
                  </tr>
                </thead>
                <tbody>
                  {r.amostras.map((a) => (
                    <tr key={a.id} className="border-t border-white/8 align-top">
                      <td className="py-2 pr-3 text-ink/90">
                        <div className="font-medium">{a.id} · {a.endereco}</div>
                        <div className="text-[11px] text-faint">{a.fonte} · {a.data}</div>
                        {a.url && (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 mt-0.5 text-[11px] text-emerald-400 hover:text-emerald-300">
                            <Link2 className="size-3" /> Ver anúncio real
                          </a>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted">{a.distanciaM} m</td>
                      <td className="py-2 pr-3 text-muted">{a.areaM2} m²</td>
                      <td className="py-2 pr-3 text-ink/90 font-medium">{currency(a.valorUnitario)}</td>
                      <td className="py-2 pr-3 text-ink/90 font-semibold">{currency(a.valorUnitarioHomogeneizado)}</td>
                      <td className="py-2">
                        <a href={mapsUrl(a.endereco)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-brand-400 hover:text-brand-300">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
            <BarChart3 className="size-4 text-brand-400" /> Tratamento estatístico
          </h3>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-[12.5px]">
            <p><span className="block text-faint text-[11px]">Média</span><span className="text-ink/90 font-medium">{currency(r.tratamentoEstatistico.media)}</span></p>
            <p><span className="block text-faint text-[11px]">Mediana</span><span className="text-ink/90 font-medium">{currency(r.tratamentoEstatistico.mediana)}</span></p>
            <p><span className="block text-faint text-[11px]">Mínimo</span><span className="text-ink/90 font-medium">{currency(r.tratamentoEstatistico.minimo)}</span></p>
            <p><span className="block text-faint text-[11px]">Máximo</span><span className="text-ink/90 font-medium">{currency(r.tratamentoEstatistico.maximo)}</span></p>
            <p><span className="block text-faint text-[11px]">Coef. de variação</span><span className="text-ink/90 font-medium">{r.tratamentoEstatistico.coeficienteVariacao.toFixed(1)}%</span></p>
            <p><span className="block text-faint text-[11px]">Amplitude</span><span className="text-ink/90 font-medium">{r.tratamentoEstatistico.amplitude.toFixed(1)}%</span></p>
            <p><span className="block text-faint text-[11px]">Amostras utilizadas</span><span className="text-ink/90 font-medium">{r.tratamentoEstatistico.amostrasUtilizadas}</span></p>
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
                <Gauge className="size-4 text-brand-400" /> Grau de fundamentação
              </h3>
              <GrauBadge grau={r.grauFundamentacao.grauFinal} />
            </div>
            <div className="mt-4 space-y-2.5">
              {r.grauFundamentacao.itens.map((it) => (
                <div key={it.item} className="text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ink/90 font-medium">{it.item}</span>
                    <GrauBadge grau={it.grauAtingido} />
                  </div>
                  <p className="text-faint mt-0.5">{it.descricao}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
                <Target className="size-4 text-brand-400" /> Grau de precisão
              </h3>
              <GrauBadge grau={r.grauPrecisao.grauFinal} />
            </div>
            <div className="mt-4 space-y-2 text-[12.5px]">
              <p><span className="text-faint">Estimativa pontual: </span><span className="text-ink/90 font-medium">{currency(r.grauPrecisao.estimativaPontual)}</span></p>
              <p><span className="text-faint">Intervalo de confiança (80%): </span><span className="text-ink/90">{currency(r.grauPrecisao.limiteInferior)} – {currency(r.grauPrecisao.limiteSuperior)}</span></p>
            </div>
          </Card>
        </div>

        <Card>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
            <Banknote className="size-4 text-brand-400" /> Valor final
          </h3>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[12.5px]">
            <p><span className="block text-faint text-[11px]">Valor unitário</span><span className="text-ink/90 font-medium">{currency(r.valorFinal.valorUnitario)}/m²</span></p>
            <p><span className="block text-faint text-[11px]">Área avaliada</span><span className="text-ink/90 font-medium">{r.valorFinal.areaAvalianda} m²</span></p>
            <p><span className="block text-faint text-[11px]">Valor total</span><span className="text-ink/90 font-medium">{currency(r.valorFinal.valorTotal)}</span></p>
          </div>
          <p className="mt-3 pt-3 border-t border-white/8 text-[12px] text-muted leading-relaxed">{r.valorFinal.justificativaAdocao}</p>
        </Card>

        {r.documentosAnalisados?.length > 0 && (
          <Card>
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
              <FileCheck className="size-4 text-brand-400" /> Documentação e fotos analisadas
            </h3>
            <div className="mt-4 space-y-3">
              {r.documentosAnalisados.map((d, i) => (
                <div key={i} className="text-[13px]">
                  <p className="text-ink/90 font-medium">{d.label}</p>
                  <p className="text-muted">{d.resumo}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {r.divergencias.length > 0 && (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.04] p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-amber-300 uppercase tracking-wide">
              <AlertTriangle className="size-4" /> Divergências identificadas
            </h3>
            <div className="mt-4 space-y-3">
              {r.divergencias.map((d, i) => (
                <div key={i} className="text-[13px]">
                  <p className="text-ink/90 font-medium">{d.campo} — {d.percentual}% de diferença</p>
                  <p className="text-amber-300/90 mt-0.5">{d.mensagem}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[12.5px] text-muted leading-relaxed">{r.descricaoLaudo}</p>
      </div>

      <div className="space-y-5">
        <Card className="flex flex-col items-center text-center">
          <IqgGauge score={r.iqg.score} classificacao={r.iqg.classificacao} size={130} />
          <p className="mt-3 text-[12px] text-muted">Índice de Qualidade da Garantia</p>
        </Card>

        <Card>
          <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Parecer de valor</h3>
          <p className="mt-3 text-2xl font-display font-semibold text-ink">{currency(r.parecer.valorMercado)}</p>
          <p className="text-[12px] text-muted">Faixa: {currency(r.parecer.faixaMin)} – {currency(r.parecer.faixaMax)}</p>
          <p className="mt-1 text-[12.5px] text-ink/80"><span className="text-faint">Liquidez: </span>{r.parecer.liquidez}</p>
          <p className="mt-3 text-[12.5px] text-muted leading-relaxed border-t border-white/8 pt-3">{r.parecer.fundamentacao}</p>
        </Card>

        <FinanciabilidadeBadge status={r.financiabilidade.status} detail={r.financiabilidade.motivos[0]} />
      </div>
    </div>
  )
}

/** Versão SOMENTE LEITURA do resultado AVM, reexibindo um relatório já entregue a partir do
 * histórico. Mesmos blocos visuais de src/components/avm/avm-resultado.tsx, sem o botão de
 * gerar PDF (o histórico não guarda os dados originais do vistoriador nem os anexos). */
function DetalheAvm({ r }: { r: AvmResultadoData }) {
  return (
    <div className="space-y-5">
      {r.dadosInsuficientes && (
        <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-red-300 uppercase tracking-wide">
            <AlertTriangle className="size-4" /> Comparáveis reais insuficientes
          </h3>
          <p className="mt-2 text-[13px] text-red-200/90 leading-relaxed">{r.dadosInsuficientesMotivo}</p>
        </div>
      )}

      <Card className="text-center">
        <p className="text-[12px] text-faint uppercase tracking-wide">Valor de mercado estimado</p>
        <p className="mt-2 text-3xl sm:text-4xl font-display font-semibold text-ink">{currency(r.valorMercado)}</p>
        <p className="mt-1.5 text-[13px] text-muted">Faixa: {currency(r.faixaMin)} – {currency(r.faixaMax)} · Liquidez {r.liquidez}</p>
      </Card>

      <Card>
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink/90 uppercase tracking-wide">
          <MapPin className="size-4 text-brand-400" /> Comparáveis usados
        </h3>
        {r.comparaveis.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted italic">Nenhum comparável real foi encontrado.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-faint text-left">
                  <th className="font-medium pb-2 pr-3">Endereço</th>
                  <th className="font-medium pb-2 pr-3">Distância</th>
                  <th className="font-medium pb-2 pr-3">Área</th>
                  <th className="font-medium pb-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {r.comparaveis.map((c, i) => (
                  <tr key={i} className="border-t border-white/8">
                    <td className="py-2 pr-3 text-ink/90">
                      {c.endereco}
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 mt-0.5 text-[11px] text-emerald-400 hover:text-emerald-300">
                          <Link2 className="size-3" /> Ver anúncio real
                        </a>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted">{c.distanciaM} m</td>
                    <td className="py-2 pr-3 text-muted">{c.areaM2} m²</td>
                    <td className="py-2 text-ink/90 font-medium">{currency(c.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[12.5px] text-muted leading-relaxed border-t border-white/8 pt-3">{r.fundamentacao}</p>
      </Card>

      <FinanciabilidadeBadge status={r.financiabilidade.status} detail={r.financiabilidade.motivos[0]} />

      <Card className="border-brand-400/20 bg-brand-500/[0.05]">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-brand-300 uppercase tracking-wide">
          <Wallet className="size-4" /> Orientação de crédito
        </h3>
        <p className="mt-2 text-[13px] text-ink/90">LTV máximo recomendado: <span className="font-semibold">{r.orientacaoCredito.ltvMaximoRecomendado}%</span></p>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">{r.orientacaoCredito.texto}</p>
      </Card>
    </div>
  )
}

interface ResultadoCarteiraLinha {
  linha: number
  valorEstimado: number
  liquidez: string
  iqgScore: number
  classificacaoIqg: string
}

const IQG_CLASS_STYLE: Record<string, string> = {
  Premium: 'text-emerald-400 bg-emerald-400/10',
  'Atenção': 'text-gold-400 bg-gold-500/10',
  Inadequada: 'text-red-400 bg-red-500/10',
}

/** Versão SOMENTE LEITURA de um lote de Reavaliação de Carteiras já processado. O histórico só
 * guarda o resultado gerado (não o CSV original enviado), então a exibição é por número de
 * linha — ainda assim dá pra ver o valor, liquidez e IQG que cada imóvel da carteira recebeu. */
function DetalhePortfolio({ r }: { r: { resultados?: ResultadoCarteiraLinha[] } }) {
  const linhas = r.resultados || []
  const valorTotal = linhas.reduce((acc, l) => acc + (l.valorEstimado || 0), 0)
  return (
    <div className="space-y-5">
      <Card className="text-center">
        <p className="text-[12px] text-faint uppercase tracking-wide">Valor total da carteira reavaliada</p>
        <p className="mt-2 text-3xl sm:text-4xl font-display font-semibold text-ink">{currency(valorTotal)}</p>
        <p className="mt-1.5 text-[13px] text-muted">{linhas.length} imóve{linhas.length === 1 ? 'l' : 'is'}</p>
      </Card>
      <Card>
        <h3 className="text-[13px] font-semibold text-ink/90 uppercase tracking-wide">Reavaliação por imóvel</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-faint text-left">
                <th className="font-medium pb-2 pr-3">Linha</th>
                <th className="font-medium pb-2 pr-3">Valor estimado</th>
                <th className="font-medium pb-2 pr-3">Liquidez</th>
                <th className="font-medium pb-2">IQG</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.linha} className="border-t border-white/8">
                  <td className="py-2 pr-3 text-ink/90 font-medium">#{l.linha}</td>
                  <td className="py-2 pr-3 text-ink/90">{currency(l.valorEstimado)}</td>
                  <td className="py-2 pr-3 text-muted">{l.liquidez}</td>
                  <td className="py-2">
                    <span className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${IQG_CLASS_STYLE[l.classificacaoIqg] ?? 'text-muted bg-white/5'}`}>
                      {l.iqgScore} · {l.classificacaoIqg}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

interface EvaluationDetailProps {
  module: string
  resultado: unknown
}

/** Escolhe o dashboard certo pra reexibir uma avaliação já concluída, a partir do "module"
 * salvo junto com ela no histórico ("Minha Conta") — cada módulo tem um formato de resultado
 * bem diferente (laudo NBR completo x estimativa AVM x lote de carteira). */
export function EvaluationDetail({ module, resultado }: EvaluationDetailProps) {
  if (module === 'empresa_avaliadora') return <DetalheEmpresaAvaliadora r={resultado as AvaliacaoResultado} />
  if (module === 'avm') return <DetalheAvm r={resultado as AvmResultadoData} />
  if (module === 'portfolio') return <DetalhePortfolio r={resultado as { resultados?: ResultadoCarteiraLinha[] }} />
  return (
    <Card>
      <p className="text-[13px] text-muted">Não foi possível exibir os detalhes deste tipo de avaliação.</p>
    </Card>
  )
}

export default EvaluationDetail
