import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Search,
  MapPinned,
  Link2,
  FileSearch,
  ScanEye,
  ShieldQuestion,
  ShieldCheck,
  ListChecks,
  BadgeCheck,
  Home,
  ClipboardCheck,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import type { AvaliacaoResultado, Amostra } from '@/lib/avaliacao-types'
import type { Fase1Result } from '@/components/wizard/fase1-vistoriador'

interface ComparavelReal {
  endereco: string
  areaM2: number | null
  distanciaM: number | null
  url: string
  tipoDetectado: string | null
  precisaoEndereco: 'exato' | 'condominio' | 'bairro'
}

const STEPS_BUSCA = [
  { icon: Search, label: 'Pesquisando o mercado imobiliário da região' },
  { icon: MapPinned, label: 'Calculando distância e localização de cada comparável' },
  { icon: Link2, label: 'Validando disponibilidade dos dados' },
]

const STEPS_GERACAO = [
  { icon: FileSearch, label: 'Analisando documentação (matrícula, IPTU, certidões)' },
  { icon: ScanEye, label: 'Processando fotos com visão computacional' },
  { icon: ShieldQuestion, label: 'Calculando liquidez, financiabilidade e IQG' },
]

const STEPS_VERIFICACAO = [
  { icon: ListChecks, label: 'Auditando consistência de valores e amostras' },
  { icon: ShieldCheck, label: 'Conferindo aderência à NBR 14.653' },
  { icon: BadgeCheck, label: 'Confirmando parecer final' },
]

const STEPS_CONFIRMACAO = [
  { icon: Home, label: 'Pesquisando preço real de mercado na região' },
  { icon: ClipboardCheck, label: 'Conferindo se o laudo está completo' },
  { icon: BadgeCheck, label: 'Confirmação final' },
]

type Fase = 'busca' | 'geracao' | 'verificacao' | 'confirmacao'

const FASE_INFO: Record<Fase, { titulo: string; steps: typeof STEPS_GERACAO }> = {
  busca: { titulo: 'Primeira passada — pesquisando o mercado imobiliário da região.', steps: STEPS_BUSCA },
  geracao: { titulo: 'Segunda passada — gerando a avaliação completa do imóvel.', steps: STEPS_GERACAO },
  verificacao: { titulo: 'Terceira passada — auditoria técnica do próprio trabalho.', steps: STEPS_VERIFICACAO },
  confirmacao: { titulo: 'Quarta passada — confirmação contra pesquisa real de mercado.', steps: STEPS_CONFIRMACAO },
}

interface Fase2Props {
  input: Fase1Result
  onComplete: (resultado: AvaliacaoResultado) => void
}

