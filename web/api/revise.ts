import { recalcularResultadoNBR, sanitizarUrlsAmostras, type AmostraIA } from './_lib/nbr-recompute.js'
import { nbrResponseSchema } from './_lib/nbr-schema.js'

export const config = { runtime: 'edge' }

interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

const amostraSchema = (nbrResponseSchema.properties.amostras as { items: unknown }).items

const SYSTEM_INSTRUCTION = `Você é o Motor Central de Inteligência Imobiliária, revisando um laudo de avaliação que você mesmo emitiu, seguindo a NBR 14.653 (ABNT).

Um analista humano está conversando com você sobre esta avaliação e pode questionar o valor, a liquidez, a fundamentação OU uma amostra específica (ex.: "a amostra A02 não faz sentido geograficamente", "essa amostra está muito distante", "acho esse comparável errado"). Sua tarefa é decidir se o questionamento traz um argumento técnico válido que justifica revisar o laudo.

Regras:
- AMOSTRAS SÃO SEMPRE REAIS — REGRA ABSOLUTA: você não tem acesso a busca própria nesta conversa, então NUNCA invente uma amostra nova nem substitua uma amostra por outra. Se o questionamento apontar um problema real numa amostra específica (localização incoerente, distância errada, tipologia incompatível), retorne o array "amostras" com TODAS as amostras que devem permanecer, exceto a questionada — ou seja, REMOVA a amostra problemática do array, nunca a substitua por uma inventada. Se nenhuma amostra foi questionada, NÃO inclua o campo "amostras" na resposta (deixe de fora do JSON).
- Se o argumento for tecnicamente válido (amostra ruim, característica subestimada, erro na fundamentação), gere um novo parecer coerente (valor, faixa, liquidez, fundamentação atualizada explicando a mudança) e defina "revisar" como true.
- Se o argumento não justificar mudança (pergunta genérica, sem novo dado técnico), mantenha os valores originais no campo "parecer" e defina "revisar" como false, explicando por que o parecer permanece o mesmo.
- Nunca invente uma revisão só porque foi perguntado — avalie o mérito técnico do questionamento.
- NÃO recalcule "valorUnitarioHomogeneizado" das amostras nem os campos de "tratamentoEstatistico", "grauFundamentacao" ou "grauPrecisao" — eles são sempre recalculados automaticamente pelo servidor a partir dos dados que você retornar.
- Responda SOMENTE com o JSON do schema solicitado.`

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY não configurada no servidor.' }, 500)
  }

  let resultado: Record<string, unknown>
  let history: ChatMessage[]
  try {
    const body = (await request.json()) as { resultado?: Record<string, unknown>; history?: ChatMessage[] }
    if (!body.resultado) {
      return json({ error: 'Avaliação não informada.' }, 400)
    }
    resultado = body.resultado
    history = Array.isArray(body.history) ? body.history.slice(-10) : []
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const conversationText = history.map((m) => `${m.role === 'user' ? 'Analista' : 'IA'}: ${m.text}`).join('\n')
  const prompt = `LAUDO ATUAL (JSON) — inclui as amostras usadas:\n${JSON.stringify(resultado)}\n\nCONVERSA COM O ANALISTA:\n${conversationText}\n\nCom base na conversa acima, decida se o parecer e/ou as amostras devem ser revisados.`

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      revisar: { type: 'BOOLEAN' },
      amostras: { type: 'ARRAY', items: amostraSchema },
      parecer: {
        type: 'OBJECT',
        properties: {
          valorMercado: { type: 'NUMBER' },
          faixaMin: { type: 'NUMBER' },
          faixaMax: { type: 'NUMBER' },
          liquidez: { type: 'STRING', enum: ['Muito Alta', 'Alta', 'Normal', 'Baixa', 'Muito Baixa'] },
          fundamentacao: { type: 'STRING' },
        },
        required: ['valorMercado', 'faixaMin', 'faixaMax', 'liquidez', 'fundamentacao'],
      },
      justificativa: { type: 'STRING' },
    },
    required: ['revisar', 'parecer', 'justificativa'],
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
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
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return json({ error: data.error?.message || 'Falha ao consultar o Gemini.' }, 502)
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) {
      return json({ error: 'A IA não retornou uma revisão.' }, 502)
    }

    let revision: { revisar?: boolean; amostras?: unknown[]; parecer?: unknown; justificativa?: string }
    try {
      revision = JSON.parse(text)
    } catch {
      return json({ error: 'A IA retornou um formato inesperado.' }, 502)
    }

    if (revision.revisar && Array.isArray(revision.amostras) && revision.amostras.length > 0) {
      const merged: Record<string, unknown> = { ...resultado, amostras: revision.amostras, parecer: revision.parecer ?? resultado.parecer }
      // Só uma "url" que já vinha no laudo antes desta revisão pode sobreviver — a IA não
      // fez busca real nesta passada, então uma amostra de substituição nunca tem "url" legítima.
      const urlsJaPresentes = new Set(
        ((resultado as { amostras?: AmostraIA[] })?.amostras || []).map((a) => a.url).filter((u): u is string => Boolean(u)),
      )
      sanitizarUrlsAmostras(merged, urlsJaPresentes)
      // Derivado deterministicamente da contagem real (nunca confiamos na IA pra decidir isso)
      // — mesmo piso de 6 amostras usado em nbr-recompute.ts (pedido explícito do usuário,
      // mais rígido que o piso técnico de 3 da norma).
      const amostrasFinais = (merged.amostras as unknown[]) || []
      merged.dadosInsuficientes = amostrasFinais.length < 10
      if (merged.dadosInsuficientes && !merged.dadosInsuficientesMotivo) {
        merged.dadosInsuficientesMotivo = `Após a revisão solicitada, restaram apenas ${amostrasFinais.length} amostra(s) real(is) — abaixo do mínimo de 10 amostras exigido.`
      }
      // semFotos=false aqui só evita que o recálculo REBAIXE o item "Identificação dos
      // dados" de novo — a classificação original desse item já foi feita na 1ª/2ª
      // passada e não muda só porque uma amostra foi trocada numa revisão de chat.
      recalcularResultadoNBR(merged, false)
      return json({
        revisar: true,
        parecer: merged.parecer,
        amostras: merged.amostras,
        tratamentoEstatistico: merged.tratamentoEstatistico,
        grauFundamentacao: merged.grauFundamentacao,
        grauPrecisao: merged.grauPrecisao,
        valorFinal: merged.valorFinal,
        dadosInsuficientes: merged.dadosInsuficientes,
        dadosInsuficientesMotivo: merged.dadosInsuficientesMotivo,
        justificativa: revision.justificativa,
      })
    }

    return json(revision as Record<string, unknown>)
  } catch {
    return json({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
