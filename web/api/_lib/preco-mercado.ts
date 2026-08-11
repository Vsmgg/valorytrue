interface PrecoRegiaoParams {
  bairro: string
  cidade: string
  uf: string
  tipoImovel: string
}

/**
 * Best-effort broad market-price reference search — different from
 * buscarComparaveisReais (which is scoped tight to the exact street/100m for the
 * NBR amostras themselves). This one asks Google Search grounding, via Gemini,
 * what real listings on Zap/Viva Real/QuintoAndar/OLX/Imovelweb are asking for
 * per m² in the whole bairro, as a sanity-check reference for the final value —
 * not something that becomes an "amostra" in the laudo. Free text, not parsed
 * into structured fields — the confirmation pass reads it directly as context.
 * Degrades to null on any failure (no API key, timeout, no grounding results).
 */
export async function buscarPrecoMedioRegiao(params: PrecoRegiaoParams): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const { bairro, cidade, uf, tipoImovel } = params
  if (!cidade || !uf) return null

  const prompt = `Busque na internet (Zap Imóveis, Viva Real, QuintoAndar, OLX Imóveis, Imovelweb) o preço médio de venda por m² de imóveis do tipo "${tipoImovel}" no bairro ${bairro || 'informado'}, ${cidade}/${uf}, hoje. Responda em 2-3 frases curtas e diretas: cite a faixa de R$/m² que você encontrou e de quais sites, sem introdução nem conclusão.`

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(3_500),
    })
    if (!res.ok) {
      console.error('[preco-mercado] non-OK response', res.status, await res.text().catch(() => ''))
      return null
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    console.error('[preco-mercado] result for', `${bairro}, ${cidade}/${uf}`, ':', text || '(vazio)')
    return text || null
  } catch (err) {
    console.error('[preco-mercado] error', String(err))
    return null
  }
}
