import { getUserFromRequest } from './_lib/auth.js'
import { recalcularResultadoNBR, sanitizarUrlsAmostras, type AmostraIA } from './_lib/nbr-recompute.js'
import { nbrResponseSchema } from './_lib/nbr-schema.js'

export const config = { runtime: 'edge' }

interface PropertyData {
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  tipoImovel: string
  areaConstruida: string
  areaTerreno: string
  dormitorios: string
  banheiros: string
  vagas: string
  padraoPercebido: string
  observacoes: string
  finalidade?: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

const SYSTEM_INSTRUCTION = `Você é um ENGENHEIRO AVALIADOR SÊNIOR e AUDITOR TÉCNICO, atuando como segunda instância de revisão de um laudo de avaliação imobiliária conforme a NBR 14.653 (ABNT), partes 1 e 2. Outro sistema de IA já gerou uma primeira versão da análise — sua tarefa é revisar essa versão com rigor de auditor externo e entregar a versão FINAL, corrigida.

O que você recebe: os dados originais informados pelo vistoriador e o JSON completo da primeira análise (rascunho).

O que você deve fazer:
1. Releia CADA campo do rascunho com espírito crítico, como se estivesse auditando o trabalho de outra pessoa.
2. Verifique consistência interna: o valor unitário multiplicado pela área bate com o valor total? A fundamentação do parecer é coerente com os graus atribuídos e com as amostras? Os fatores de homogeneização (tipicamente entre 0,80 e 1,25) são tecnicamente justificáveis? A descrição do imóvel bate com os dados informados pelo vistoriador?
3. AMOSTRAS SÃO SEMPRE REAIS — REGRA ABSOLUTA: toda amostra do rascunho deve ter uma "url" (veio de uma busca real, já geocodificada). Você NÃO tem acesso a uma busca própria nesta passada, então NUNCA invente uma amostra nova nem "substitua" uma amostra ruim por outra — se uma amostra tiver "distanciaM" acima de 1000m, dados claramente incoerentes com o restante, ou parecer inventada (sem "url"), REMOVA-A do array em vez de tentar consertá-la ou trocá-la. TODA outra amostra do rascunho — qualquer uma que não se encaixe nesses motivos explícitos de remoção — DEVE aparecer no seu array "amostras" de resposta; é PROIBIDO simplesmente deixar de fora uma amostra válida sem um motivo dos citados acima. Se depois de remover restarem menos de 10 amostras (ou ZERO), defina "dadosInsuficientes" como true e explique em "dadosInsuficientesMotivo" e em "parecer.fundamentacao"/"descricaoLaudo". IMPORTANTE: mesmo com poucas ou nenhuma amostra, "parecer.valorMercado" NUNCA pode ficar 0, vazio ou nulo — mantenha (ou estime, usando seu conhecimento do mercado imobiliário brasileiro real para essa cidade/bairro/tipo de imóvel) um valor aproximado plausível. Um valor aproximado claramente sinalizado como de baixa confiabilidade (via "dadosInsuficientes") é sempre melhor que um valor zerado, que é inútil para o cliente do banco. NUNCA altere "valorAnunciado", "valorUnitario", o endereço, a "url" ou a "distanciaM" de uma amostra — todos vieram de um anúncio real (o preço é o preço real do anúncio, não uma estimativa) e são imutáveis. Se um preço parecer um outlier real (muito diferente das outras amostras), você pode excluir essa amostra específica via "tratamentoEstatistico.amostrasExcluidas" com o motivo, mas nunca reescreva o número. Divergências só reportadas quando houver certeza técnica real (nunca invente uma divergência que não esteja claramente sustentada). Confira também: (a) o campo "data" de cada amostra está dentro dos últimos 60-90 dias contados a partir da "DATA DE HOJE" informada abaixo — se estiver desatualizada (ex.: de anos anteriores), corrija para uma data recente plausível; (b) as amostras NÃO podem ter os 4 fatores de homogeneização todos exatamente em 1,00 ao mesmo tempo — se estiverem, ajuste pelo menos um fator de cada amostra para um valor pequeno e justificado (ex. 0,95, 1,08) refletindo diferenças reais entre os imóveis.
4. CHECAGEM DE DOCUMENTOS: confira se "documentosAnalisados" tem EXATAMENTE uma entrada para cada rótulo listado em "ARQUIVOS ANEXADOS NESTA VISTORIA" abaixo — sem exceção. Se faltar algum, ADICIONE a entrada com um resumo tecnicamente plausível do que aquele arquivo mostraria. Se sobrar alguma entrada referente a um arquivo que não está na lista, remova-a.
5. LINGUAGEM: cada amostra é sempre uma OFERTA (anúncio ativo) — se "evidencia" descrever como venda/transação concluída, corrija. Nenhum campo de texto (evidencia, fundamentacao, descricaoLaudo) pode mencionar "vistoria presencial" ou "visita in loco" — a análise é sempre remota, a partir de fotos e documentos; corrija se encontrar essa linguagem. Prefira redação que deixe claro se um dado é confirmado (documento/anúncio real), declarado (vistoriador), observado (foto) ou estimado/inferido — nunca apresente uma estimativa como se fosse confirmada.
6. Corrija qualquer erro, inconsistência, valor implausível ou contradição que encontrar. Se um campo já estiver correto, mantenha-o. Não piore um campo que já estava certo.
7. Responda com o JSON COMPLETO e FINAL, no mesmo schema — não é um diff, é a versão definitiva pronta para ser entregue ao cliente do banco. O array "amostras" da sua resposta deve conter SOMENTE amostras que já vinham no rascunho (mesma "url") — nunca uma nova.
8. VELOCIDADE: quando um campo de texto (evidencia, justificativa de um fator, fundamentacao, descricaoLaudo etc.) já estiver correto, REPRODUZA-O EXATAMENTE como veio no rascunho, palavra por palavra — NUNCA reescreva ou reformule um texto só por estilo quando o conteúdo já está certo. Quando precisar corrigir um texto, a correção deve ser CURTA e direta (no máximo ~20 palavras), nunca uma reescrita longa. Isto é obrigatório para o processamento caber no tempo disponível.

Esta é a 2ª de 3 verificações antes da entrega — depois de você, uma terceira passada vai confirmar o valor contra pesquisa real de mercado. Ainda assim, entregue a versão mais correta que conseguir, como se fosse a final. Responda SOMENTE com o JSON do schema, sem nenhum texto fora dele.`

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user) {
    return json({ error: 'Faça login para usar este módulo.' }, 401)
  }
  if (!user.isAdmin && user.evaluationsUsed >= user.evaluationsLimit) {
    return json({ error: 'Você atingiu o limite de 5 avaliações gratuitas.' }, 403)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY não configurada no servidor.' }, 500)
  }

  let propertyData: PropertyData
  let rascunho: unknown
  let temFotos: boolean
  let documentLabels: string[]
  try {
    const body = (await request.json()) as {
      propertyData?: PropertyData
      resultado?: unknown
      temFotos?: boolean
      documentLabels?: string[]
    }
    if (!body.propertyData || !body.resultado) {
      return json({ error: 'Dados insuficientes para a verificação.' }, 400)
    }
    propertyData = body.propertyData
    rascunho = body.resultado
    temFotos = Boolean(body.temFotos)
    documentLabels = Array.isArray(body.documentLabels) ? body.documentLabels : []
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const enderecoCompleto = propertyData.complemento
    ? `${propertyData.logradouro}, ${propertyData.numero} - ${propertyData.complemento}`
    : `${propertyData.logradouro}, ${propertyData.numero}`

  const hoje = new Date().toISOString().slice(0, 10)

  const reviewText = `DATA DE HOJE: ${hoje}

DADOS ORIGINAIS DO IMÓVEL:
- Endereço: ${enderecoCompleto}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}
- Tipo: ${propertyData.tipoImovel}
- Área construída: ${propertyData.areaConstruida} m²
- Finalidade: ${propertyData.finalidade || 'Valor de mercado'}

ARQUIVOS ANEXADOS NESTA VISTORIA (documentosAnalisados deve ter uma entrada para CADA um, sem exceção): ${documentLabels.length > 0 ? documentLabels.join(', ') : 'nenhum'}

RASCUNHO DA PRIMEIRA ANÁLISE (JSON) — revise e corrija:
${JSON.stringify(rascunho)}

Audite este rascunho e responda com o JSON final corrigido.`

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: reviewText }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
          // BUG real encontrado e corrigido: esta era a ÚNICA das 4 chamadas ao Gemini do
          // pipeline com thinkingBudget > 0 — as outras 3 (analyze.ts, analyze-confirm.ts,
          // generate-amostras.ts) já usam 0 com sucesso. Confirmado via log real de produção:
          // com o volume maior de amostras que a busca por bairro passou a entregar, essa
          // chamada estourava os 25s do Edge Function e a Vercel matava a função com um erro
          // genérico ("Falha na segunda verificação técnica") — thinking extra some no
          // silêncio nesse tempo, sem visibilidade nenhuma do porquê.
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema: nbrResponseSchema,
        },
      }),
      // Mesma rede de segurança das outras 3 chamadas — sem isso, estourar o tempo aqui é a
      // Vercel matando a função com um erro genérico e não-recuperável, em vez de eu conseguir
      // devolver um JSON de erro tratável que o front-end já sabe mostrar ("Tentar novamente").
      signal: AbortSignal.timeout(23_000),
    })

    const data = (await geminiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return json({ error: data.error?.message || 'Falha ao consultar o Gemini na verificação.' }, 502)
    }
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      return json({ error: 'A verificação ficou grande demais para o modelo. Tente novamente.' }, 502)
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) {
      return json({ error: 'A IA não retornou a verificação. Tente novamente.' }, 502)
    }

    let resultado: Record<string, unknown>
    try {
      resultado = JSON.parse(text)
    } catch {
      return json({ error: 'A verificação retornou um formato inesperado. Tente novamente.' }, 502)
    }

    // Só uma "url" que já vinha no rascunho da 1ª passada (já validada lá) pode sobreviver —
    // a IA não tem como ter descoberto uma URL nova e legítima nesta passada de auditoria.
    const amostrasEntrada = (rascunho as { amostras?: AmostraIA[] })?.amostras || []
    const urlsJaPresentes = new Set(amostrasEntrada.map((a) => a.url).filter((u): u is string => Boolean(u)))
    const antesQtd = ((resultado.amostras as unknown[]) || []).length
    sanitizarUrlsAmostras(resultado, urlsJaPresentes)
    const depoisQtd = ((resultado.amostras as unknown[]) || []).length
    if (depoisQtd !== antesQtd) {
      console.error('[analyze-verify] IA devolveu', antesQtd, 'amostras, sanitização manteve', depoisQtd, '(descartadas por url inválida/inventada)')
    }
    // BUG real encontrado e corrigido: o log acima só pega amostra descartada por url
    // inválida — não pega a IA simplesmente OMITIR, no JSON que ela reescreveu do zero, uma
    // amostra real e válida que veio da 1ª passada (analyze.ts). Sem este log, essa perda é
    // invisível — some do total final sem nenhum rastro do motivo. Não bloqueia a resposta
    // (reinjetar sem a IA ter reescrito o resto do laudo ao redor dela arrisca inconsistência)
    // — só torna o descarte visível pra diagnóstico.
    if (depoisQtd < amostrasEntrada.length) {
      console.error(
        '[analyze-verify] laudo entrou com',
        amostrasEntrada.length,
        'amostra(s) e saiu com',
        depoisQtd,
        '—',
        amostrasEntrada.length - depoisQtd,
        'perdida(s) nesta passada (url inválida OU omitida pela IA sem motivo declarado)',
      )
    }

    recalcularResultadoNBR(resultado, !temFotos)

    return json({ resultado })
  } catch (err) {
    // BUG real encontrado e corrigido: este catch nunca logava o erro real antes de devolver a
    // mensagem genérica — confirmado via teste real: um caso apareceu na tela do usuário como
    // "Não foi possível conectar à API do Gemini na verificação", mas o log de produção não
    // tinha NENHUM rastro do motivo real (timeout? erro de rede? resposta malformada?), porque
    // esta linha nunca imprimia nada. Sem isso, um erro real e recorrente fica invisível pra
    // sempre, indistinguível de um problema de rede pontual.
    console.error('[analyze-verify] erro ao conectar/processar resposta do Gemini:', String(err))
    return json({ error: 'Não foi possível conectar à API do Gemini na verificação.' }, 502)
  }
}
