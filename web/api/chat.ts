export const config = { runtime: 'edge' }

interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

interface ImageAttachment {
  url: string
  mimeType: string
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const BASE_INSTRUCTION = `Você é o Motor Central de Inteligência Imobiliária — o engenheiro avaliador sênior responsável por uma avaliação específica que já foi processada pela plataforma, seguindo a NBR 14.653 (ABNT).

Você está respondendo perguntas de um analista humano que está revisando essa avaliação antes de aprová-la. Quando o contexto da avaliação (JSON) for fornecido, baseie suas respostas EXCLUSIVAMENTE nele — explique escolhas (por que um comparável foi usado, por que a liquidez foi classificada assim, por que o IQG deu esse score), sem inventar dados que contradigam o que já está no JSON.

Se o analista anexar uma foto, analise-a de verdade (padrão construtivo, conservação, patologias aparentes — apenas o que for visível).

Responda sempre em português do Brasil, em texto simples (nunca markdown, nunca asteriscos), de forma direta e técnica, em poucos parágrafos ou uma lista curta com travessões (-).`

function corsJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return corsJson({ error: 'Método não permitido.' }, 405)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return corsJson({ error: 'GEMINI_API_KEY não configurada no servidor.' }, 500)
  }

  let history: ChatMessage[]
  let image: ImageAttachment | undefined
  let context: unknown
  try {
    const body = (await request.json()) as {
      history?: ChatMessage[]
      image?: ImageAttachment
      context?: unknown
    }
    history = Array.isArray(body.history) ? body.history : []
    if (body.image && typeof body.image.url === 'string' && typeof body.image.mimeType === 'string') {
      image = body.image
    }
    context = body.context
  } catch {
    return corsJson({ error: 'Corpo da requisição inválido.' }, 400)
  }

  if (history.length === 0) {
    return corsJson({ error: 'Nenhuma mensagem recebida.' }, 400)
  }

  let inlineImage: { mimeType: string; data: string } | null = null
  if (image) {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN
    try {
      const fileRes = await fetch(image.url, {
        headers: blobToken ? { authorization: `Bearer ${blobToken}` } : {},
      })
      if (!fileRes.ok) {
        return corsJson({ error: 'Não foi possível ler o arquivo enviado.' }, 502)
      }
      const buf = await fileRes.arrayBuffer()
      if (buf.byteLength > 20_000_000) {
        return corsJson({ error: 'Arquivo muito grande para a IA processar (máximo 20 MB).' }, 413)
      }
      inlineImage = { mimeType: image.mimeType, data: arrayBufferToBase64(buf) }
    } catch {
      return corsJson({ error: 'Não foi possível ler o arquivo enviado.' }, 502)
    }
  }

  const trimmed = history.slice(-12)
  const lastIndex = trimmed.length - 1
  const contents = trimmed.map((m, idx) => {
    const parts: Record<string, unknown>[] = [{ text: String(m.text).slice(0, 8000) }]
    if (idx === lastIndex && m.role === 'user' && inlineImage) {
      parts.push({ inlineData: inlineImage })
    }
    return {
      role: m.role === 'model' ? 'model' : 'user',
      parts,
    }
  })

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const systemInstruction = context
    ? `${BASE_INSTRUCTION}\n\nCONTEXTO DA AVALIAÇÃO EM ANÁLISE (JSON):\n${JSON.stringify(context).slice(0, 6000)}`
    : BASE_INSTRUCTION

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
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
      return corsJson({ error: data.error?.message || 'Falha ao consultar o Gemini.' }, 502)
    }

    let reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!reply) {
      return corsJson({ error: 'A IA não retornou uma resposta. Tente reformular a pergunta.' }, 502)
    }

    reply = reply.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/#{1,6}\s*/g, '')

    return corsJson({ reply })
  } catch (err) {
    console.error('[chat] erro ao conectar/processar resposta do Gemini:', String(err))
    return corsJson({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
