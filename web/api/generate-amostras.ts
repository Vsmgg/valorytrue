import { getUserFromRequest } from './_lib/auth.js'
import { nbrResponseSchema } from './_lib/nbr-schema.js'
import { sanitizarUrlsAmostras, type AmostraIA } from './_lib/nbr-recompute.js'
import type { ComparavelReal } from './_lib/real-comparaveis.js'

export const config = { runtime: 'edge' }

interface PropertyData {
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  uf: string
  tipoImovel: string
  areaConstruida: string
  dormitorios: string
  banheiros: string
  vagas: string
  padraoPercebido: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

const amostraSchema = (nbrResponseSchema.properties.amostras as { items: unknown }).items

/**
 * Passada dedicada SÓ para transformar um lote de comparáveis reais (já encontrados e
 * verificados por api/find-amostras.ts) em amostras homogeneizadas — separada da geração
 * principal do laudo (api/analyze.ts) porque gerar TODAS as até 15 amostras pedidas pelo
 * usuário, com os 4 fatores de homogeneização de cada uma, dentro da MESMA chamada que também
 * gera o resto do laudo inteiro (caracterização, IQG, documentosAnalisados etc.) estourava o
 * limite de 25s do Edge Function — confirmado via teste real que 6 amostras já chegavam a
 * 23,7s e 8 estourava. Rodando sozinha, esta passada só precisa gerar o array de amostras, o
 * que sobra bastante orçamento de tempo — e o front-end pode chamar este endpoint MAIS DE UMA
 * VEZ (uma por lote de comparáveis), cada chamada uma invocação nova do Edge Function com seu
 * próprio limite de 25s, até cobrir todos os comparáveis encontrados.
 */
export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user) {
    return json({ error: 'Faça login para usar este módulo.' }, 401)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY não configurada no servidor.' }, 500)
  }

  let propertyData: PropertyData
  let comparaveisReais: ComparavelReal[]
  try {
    const body = (await request.json()) as { propertyData?: PropertyData; comparaveisReais?: ComparavelReal[] }
    if (!body.propertyData || !Array.isArray(body.comparaveisReais)) {
      return json({ error: 'Dados do imóvel ou lista de comparáveis não informados.' }, 400)
    }
    propertyData = body.propertyData
    comparaveisReais = body.comparaveisReais
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  if (comparaveisReais.length === 0) {
    return json({ amostras: [] })
  }

  const hoje = new Date().toISOString().slice(0, 10)

  const SYSTEM_INSTRUCTION = `Você é o Motor Central de Inteligência Imobiliária. Sua ÚNICA tarefa nesta chamada é transformar cada item de uma lista de imóveis comparáveis REAIS (já encontrados e verificados por busca real na internet) numa amostra homogeneizada para um laudo NBR 14.653, comparando cada um ao imóvel avaliando abaixo. Você NÃO gera o restante do laudo aqui — só o array de amostras.

REGRAS:
- Gere EXATAMENTE uma amostra para CADA comparável da lista fornecida, na mesma ordem, sem pular nenhum e sem inventar nenhum a mais ou a menos.
- Para cada amostra, preencha: id (ex. "A01", sequencial), fonte (nome do site de onde veio, ex. "Zap Imóveis" — extraia do domínio da URL fornecida), data ("${hoje}", a data de hoje, já que é quando a busca foi feita), endereco/distanciaM/"valorAnunciado" EXATAMENTE como vieram na lista (o preço já é real do próprio anúncio — NUNCA estime ou altere), areaM2 igual ao fornecido quando disponível (senão estime com base na tipologia), tipologia/dormitorios/suites/banheiros/vagas/padrao/conservacao/idadeAnos estimados de forma plausível a partir do tipo de imóvel e da região, valorUnitario (valorAnunciado/areaM2 — cálculo direto, não estimativa), url EXATAMENTE como fornecida, e um array "fatoresAplicados" com EXATAMENTE estes 4 fatores (nunca mais): Localização, Padrão construtivo, Conservação, Oferta (transação x oferta). Cada fator tem: fator, valor (coeficiente numérico, tipicamente entre 0,80 e 1,25 — só saia desse intervalo com justificativa forte), origem, justificativa, campoAplicacao, abrangenciaRegional, abrangenciaTemporal. NÃO invente coeficientes aleatórios — cada um deve refletir uma diferença real e justificável entre a amostra e o avaliando. PROIBIDO deixar os 4 fatores em exatamente 1,00 para todas as amostras ao mesmo tempo — pelo menos um fator de cada amostra deve se afastar de 1,00 de forma pequena e justificada (ex.: 0,95, 1,08, 1,12).
- CAMPO "evidencia" (curto, cite a fonte e a proximidade — a amostra NÃO precisa estar na mesma rua do avaliando, o que importa é padrão construtivo comparável ou a homogeneização compensar a diferença) — a REDAÇÃO precisa refletir honestamente o nível de localização de cada comparável, indicado entre colchetes [PRECISÃO: ...] na lista abaixo: [PRECISÃO: exato] → distância é um cálculo real, escreva normalmente (ex. "Anúncio real do Zap Imóveis, a 180m do avaliando"). [PRECISÃO: condomínio] → a localização vem do nome do condomínio/empreendimento, não de uma rua específica (ex. "Anúncio real no Condomínio Village X, mesma região do avaliando"). [PRECISÃO: bairro] → o anúncio não informa rua nem condomínio, só o bairro — a "distanciaM" fornecida é uma ESTIMATIVA (distância até o centro do bairro, não até o imóvel exato); a evidência DEVE deixar isso claro (ex. "Anúncio real no mesmo bairro do avaliando — endereço exato não divulgado no anúncio, distância é aproximada"), nunca apresente esse número como uma medição precisa.
- NÃO preencha "valorUnitarioHomogeneizado" — preencha com 0 (é recalculado automaticamente pelo servidor a partir dos fatores que você informar).
- SEJA CONCISO em todo texto livre (evidencia, justificativa etc.): frases curtas e diretas, no máximo ~15 palavras cada.
- Responda SOMENTE com o JSON do schema solicitado.`

  const propertyText = `IMÓVEL AVALIANDO (para comparação/homogeneização):
- Endereço: ${propertyData.logradouro}, ${propertyData.numero}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}
- Tipo: ${propertyData.tipoImovel}
- Área construída/privativa: ${propertyData.areaConstruida} m²
- Dormitórios: ${propertyData.dormitorios}
- Banheiros: ${propertyData.banheiros}
- Vagas de garagem: ${propertyData.vagas}
- Padrão construtivo percebido: ${propertyData.padraoPercebido}

COMPARÁVEIS REAIS A TRANSFORMAR EM AMOSTRAS (${comparaveisReais.length} itens, já geocodificados e com link verificado — use o endereço, a URL, a distância e o PREÇO EXATAMENTE como fornecidos):
${comparaveisReais
  .map(
    (c, i) =>
      `${i + 1}. [PRECISÃO: ${c.precisaoEndereco}] ${c.endereco}${c.areaM2 ? ` (${c.areaM2} m²)` : ''}${c.distanciaM !== null ? `, a ${c.distanciaM}m do imóvel avaliado` : ''} — Preço real do anúncio: R$ ${c.valorAnunciado} — URL: ${c.url}`,
  )
  .join('\n')}

Gere o array "amostras" com uma entrada para cada um dos ${comparaveisReais.length} comparáveis acima.`

  const responseSchema = {
    type: 'OBJECT',
    properties: { amostras: { type: 'ARRAY', items: amostraSchema } },
    required: ['amostras'],
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: propertyText }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      // Budget generoso (invocação dedicada, sem competir por tempo com o resto do laudo) mas
      // com margem de 2s dentro do limite de 25s do Edge Function.
      signal: AbortSignal.timeout(23_000),
    })

    const data = (await geminiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return json({ error: data.error?.message || 'Falha ao consultar o Gemini.' }, 502)
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) {
      return json({ error: 'A IA não retornou amostras.' }, 502)
    }

    let resultado: { amostras?: AmostraIA[] }
    try {
      resultado = JSON.parse(text)
    } catch {
      return json({ error: 'A IA retornou um formato inesperado.' }, 502)
    }

    // Mesma regra de segurança do resto do sistema — nunca confia numa "url" só porque a IA a
    // devolveu; qualquer amostra cuja url não esteja entre os comparáveis reais deste lote é
    // removida (não é retrabalho: cada lote tem seu próprio conjunto de urls válidas).
    const comBody = resultado as unknown as Record<string, unknown>
    sanitizarUrlsAmostras(comBody, new Set(comparaveisReais.map((c) => c.url)))

    const amostrasFinal = (comBody.amostras as unknown[] | undefined) || []
    // Diagnóstico: a instrução pede "uma amostra pra CADA comparável, sem pular nenhum", mas
    // isso depende da IA seguir à risca — nada aqui FORÇA a contagem batendo (forçar exigiria
    // inventar uma amostra pra cobrir o buraco, o que violaria a regra de nunca inventar dado).
    // Sem este log, um comparável real que a IA simplesmente pulou (ou cuja url ela devolveu
    // errada, descartada por sanitizarUrlsAmostras) desaparece silenciosamente do total final,
    // sem nenhum rastro de que existia. Não bloqueia a resposta — só torna a perda visível.
    if (amostrasFinal.length !== comparaveisReais.length) {
      console.error(
        '[generate-amostras] IA devolveu',
        amostrasFinal.length,
        'amostra(s) de',
        comparaveisReais.length,
        'comparável(is) reais deste lote —',
        comparaveisReais.length - amostrasFinal.length,
        'perdido(s) (pulado pela IA ou url inválida)',
      )
    }

    return json({ amostras: amostrasFinal })
  } catch (err) {
    // Sem isso, uma falha real (timeout, erro de rede, resposta malformada) fica invisível nos
    // logs — indistinguível de qualquer outro motivo (mesma correção aplicada em todo o
    // pipeline depois de confirmado em produção que analyze-verify.ts sofria disso).
    console.error('[generate-amostras] erro ao conectar/processar resposta do Gemini:', String(err))
    return json({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