export function Fase2Processando({ input, onComplete }: Fase2Props) {
  const [fase, setFase] = useState<Fase>('busca')
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  const steps = FASE_INFO[fase].steps

  useEffect(() => {
    setStepIndex(0)
    const interval = setInterval(() => {
      setStepIndex((i) => (i < steps.length - 1 ? i + 1 : i))
    }, 3200)
    return () => clearInterval(interval)
  }, [fase, steps.length])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const run = async () => {
      try {
        // Passada dedicada só pra busca de amostras reais — separada da geração porque, na
        // mesma requisição, a busca teria que dividir o orçamento de 25s do Edge Function com
        // a geração (pesada), o que a esvaziava quase sempre. Sozinha, ela ganha um orçamento
        // bem maior e uma chance real de achar anúncios de verdade. Uma única invocação do
        // Edge Function ainda tem um teto rígido de 25s — o usuário pediu explicitamente pra
        // buscar o máximo possível, então encadeamos VÁRIAS chamadas (cada uma uma invocação
        // nova, com seu próprio orçamento de 25s), acumulando os resultados, até achar uma
        // quantidade boa de amostras reais ou esgotar o tempo total que vale a pena gastar
        // aqui. Uma falha em qualquer chamada não é fatal — /api/analyze busca por conta
        // própria se receber uma lista vazia.
        // BUG real encontrado e corrigido: com a busca por bairro (muito mais eficaz), 20 e
        // depois 15 deixaram de ser tetos seguros — confirmado via log real de produção
        // repetidas vezes: 32 comparáveis (4 lotes) falhou, ~16 (2 lotes) falhou com
        // TimeoutError DUAS VEZES SEGUIDAS mesmo já com nova tentativa automática (não é falta
        // de sorte, é o volume de dados que não cabe no tempo do servidor de forma consistente).
        // 10 é o próprio mínimo técnico exigido — corta o alvo exatamente nele: garante que a
        // passada de verificação (analyze-verify.ts, que reescreve a lista de amostras inteira
        // a cada chamada) sempre recebe o menor volume possível que ainda atende ao requisito.
        const ALVO_AMOSTRAS_FRONTEND = 10
        const MAX_CHAMADAS_BUSCA = 10
        const TEMPO_MAX_BUSCA_MS = 300_000
        let comparaveisReais: ComparavelReal[] = []
        const urlsVistas = new Set<string>()
        const inicioBusca = Date.now()
        // Reaproveitado entre chamadas — evita geocodificar o mesmo endereço avaliando do zero
        // a cada chamada encadeada (serviço de geocodificação gratuito, de uso justo).
        let origemCoords: { lat: number; lon: number } | undefined
        // Offset real de onde a chamada anterior parou de paginar — devolvido por
        // /api/find-amostras a cada resposta. Antes disto, cada chamada usava `chamada * 10`
        // como estimativa fixa, que não batia com quantas rodadas cabem de fato dentro do
        // orçamento de uma invocação (~7, não 10) — isso deixava página de resultado nunca
        // consultada a cada transição de chamada (bug real, corrigido junto com esta mudança).
        let proximoOffsetBase = 0
        for (let chamada = 0; chamada < MAX_CHAMADAS_BUSCA; chamada++) {
          if (comparaveisReais.length >= ALVO_AMOSTRAS_FRONTEND) break
          if (Date.now() - inicioBusca > TEMPO_MAX_BUSCA_MS) break
          try {
            const res0 = await fetch('/api/find-amostras', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                propertyData: input.propertyData,
                offsetBase: proximoOffsetBase,
                origemCoords,
                // BUG real encontrado e corrigido: sem isso, cada chamada encadeada
                // redescobria a MESMA página de catálogo (é estática) e gastava seu tempo de
                // geocodificação nos MESMOS candidatos já achados antes, nunca avançando pros
                // próximos — confirmado via log real (4 chamadas seguidas viram "34
                // candidatos", mas o total final travava em 3-6 amostras). Manda as URLs já
                // confirmadas pro backend pular elas e focar o tempo em candidatos novos.
                urlsJaVistas: [...urlsVistas],
              }),
            })
            const data0 = (await res0.json().catch(() => ({}))) as {
              comparaveisReais?: ComparavelReal[]
              origem?: { lat: number; lon: number } | null
              proximoOffsetBase?: number
            }
            if (!res0.ok || !Array.isArray(data0.comparaveisReais)) break // erro na chamada — para de tentar, segue com o que já tem
            if (data0.origem && !origemCoords) origemCoords = data0.origem
            if (typeof data0.proximoOffsetBase === 'number') proximoOffsetBase = data0.proximoOffsetBase
            const novos = data0.comparaveisReais.filter((c) => !urlsVistas.has(c.url))
            if (novos.length === 0) break // sem resultado novo nesta chamada — mais chamadas não ajudariam
            for (const c of novos) urlsVistas.add(c.url)
            // BUG real encontrado e corrigido: o corte no início do loop ("já bati o alvo, não
            // chamo de novo") não impedia UMA chamada de sozinha devolver mais candidatos do que
            // cabiam no alvo — com a busca por bairro achando dezenas de uma vez, isso permitia
            // passar longe do alvo (confirmado: 32 acumulados com alvo de 20). Corta aqui, logo
            // após somar, pra nunca ultrapassar o teto de verdade.
            comparaveisReais = [...comparaveisReais, ...novos].slice(0, ALVO_AMOSTRAS_FRONTEND)
          } catch {
            break // segue com o que já foi acumulado até aqui
          }
        }

        // Passada dedicada de homogeneização — separada da geração principal do laudo pelo
        // mesmo motivo da busca acima: gerar TODAS as até 15 amostras (com os 4 fatores de
        // homogeneização de cada uma) na MESMA chamada que também gera o laudo inteiro
        // estourava o limite de 25s do Edge Function (confirmado via teste real: 6 amostras já
        // chegavam a 23,7s, 8 estourava). Processa em lotes, cada lote uma invocação nova do
        // Edge Function com seu próprio limite de 25s — o usuário pediu explicitamente pra
        // aceitar demorar o quanto for preciso, mas entregar.
        const TAMANHO_LOTE_AMOSTRAS = 8
        let amostrasProntas: Amostra[] = []
        let algumLoteFuncionou = false
        // BUG real encontrado e corrigido: uma falha de rede/502 isolada num ÚNICO lote (8
        // comparáveis reais) descartava o lote inteiro em silêncio, sem tentar de novo — o
        // "buscaResumo" mostrado na Fase 3 continua contando esses comparáveis como
        // "encontrados", então o usuário via um número de amostras bem menor do que o total
        // exibido, sem nenhuma pista do motivo. Uma tentativa extra cobre a maioria das falhas
        // transitórias (a causa mais comum de um lote falhar sozinho enquanto os outros
        // funcionam); se as duas falharem, ao menos fica registrado no console pra
        // diagnosticar.
        const MAX_TENTATIVAS_POR_LOTE = 2
        for (let i = 0; i < comparaveisReais.length; i += TAMANHO_LOTE_AMOSTRAS) {
          const lote = comparaveisReais.slice(i, i + TAMANHO_LOTE_AMOSTRAS)
          let sucesso = false
          for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_POR_LOTE && !sucesso; tentativa++) {
            try {
              const resLote = await fetch('/api/generate-amostras', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ propertyData: input.propertyData, comparaveisReais: lote }),
              })
              const dataLote = (await resLote.json().catch(() => ({}))) as { amostras?: Amostra[]; error?: string }
              if (resLote.ok && Array.isArray(dataLote.amostras)) {
                amostrasProntas = [...amostrasProntas, ...dataLote.amostras]
                algumLoteFuncionou = true
                sucesso = true
              } else if (tentativa === MAX_TENTATIVAS_POR_LOTE) {
                console.error('[fase2] lote de amostras falhou após', tentativa, 'tentativa(s):', dataLote.error || resLote.status, '—', lote.length, 'comparável(is) real(is) perdido(s)')
              }
            } catch (err) {
              if (tentativa === MAX_TENTATIVAS_POR_LOTE) {
                console.error('[fase2] lote de amostras falhou após', tentativa, 'tentativa(s) (erro de rede):', err, '—', lote.length, 'comparável(is) real(is) perdido(s)')
              }
            }
          }
        }
        // Só manda "amostrasProntas" se pelo menos 1 lote funcionou (ou se não havia
        // comparáveis pra processar) — se TODOS os lotes falharam apesar de haver comparáveis
        // reais, é melhor deixar /api/analyze cair no caminho antigo (gerar amostras ele
        // mesmo, capado em 5) do que entregar uma lista vazia e fazer o laudo achar que não há
        // dados suficientes quando, na real, os comparáveis existem — só a geração falhou.
        const amostrasProntasFinal = comparaveisReais.length === 0 || algumLoteFuncionou ? amostrasProntas : undefined

        setFase('geracao')

        // BUG real encontrado e corrigido: chamadas de IA de ponta a ponta (geração + 2
        // verificações) têm latência natural do próprio Gemini que varia de chamada pra
        // chamada — confirmado via teste real: a MESMA etapa (analyze-verify) estourou o tempo
        // do servidor numa tentativa e, minutos depois com o MESMO endereço, funcionou normal.
        // Um "Recomeçar" manual do usuário já resolvia (a nova tentativa geralmente passa), mas
        // isso não pode depender do usuário perceber e clicar de novo — pedido explícito:
        // "estes erros não podem acontecer". Cada uma das 3 etapas agora tenta uma 2ª vez,
        // sozinha, antes de mostrar qualquer erro pro usuário.
        const MAX_TENTATIVAS_ETAPA = 2
        async function chamarComRetry(
          url: string,
          body: unknown,
          rotulo: string,
        ): Promise<{ resultado?: AvaliacaoResultado; error?: string }> {
          let ultimoErro = 'Falha desconhecida.'
          for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_ETAPA; tentativa++) {
            try {
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              })
              const data = (await res.json().catch(() => ({}))) as { resultado?: AvaliacaoResultado; error?: string }
              if (res.ok && data.resultado) return data
              ultimoErro = data.error || `Falha em ${rotulo}.`
            } catch {
              ultimoErro = 'Não foi possível conectar ao motor de análise.'
            }
            if (tentativa < MAX_TENTATIVAS_ETAPA) {
              console.error(`[fase2] ${rotulo} falhou (tentativa ${tentativa}):`, ultimoErro, '— tentando de novo')
            }
          }
          console.error(`[fase2] ${rotulo} falhou após ${MAX_TENTATIVAS_ETAPA} tentativas:`, ultimoErro)
          return { error: ultimoErro }
        }

        const data1 = await chamarComRetry(
          '/api/analyze',
          { ...input, comparaveisReais, amostrasProntas: amostrasProntasFinal },
          'geração da análise',
        )
        if (!data1.resultado) {
          setError(data1.error || 'Falha ao gerar a análise. Tente novamente.')
          return
        }

        const documentLabels = [...input.photos, ...input.documents].map((f) => f.label)

        setFase('verificacao')

        const data2 = await chamarComRetry(
          '/api/analyze-verify',
          { propertyData: input.propertyData, resultado: data1.resultado, temFotos: input.photos.length > 0, documentLabels },
          'segunda verificação técnica',
        )
        if (!data2.resultado) {
          setError(data2.error || 'Falha na segunda verificação técnica. Tente novamente.')
          return
        }

        setFase('confirmacao')

        const data3 = await chamarComRetry(
          '/api/analyze-confirm',
          { propertyData: input.propertyData, resultado: data2.resultado, temFotos: input.photos.length > 0, documentLabels },
          'confirmação final',
        )
        if (!data3.resultado) {
          setError(data3.error || 'Falha na confirmação final. Tente novamente.')
          return
        }

        // Resumo bruto de tudo que a busca encontrou de verdade (todos os tipos, não só o que
        // virou amostra) — pedido explícito do usuário: poder ver quantos imóveis reais existem
        // de fato na região, mesmo os que não entram no cálculo por serem de tipo incompatível
        // com o avaliando (ex.: casas encontradas perto de um apartamento). Calculado no
        // front-end a partir da mesma lista já usada pra gerar o laudo, sem chamada extra.
        const porTipo: Record<string, number> = {}
        for (const c of comparaveisReais) {
          const chave = c.tipoDetectado || 'Não identificado'
          porTipo[chave] = (porTipo[chave] || 0) + 1
        }
        onComplete({ ...data3.resultado, buscaResumo: { total: comparaveisReais.length, porTipo } })
      } catch {
        setError('Não foi possível conectar ao motor de análise.')
      }
    }
    run()
  }, [input, onComplete])

  if (error) {
    return (
      <div className="flex flex-col items-center text-center py-16 gap-4">
        <div className="flex items-center justify-center size-14 rounded-lg bg-red-500/10 text-red-400">
          <AlertTriangle className="size-6" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">Não foi possível concluir a análise</h3>
          <p className="mt-1.5 text-[13.5px] text-muted max-w-md">{error}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 text-ink transition-colors"
        >
          Recomeçar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center text-center py-14 gap-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Fase 2 — Motor Central de IA</h2>
        <p className="mt-1.5 text-[13.5px] text-muted max-w-md">{FASE_INFO[fase].titulo}</p>
        <p className="mt-1 text-[12px] text-faint">Isso pode levar até alguns minutos — preferimos demorar a entregar algo incorreto.</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {steps.map((step, i) => {
          const active = i === stepIndex
          const done = i < stepIndex
          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: done || active ? 1 : 0.35, x: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-3 text-left"
            >
              <div
                className={`flex items-center justify-center size-8 rounded-full shrink-0 ${
                  done ? 'bg-emerald-500/15 text-emerald-400' : active ? 'bg-brand-500/15 text-brand-400' : 'bg-white/5 text-faint'
                }`}
              >
                {active ? <Loader2 className="size-4 animate-spin" /> : <step.icon className="size-4" />}
              </div>
              <span className={`text-[13px] ${active ? 'text-ink font-medium' : 'text-muted'}`}>{step.label}</span>
            </motion.div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-faint">
        <span className={`size-1.5 rounded-full ${fase === 'busca' ? 'bg-brand-400' : 'bg-white/15'}`} />
        1ª busca de amostras
        <span className="mx-0.5">→</span>
        <span className={`size-1.5 rounded-full ${fase === 'geracao' ? 'bg-brand-400' : 'bg-white/15'}`} />
        2ª geração
        <span className="mx-0.5">→</span>
        <span className={`size-1.5 rounded-full ${fase === 'verificacao' ? 'bg-brand-400' : 'bg-white/15'}`} />
        3ª auditoria
        <span className="mx-0.5">→</span>
        <span className={`size-1.5 rounded-full ${fase === 'confirmacao' ? 'bg-brand-400' : 'bg-white/15'}`} />
        4ª confirmação
      </div>
    </div>
  )
}

export default Fase2Processando
