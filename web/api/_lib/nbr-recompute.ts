// ---------------------------------------------------------------------------
// Cálculo determinístico dos graus da NBR 14653-2 — a IA propõe, mas os
// números finais são sempre recalculados aqui a partir dos dados reais do
// próprio resultado (nunca aceitos apenas porque a IA disse que sim).
// Compartilhado entre a primeira geração (api/analyze.ts) e a segunda
// passada de verificação (api/analyze-verify.ts) para que ambas apliquem
// exatamente as mesmas regras.
// ---------------------------------------------------------------------------

export type GrauNBR = 'I' | 'II' | 'III'
export const GRAU_ORDEM: Record<GrauNBR, number> = { I: 1, II: 2, III: 3 }
export const GRAU_POR_ORDEM: GrauNBR[] = ['I', 'II', 'III']

function media(valores: number[]): number {
  return valores.reduce((a, b) => a + b, 0) / valores.length
}

function mediana(valores: number[]): number {
  const s = [...valores].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function classificarItemQuantidade(n: number): { grau: GrauNBR; nota: string } {
  if (n >= 12) return { grau: 'III', nota: '' }
  if (n >= 5) return { grau: 'II', nota: '' }
  if (n >= 3) return { grau: 'I', nota: '' }
  return { grau: 'I', nota: ` (apenas ${n} amostra(s) — abaixo do mínimo de 3 previsto na norma; grau I atribuído como piso técnico)` }
}

export function classificarItemIntervaloFatores(fatoresValores: number[]): { grau: GrauNBR; nota: string } {
  if (fatoresValores.length === 0) return { grau: 'I', nota: ' (nenhum fator de homogeneização informado)' }
  const max = Math.max(...fatoresValores)
  const min = Math.min(...fatoresValores)
  if (min >= 0.8 && max <= 1.25) return { grau: 'III', nota: '' }
  if (min >= 0.5 && max <= 2.0) return { grau: 'II', nota: '' }
  if (min >= 0.4 && max <= 2.5) return { grau: 'I', nota: '' }
  return { grau: 'I', nota: ' (fatores fora do intervalo admissível de 0,40–2,50 da norma)' }
}

export function classificarGrauPrecisao(estimativa: number, inferior: number, superior: number) {
  const amplitude = estimativa > 0 ? (Math.abs(superior - inferior) / estimativa) * 100 : 100
  let grauFinal: GrauNBR = 'I'
  if (amplitude <= 30) grauFinal = 'III'
  else if (amplitude <= 40) grauFinal = 'II'
  return { estimativaPontual: estimativa, limiteInferior: inferior, limiteSuperior: superior, amplitude, grauFinal }
}

export interface FatorAplicado {
  fator: string
  valor: number
  origem: string
  justificativa: string
  campoAplicacao: string
  abrangenciaRegional: string
  abrangenciaTemporal: string
}

export interface AmostraIA {
  id: string
  valorUnitario: number
  fatoresAplicados: FatorAplicado[]
  url?: string
  [key: string]: unknown
}

/** Amostras SÓ podem ser reais — a IA às vezes inventa uma amostra inteira (endereço, "url"
 * em domínio inventado etc.) mesmo sendo instruída a nunca fazer isso (confirmado: endereço
 * sem resultado de busca real, e mesmo assim a IA devolveu 5 amostras com "url" fabricadas).
 * Nunca confiamos no campo "url" só porque a IA o preencheu — qualquer amostra cuja "url" não
 * esteja literalmente na lista que nós mesmos validamos (busca real + link ainda no ar) é
 * REMOVIDA do array inteiro (não basta apagar a url — a amostra toda é inventada, não deve
 * aparecer no laudo como se fosse uma referência real). */
export function sanitizarUrlsAmostras(resultado: Record<string, unknown>, urlsPermitidas: ReadonlySet<string>): void {
  const amostras = resultado.amostras as AmostraIA[] | undefined
  if (!Array.isArray(amostras)) return
  resultado.amostras = amostras.filter((a) => a.url && urlsPermitidas.has(a.url))
}

/** Recomputa o valor unitário homogeneizado de cada amostra (valor unitário × produto dos fatores)
 * e as estatísticas do tratamento (média, mediana, CV, amplitude) a partir desses valores —
 * nunca aceita a aritmética da IA como definitiva. */
export function recalcularTratamento(amostras: AmostraIA[], excluidas: { id: string; motivo: string }[]) {
  const homogeneizados = amostras.map((a) => {
    const produtoFatores = a.fatoresAplicados.reduce((acc, f) => acc * (Number.isFinite(f.valor) ? f.valor : 1), 1)
    const valorUnitarioHomogeneizado = Math.round(a.valorUnitario * produtoFatores * 100) / 100
    return { ...a, valorUnitarioHomogeneizado }
  })

  const valores = homogeneizados.map((a) => a.valorUnitarioHomogeneizado)
  // Sem amostras (dadosInsuficientes), min/max/média não têm o que computar — 0 em vez de
  // Infinity/-Infinity/NaN, que quebrariam a serialização JSON (JSON.stringify(Infinity) vira
  // null) e o schema do frontend, que espera sempre um number aqui.
  const m = valores.length > 0 ? media(valores) : 0
  const mn = valores.length > 0 ? Math.min(...valores) : 0
  const mx = valores.length > 0 ? Math.max(...valores) : 0
  const desvio = valores.length > 0 ? Math.sqrt(valores.reduce((acc, v) => acc + (v - m) ** 2, 0) / valores.length) : 0
  const tratamentoEstatistico = {
    media: m,
    mediana: valores.length > 0 ? mediana(valores) : 0,
    minimo: mn,
    maximo: mx,
    coeficienteVariacao: m > 0 ? (desvio / m) * 100 : 0,
    amplitude: m > 0 ? ((mx - mn) / m) * 100 : 0,
    amostrasUtilizadas: amostras.length,
    amostrasExcluidas: excluidas,
  }

  return { amostrasHomogeneizadas: homogeneizados, tratamentoEstatistico }
}

/** Aplica todo o recálculo determinístico da NBR 14653-2 sobre um resultado bruto vindo da IA
 * (seja a primeira geração ou a segunda passada de verificação), mutando os campos relevantes
 * em-place. `semFotos` vem de fora porque cada chamada decide como obter essa informação. */
export function recalcularResultadoNBR(resultado: Record<string, unknown>, semFotos: boolean): void {
  try {
    const amostras = (resultado.amostras as AmostraIA[]) || []
    const tratIA = (resultado.tratamentoEstatistico as { amostrasExcluidas?: { id: string; motivo: string }[] }) || {}
    const { amostrasHomogeneizadas, tratamentoEstatistico } = recalcularTratamento(amostras, tratIA.amostrasExcluidas || [])
    resultado.amostras = amostrasHomogeneizadas
    resultado.tratamentoEstatistico = tratamentoEstatistico

    // Nunca confiamos na IA para decidir "dadosInsuficientes" — é derivado deterministicamente
    // da contagem real de amostras. Piso de 6 pedido explicitamente pelo usuário (subiu de 5,
    // mais rígido ainda que o piso técnico da norma, que tecnicamente aceita Grau I com só 3 —
    // ver classificarItemQuantidade acima). Confirmado por teste real que a IA às vezes reporta
    // false mesmo com poucas amostras.
    resultado.dadosInsuficientes = amostrasHomogeneizadas.length < 10
    if (resultado.dadosInsuficientes && !resultado.dadosInsuficientesMotivo) {
      // BUG real encontrado e corrigido: o texto dizia sempre "num raio de até 1000m", mas o
      // raio real de busca varia por tipo de imóvel (1000m pra tipos densos, 2000m pra tipos de
      // baixa densidade — ver RAIO_BAIXA_DENSIDADE_M em real-comparaveis.ts). Esta função não
      // recebe o tipo do imóvel, então não tem como saber qual raio foi de fato usado — melhor
      // não afirmar um número que pode estar errado do que informar um valor impreciso num
      // laudo formal.
      resultado.dadosInsuficientesMotivo = `Apenas ${amostrasHomogeneizadas.length} amostra(s) real(is) encontrada(s) dentro do raio de busca configurado para este tipo de imóvel — abaixo do mínimo de 10 amostras exigido para uma precificação confiável pelo método comparativo direto.`
    }

    // --- Ancora o valor final matematicamente na média das amostras homogeneizadas ---
    // Sem isso, a IA podia "declarar" um parecer.valorMercado desconectado do que as
    // próprias amostras computavam (isso é o que estava puxando o valor pra muito
    // abaixo do mercado) — no método comparativo direto, o valor TEM que vir das
    // amostras, não ser um número à parte que só coincide por acaso.
    const vfAntes = resultado.valorFinal as { areaAvalianda?: number; justificativaAdocao?: string } | undefined
    const areaAvalianda = Number(vfAntes?.areaAvalianda) || 0
    if (areaAvalianda > 0 && tratamentoEstatistico.media > 0) {
      const valorUnitario = Math.round(tratamentoEstatistico.media * 100) / 100
      const valorTotal = Math.round(valorUnitario * areaAvalianda * 100) / 100
      const faixaMin = Math.round(tratamentoEstatistico.minimo * areaAvalianda * 100) / 100
      const faixaMax = Math.round(tratamentoEstatistico.maximo * areaAvalianda * 100) / 100

      resultado.valorFinal = {
        ...vfAntes,
        valorUnitario,
        areaAvalianda,
        valorTotal,
        intervaloMin: faixaMin,
        intervaloMax: faixaMax,
        valorAdotado: valorTotal,
        justificativaAdocao:
          vfAntes?.justificativaAdocao ||
          'Valor adotado igual à média dos valores unitários homogeneizados das amostras multiplicada pela área avalianda.',
      }

      const parecerAntes = resultado.parecer as Record<string, unknown> | undefined
      resultado.parecer = { ...parecerAntes, valorMercado: valorTotal, faixaMin, faixaMax }
    }

    const gp = resultado.grauPrecisao as { estimativaPontual: number; limiteInferior: number; limiteSuperior: number } | undefined
    const parecerAtual = resultado.parecer as { valorMercado?: number } | undefined
    if (gp && parecerAtual?.valorMercado) {
      // Reancora o intervalo de confiança no valor corrigido, preservando a largura
      // relativa (%) que a IA já tinha avaliado como plausível para a dispersão das
      // amostras — só o ponto central muda, não o quanto de incerteza foi estimado.
      const fatorInf = gp.estimativaPontual > 0 ? gp.limiteInferior / gp.estimativaPontual : 0.9
      const fatorSup = gp.estimativaPontual > 0 ? gp.limiteSuperior / gp.estimativaPontual : 1.1
      resultado.grauPrecisao = classificarGrauPrecisao(
        parecerAtual.valorMercado,
        parecerAtual.valorMercado * fatorInf,
        parecerAtual.valorMercado * fatorSup,
      )
    } else if (gp) {
      resultado.grauPrecisao = classificarGrauPrecisao(gp.estimativaPontual, gp.limiteInferior, gp.limiteSuperior)
    }

    const gf = resultado.grauFundamentacao as { itens: { item: string; grauAtingido: GrauNBR; descricao: string }[]; justificativa: string }
    if (gf?.itens) {
      const itemQtd = classificarItemQuantidade(amostras.length)
      const todosFatores = amostrasHomogeneizadas.flatMap((a) => a.fatoresAplicados.map((f) => f.valor))
      const itemIntervalo = classificarItemIntervaloFatores(todosFatores)

      const itensRecalculados = gf.itens.map((it) => {
        const label = it.item.toLowerCase()
        if (label.includes('dados efetivamente') || label.includes('quantidade')) {
          return { ...it, grauAtingido: itemQtd.grau, descricao: `${it.descricao}${itemQtd.nota}` }
        }
        if (label.includes('intervalo')) {
          return { ...it, grauAtingido: itemIntervalo.grau, descricao: `${it.descricao}${itemIntervalo.nota}` }
        }
        if (label.includes('identificação') && semFotos && GRAU_ORDEM[it.grauAtingido] > GRAU_ORDEM.II) {
          return { ...it, grauAtingido: 'II' as GrauNBR, descricao: `${it.descricao} (rebaixado: sem fotos anexadas pelo vistoriador)` }
        }
        return it
      })

      const grauFinal = GRAU_POR_ORDEM[Math.min(...itensRecalculados.map((it) => GRAU_ORDEM[it.grauAtingido])) - 1]
      const itemLimitante = itensRecalculados.reduce((min, it) => (GRAU_ORDEM[it.grauAtingido] < GRAU_ORDEM[min.grauAtingido] ? it : min))
      const justificativa = `Grau final ${grauFinal}, determinado pelo item mais restritivo: "${itemLimitante.item}" (Grau ${itemLimitante.grauAtingido}) — pela norma, o laudo vale pelo item mais fraco entre os quatro.`
      resultado.grauFundamentacao = { itens: itensRecalculados, grauFinal, justificativa }
    }
  } catch {
    // Se o recálculo falhar por algum formato inesperado da IA, seguimos com o valor original
    // da IA em vez de derrubar a análise inteira — a inconsistência é preferível ao erro total.
  }
}
