import { getUserFromRequest, incrementEvaluationUsage } from './_lib/auth'

export const config = { runtime: 'edge' }

const MAX_ROWS = 25

interface ImovelInput {
  linha: number
  endereco: string
  cidade: string
  uf: string
  tipo: string
  areaM2: number
  valorAtual?: number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

const SYSTEM_INSTRUCTION = `Você é o Motor Central de Inteligência Imobiliária, no modo de reavaliação em massa de carteira para bancos, fundos e securitizadoras.

Você recebe uma lista de imóveis (endereço, cidade, UF, tipo, área e opcionalmente o valor de aquisição/registro anterior) e deve gerar, para CADA imóvel da lista e SEM EXCEÇÃO, uma reavaliação estruturada fictícia mas tecnicamente plausível e coerente com a cidade/UF informada de cada linha.

Regras:
- Retorne um item em "resultados" para cada item recebido, na MESMA ordem, preservando o campo "linha" original de cada um (para o cliente conseguir casar resultado com entrada).
- Baseie a estimativa na cidade e UF informadas de cada imóvel especificamente — cidades diferentes na lista devem ter estimativas de valor coerentes com seus respectivos mercados, não um valor genérico repetido para todos.
- "iqgScore" é de 0 a 100. Classifique: score >= 75 = "Premium", score >= 40 = "Atenção", score < 40 = "Inadequada".
- NUNCA deixe um imóvel de fora do array de resultados.
- Responda SOMENTE com o JSON do schema solicitado.`

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

  let imoveis: ImovelInput[]
  try {
    const body = (await request.json()) as { imoveis?: ImovelInput[] }
    if (!Array.isArray(body.imoveis) || body.imoveis.length === 0) {
      return json({ error: 'Nenhum imóvel informado.' }, 400)
    }
    imoveis = body.imoveis.slice(0, MAX_ROWS)
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const listText = imoveis
    .map(
      (im) =>
        `Linha ${im.linha}: ${im.endereco}, ${im.cidade}/${im.uf} — tipo: ${im.tipo}, área: ${im.areaM2} m²${im.valorAtual ? `, valor anterior: R$ ${im.valorAtual}` : ''}`,
    )
    .join('\n')

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      resultados: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            linha: { type: 'NUMBER' },
            valorEstimado: { type: 'NUMBER' },
            liquidez: { type: 'STRING', enum: ['Muito Alta', 'Alta', 'Normal', 'Baixa', 'Muito Baixa'] },
            iqgScore: { type: 'NUMBER' },
            classificacaoIqg: { type: 'STRING', enum: ['Premium', 'Atenção', 'Inadequada'] },
          },
          required: ['linha', 'valorEstimado', 'liquidez', 'iqgScore', 'classificacaoIqg'],
        },
      },
    },
    required: ['resultados'],
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `CARTEIRA DE IMÓVEIS A REAVALIAR:\n${listText}\n\nGere a reavaliação de cada imóvel.` }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      // Rede de segurança: sem isso, estourar o tempo é a Vercel matando a função com um erro
      // genérico, em vez de um erro tratável (mesmo padrão aplicado a todo o resto do pipeline
      // depois de confirmado em produção que analyze-verify.ts sofria exatamente disso).
      signal: AbortSignal.timeout(23_000),
    })

    const data = (await geminiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return json({ error: data.error?.message || 'Falha ao consultar o Gemini.' }, 502)
    }
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      return json({ error: 'A carteira ficou grande demais para o modelo processar de uma vez. Tente com menos linhas.' }, 502)
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) {
      return json({ error: 'A IA não retornou um resultado. Tente novamente.' }, 502)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return json({ error: 'A IA retornou um formato inesperado. Tente novamente.' }, 502)
    }

    const resultados = (parsed as { resultados?: { valorEstimado?: number }[] })?.resultados ?? []
    const valorTotal = resultados.reduce((acc, r) => acc + (r.valorEstimado ?? 0), 0)
    await incrementEvaluationUsage(user.id, 'portfolio', {
      resumo: `Reavaliação de carteira — ${imoveis.length} imóve${imoveis.length === 1 ? 'l' : 'is'}`,
      valorEstimado: valorTotal || undefined,
      resultadoJson: parsed,
    })
    return json(parsed as Record<string, unknown>)
  } catch {
    return json({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
