import { getUserFromRequest, incrementEvaluationUsage } from './_lib/auth.js'
import { recalcularResultadoNBR, sanitizarUrlsAmostras, type AmostraIA } from './_lib/nbr-recompute.js'
import { nbrResponseSchema } from './_lib/nbr-schema.js'
import { buscarPrecoMedioRegiao } from './_lib/preco-mercado.js'

// Revertido — ver o motivo completo no config de analyze-verify.ts: trocar pra função Node.js
// normal quebrou getUserFromRequest inteiro ("request.headers.get is not a function").
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

/** Extrai valores em R$ do texto livre da pesquisa de preço médio da região (ver
 * _lib/preco-mercado.ts) e retorna a média dos que caem numa faixa plausível de R$/m²
 * — usado só como rede de segurança final (ver abaixo), quando nem a IA nem as amostras
 * produziram um "valorMercado" utilizável. */
function extrairPrecoMedioM2(texto: string | null): number | null {
  if (!texto) return null
  const valores = [...texto.matchAll(/R\$\s*([\d.,]+)/g)]
    .map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v >= 300 && v <= 100_000)
  if (valores.length === 0) return null
  return valores.reduce((a, b) => a + b, 0) / valores.length
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

const SYSTEM_INSTRUCTION = `Você é o AVALIADOR RESPONSÁVEL, fazendo a 3ª e ÚLTIMA verificação de um laudo de avaliação imobiliária (NBR 14.653), antes de assinar e entregar ao banco. Duas outras passadas de IA já geraram e auditaram este laudo — sua tarefa agora é a CONFIRMAÇÃO FINAL contra dados reais de mercado e a checagem de completude.

O que você recebe: os dados do imóvel, o laudo já auditado (JSON), e uma PESQUISA REAL de mercado (texto livre, vinda de busca no Google/portais imobiliários) com o preço médio de m² que sites como Zap Imóveis, Viva Real, QuintoAndar, OLX e Imovelweb estão praticando na região.

O que você deve fazer:
1. COMPARE o "valorUnitario" do laudo (campo valorFinal.valorUnitario) com a faixa de R$/m² da pesquisa real de mercado fornecida. Esta checagem serve só para o cenário em que há poucas ou nenhuma amostra real e o "valorMercado" ficou baseado numa estimativa geral (não em amostras): nesse caso, se a diferença entre o "valorMercado" do laudo e o centro da faixa real pesquisada for MAIOR que ~10-15%, ajuste "parecer.valorMercado"/"valorFinal" (não as amostras — você não gera esse campo nesta passada, ver item 2) para ficar dentro da faixa real pesquisada. Se já existem 3+ amostras reais com preço real, a média delas já É a evidência de mercado mais confiável que existe — não a substitua pela pesquisa geral da região, que é só um resumo aproximado. Se a pesquisa não trouxe dado útil (busca sem resultado), mantenha o valor do laudo.
2. AMOSTRAS — VOCÊ NÃO REESCREVE O ARRAY, SÓ SINALIZA REMOÇÕES: o campo "amostras" NÃO faz parte da sua resposta (foi tirado do schema de propósito — o servidor já mantém as amostras do laudo recebido automaticamente, palavra por palavra, sem você precisar reproduzi-las; "valorAnunciado", "valorUnitario", endereço, "url" e "distanciaM" continuam garantidamente imutáveis por construção). Sua única ação sobre amostras é preencher "amostrasParaRemover" com a URL e o motivo de qualquer amostra que deva ser removida — SÓ quando parecer inventada (sem "url") ou tiver dados claramente incoerentes com o restante; esta é a ÚLTIMA passada antes da entrega, então seja conservador. NUNCA remova uma amostra só por causa de "distanciaM" — o raio de busca já varia por tipo de imóvel (1000m pra tipos densos, até 2000m pra casas/sobrados/terrenos) e cada amostra já passou por esse filtro correto antes de chegar até você; remover por um número fixo de distância aqui já derrubou amostras reais e válidas de tipos de baixa densidade em produção. Se nenhuma amostra precisar ser removida, "amostrasParaRemover" deve ser um array vazio []. Se restarem menos de 10 amostras (ou ZERO) após a remoção — calcule isso você mesmo a partir da contagem do laudo recebido menos as que está removendo —, defina "dadosInsuficientes" como true e explique em "dadosInsuficientesMotivo". IMPORTANTE: mesmo com poucas ou nenhuma amostra, "parecer.valorMercado" NUNCA pode ser 0, vazio ou nulo — use a PESQUISA REAL DE MERCADO fornecida abaixo (meio da faixa de R$/m² encontrada × área do imóvel) como base do valor; se a pesquisa também não trouxe nada útil, use seu próprio conhecimento do mercado imobiliário brasileiro real para essa cidade/bairro/tipo de imóvel. Um valor aproximado e claramente sinalizado como de baixa confiabilidade (via "dadosInsuficientes") é sempre melhor que um valor zerado, que é inútil para o cliente do banco.
3. CHECAGEM DE COMPLETUDE: releia o JSON inteiro (exceto amostras, que você não gera) e confirme que NENHUM campo está vazio, genérico demais, com placeholder, ou "0" onde deveria ter um valor real. Todo texto livre que você gera (fundamentacao, descricaoLaudo, justificativas) precisa ter conteúdo específico e substancial, não uma frase vaga. Se encontrar algo faltando ou genérico, complete com um valor tecnicamente plausível.
4. CHECAGEM DE DOCUMENTOS: confira se "documentosAnalisados" tem EXATAMENTE uma entrada para cada rótulo listado em "ARQUIVOS ANEXADOS NESTA VISTORIA" abaixo — sem exceção, isto é obrigatório e não pode faltar nenhum. Se faltar algum, ADICIONE a entrada com um resumo tecnicamente plausível do que aquele arquivo mostraria.
5. Confirme mais uma vez a consistência interna (valor unitário × área = total; campo "data" de cada amostra dentro dos últimos 60-90 dias a partir da "DATA DE HOJE" informada abaixo — se estiver desatualizada em alguma, remova essa amostra via "amostrasParaRemover" em vez de tentar corrigi-la, já que você não reescreve o campo).
6. LINGUAGEM FINAL: nos campos de texto que você gera (fundamentacao, descricaoLaudo), garanta que nenhuma amostra é descrita como venda/transação concluída (é sempre uma OFERTA) e que nenhum texto mencione "vistoria presencial" ou "visita in loco" — esta plataforma sempre analisa remotamente, a partir de fotos e documentos enviados.
7. Corrija o que precisar nos campos que você gera. Se já estiver tudo certo, mantenha.
8. Responda com o JSON do schema (sem o campo "amostras", que não existe mais no schema desta passada) — esta versão vai direto para o cliente do banco, sem mais revisões depois dela.
9. VELOCIDADE: quando um campo de texto já estiver correto, REPRODUZA-O EXATAMENTE como veio no laudo recebido, palavra por palavra — NUNCA reescreva ou reformule um texto só por estilo quando o conteúdo já está certo. Quando precisar corrigir um texto, a correção deve ser CURTA e direta (no máximo ~20 palavras), nunca uma reescrita longa. Isto é obrigatório para o processamento caber no tempo disponível.

Responda SOMENTE com o JSON do schema, sem nenhum texto fora dele.`

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
      return json({ error: 'Dados insuficientes para a confirmação final.' }, 400)
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

  const precoRegiao = await buscarPrecoMedioRegiao({
    bairro: propertyData.bairro,
    cidade: propertyData.cidade,
    uf: propertyData.uf,
    tipoImovel: propertyData.tipoImovel,
  })

  const hoje = new Date().toISOString().slice(0, 10)

  const confirmText = `DATA DE HOJE: ${hoje}

DADOS DO IMÓVEL:
- Endereço: ${enderecoCompleto}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}
- Tipo: ${propertyData.tipoImovel}
- Área construída: ${propertyData.areaConstruida} m²
- Finalidade: ${propertyData.finalidade || 'Valor de mercado'}

PESQUISA REAL DE MERCADO (Google Search, sites imobiliários):
${precoRegiao || 'Nenhum dado real de mercado encontrado nesta busca — mantenha o valor do laudo como está.'}

ARQUIVOS ANEXADOS NESTA VISTORIA (documentosAnalisados deve ter uma entrada para CADA um, sem exceção): ${documentLabels.length > 0 ? documentLabels.join(', ') : 'nenhum'}

LAUDO JÁ AUDITADO (JSON) — confirme ou ajuste:
${JSON.stringify(rascunho)}

Faça a confirmação final e responda com o JSON completo.`

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // Mesma técnica de analyze-verify.ts (ver comentário lá pro histórico completo): tira
  // "amostras" do schema de saída — a IA nunca reescreve o array, só sinaliza remoções via
  // "amostrasParaRemover" — e o servidor reconstrói a partir do laudo recebido. Confirmado via
  // teste real de ponta a ponta que isso é o que fazia esta chamada estourar 23s sempre, mesmo
  // com só 10 amostras.
  const responseSchema = {
    ...nbrResponseSchema,
    properties: {
      ...Object.fromEntries(Object.entries(nbrResponseSchema.properties).filter(([k]) => k !== 'amostras')),
      amostrasParaRemover: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { url: { type: 'STRING' }, motivo: { type: 'STRING' } },
          required: ['url', 'motivo'],
        },
      },
    },
    required: [...nbrResponseSchema.required.filter((k) => k !== 'amostras'), 'amostrasParaRemover'],
  }

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: confirmText }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      signal: AbortSignal.timeout(23_000),
    })

    const data = (await geminiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return json({ error: data.error?.message || 'Falha ao consultar o Gemini na confirmação final.' }, 502)
    }
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      return json({ error: 'A confirmação final ficou grande demais para o modelo. Tente novamente.' }, 502)
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) {
      return json({ error: 'A IA não retornou a confirmação final. Tente novamente.' }, 502)
    }

    let resultado: Record<string, unknown>
    try {
      resultado = JSON.parse(text)
    } catch {
      return json({ error: 'A confirmação final retornou um formato inesperado. Tente novamente.' }, 502)
    }

    // A IA não gera mais "amostras" nesta passada (ver responseSchema acima) — reconstruído
    // aqui a partir do PRÓPRIO laudo recebido (já confirmado real nas passadas anteriores)
    // menos as urls sinalizadas em "amostrasParaRemover". Ver mesmo mecanismo em
    // analyze-verify.ts pro histórico completo do porquê.
    const amostrasEntrada = (rascunho as { amostras?: AmostraIA[] })?.amostras || []
    const amostrasParaRemover = (resultado.amostrasParaRemover as { url?: string; motivo?: string }[] | undefined) || []
    const urlsRemover = new Set(amostrasParaRemover.map((r) => r.url).filter((u): u is string => Boolean(u)))
    resultado.amostras = amostrasEntrada.filter((a) => !(a.url && urlsRemover.has(a.url)))
    if (urlsRemover.size > 0) {
      console.error(
        '[analyze-confirm]',
        urlsRemover.size,
        'amostra(s) removida(s):',
        amostrasParaRemover.map((r) => `${r.url} (${r.motivo})`).join('; '),
      )
    }
    delete resultado.amostrasParaRemover
    const urlsJaPresentes = new Set(amostrasEntrada.map((a) => a.url).filter((u): u is string => Boolean(u)))
    sanitizarUrlsAmostras(resultado, urlsJaPresentes)

    // BUG real encontrado e corrigido: esta etapa fazia uma re-checagem de "link ainda no ar"
    // aqui, removendo qualquer amostra que a checagem automática considerasse morta. Testado
    // manualmente fora do Edge Function: vários anúncios rejeitados por essa checagem (em
    // vários testes reais, sobretudo VivaReal e Attria) na verdade voltam com um bloqueio
    // antibot (Cloudflare) quando checados a partir do ambiente da Vercel, disfarçado de
    // erro/404 — não são anúncios removidos de verdade. Como a checagem automatizada é
    // estruturalmente pouco confiável pra esses portais (não é um problema de timeout ou
    // configuração, é bloqueio de infraestrutura), ela derrubava amostras reais em massa sem
    // ganho de segurança correspondente. Removida — as URLs já vêm de uma busca ao vivo feita
    // minutos antes (Brave/Gemini), o que já é um sinal razoável de que o anúncio existe agora.
    recalcularResultadoNBR(resultado, !temFotos)

    // Rede de segurança final: mesmo instruída a nunca zerar o valor, a IA às vezes deixa
    // "valorMercado" em 0 quando "amostras" fica vazio (confirmado via teste real) — um
    // laudo com valor R$0 é inútil pro cliente do banco, então em último caso calculamos
    // uma estimativa aproximada a partir da pesquisa real de mercado desta mesma passada.
    const parecerAtual = resultado.parecer as { valorMercado?: number } | undefined
    if (!parecerAtual?.valorMercado) {
      const areaAvalianda = Number(propertyData.areaConstruida) || 0
      const precoM2Estimado = extrairPrecoMedioM2(precoRegiao)
      if (areaAvalianda > 0 && precoM2Estimado) {
        const valorUnitario = Math.round(precoM2Estimado * 100) / 100
        const valorTotal = Math.round(valorUnitario * areaAvalianda * 100) / 100
        const faixaMin = Math.round(valorTotal * 0.85 * 100) / 100
        const faixaMax = Math.round(valorTotal * 1.15 * 100) / 100
        resultado.parecer = { ...parecerAtual, valorMercado: valorTotal, faixaMin, faixaMax }
        const vfAtual = resultado.valorFinal as Record<string, unknown> | undefined
        resultado.valorFinal = {
          ...vfAtual,
          valorUnitario,
          areaAvalianda,
          valorTotal,
          intervaloMin: faixaMin,
          intervaloMax: faixaMax,
          valorAdotado: valorTotal,
        }
      }
    }

    const parecer = resultado.parecer as { valorMercado?: number } | undefined
    await incrementEvaluationUsage(user.id, 'empresa_avaliadora', {
      resumo: `${propertyData.tipoImovel} — ${enderecoCompleto}, ${propertyData.bairro}`,
      valorEstimado: parecer?.valorMercado,
      resultadoJson: resultado,
    })

    return json({ resultado })
  } catch (err) {
    // Sem isso, uma falha real (timeout, erro de rede, resposta malformada) fica invisível nos
    // logs — indistinguível de qualquer outro motivo (mesma correção aplicada em todo o
    // pipeline depois de confirmado em produção que analyze-verify.ts sofria disso).
    console.error('[analyze-confirm] erro ao conectar/processar resposta do Gemini:', String(err))
    return json({ error: 'Não foi possível conectar à API do Gemini na confirmação final.' }, 502)
  }
}
