import { buscarComparaveisReais, type ComparavelReal } from './_lib/real-comparaveis'
import { getUserFromRequest, incrementEvaluationUsage } from './_lib/auth'

export const config = { runtime: 'edge' }

interface FileRef {
  label: string
  url: string
}

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
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  })
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

function guessMimeType(url: string): string {
  const lower = url.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'image/jpeg'
}

const SYSTEM_INSTRUCTION = `Você é o Motor Central de Inteligência Imobiliária, no modo AVM (Automated Valuation Model) para pessoa física — uma estimativa rápida e informal de valor de mercado, mais simples que um laudo técnico completo de avaliador (não segue o rito completo da NBR 14.653, é uma estimativa automatizada).

Você recebe dados básicos informados pelo próprio proprietário/comprador sobre um imóvel e, opcionalmente, algumas fotos e documentos (matrícula, IPTU). Gere uma AVALIAÇÃO FICTÍCIA mas tecnicamente plausível e coerente, preenchendo TODOS os campos do schema.

Regras:
- ANTES DE RESPONDER, revise internamente TODOS os campos que você vai gerar e confirme que são coerentes entre si (ex.: o valor de mercado bate com a faixa e com os comparáveis; a fundamentação não contradiz o valor final; a orientação de crédito não contradiz a liquidez estimada). A resposta final deve estar tecnicamente correta e consistente em 100% dos campos — nunca gere um valor em um campo que contradiga outro campo do mesmo resultado.
- NUNCA deixe campos vazios ou genéricos — invente valores fictícios plausíveis e coerentes com os dados informados quando uma informação não estiver disponível (isto é uma demonstração).
- O município e UF são informados explicitamente nos campos "Cidade" e "UF" (obtidos via CEP, confiáveis) — baseie a estimativa de valor nessa região, nunca infira a cidade a partir do texto do logradouro.
- Cada arquivo anexado (foto ou documento) vem precedido de um texto "Arquivo anexado: <rótulo>" — analise CADA UM individualmente e sem exceção, nunca ignore ou resuma superficialmente.
- COMPARÁVEIS SÃO SEMPRE REAIS — REGRA ABSOLUTA: você NUNCA inventa um imóvel, endereço, preço ou URL para servir de comparável. A única fonte válida é a lista "COMPARÁVEIS REAIS ENCONTRADOS NA INTERNET" fornecida abaixo (busca real já feita pelo servidor, geocodificada e com link verificado). Cada item de "comparaveis" deve corresponder 1:1 a um item dessa lista, usando o endereço, a URL, a distância e o "valor" (preço real do anúncio) EXATAMENTE como fornecidos — NUNCA estime ou altere o preço, ele já é real. Se a lista trouxer 10 ou mais, use até 15 (mais próximos primeiro). Se trouxer MENOS de 10 (abaixo do mínimo exigido para uma estimativa confiável), gere comparáveis só para os que houver (pode ser de 0 a 9 — NUNCA complete inventando) e defina "dadosInsuficientes" como true, explicando em "dadosInsuficientesMotivo" e em "fundamentacao" que a estimativa tem baixa confiabilidade por falta de comparáveis reais próximos. Se a lista vier vazia, "comparaveis" é [] e "dadosInsuficientes" é true.
- IMPORTANTE — quando houver ao menos 1 comparável, "valorMercado" é SEMPRE recalculado pelo servidor como a média do R$/m² dos comparáveis reais usados × a área do imóvel informado (o que você preencher em "valorMercado" é só um placeholder, será substituído). Por isso, cada comparável precisa ter um "valor"/"areaM2" que reflita o preço de mercado REAL de m² para aquela cidade/bairro específicos (use seu conhecimento do mercado imobiliário brasileiro real) — um preço de comparável irreal joga a estimativa inteira para um valor errado.
- "fundamentacao" é um parágrafo técnico claro (em português, sem jargão excessivo) explicando COMO o valor foi calculado: cite o método (comparativo direto de dados de mercado), como os comparáveis listados foram usados/ponderados, e quais fatores do imóvel (área, padrão, localização, estado) mais pesaram para o valor final. Nunca diga apenas "com base no mercado" sem explicar o raciocínio.
- Só gere uma entrada em "divergencias" quando um documento (matrícula/IPTU) tiver sido de fato anexado E afirmar EXPLICITAMENTE e com clareza um valor de área diferente do informado pelo proprietário, com diferença REAL de mais de 5%. NUNCA invente, estime ou "leia nas entrelinhas" um valor que não esteja escrito com clareza no documento. Diferenças pequenas (≤5%, típicas de arredondamento) NÃO são divergências. Na dúvida, NÃO reporte — o padrão é array vazio; só gere divergência quando houver certeza técnica real.
- "orientacaoCredito.ltvMaximoRecomendado" é um percentual (0-100) plausível para o tipo de imóvel e sua liquidez estimada (imóveis residenciais de alta liquidez costumam admitir LTV mais alto).
- "orientacaoCredito.texto" é um parágrafo curto e direto, em português, explicando de forma acessível para uma pessoa física o que essa estimativa de valor e liquidez significam na prática para conseguir financiamento.
- Responda SOMENTE com o JSON do schema solicitado.`

export default async function handler(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  }
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
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN

  let propertyData: PropertyData
  let photos: FileRef[]
  let documents: FileRef[]
  let comparaveisReaisPrebuscados: ComparavelReal[] | null
  try {
    const body = (await request.json()) as {
      propertyData?: PropertyData
      photos?: FileRef[]
      documents?: FileRef[]
      comparaveisReais?: ComparavelReal[]
    }
    if (!body.propertyData) {
      return json({ error: 'Dados do imóvel não informados.' }, 400)
    }
    propertyData = body.propertyData
    photos = Array.isArray(body.photos) ? body.photos.slice(0, 5) : []
    documents = Array.isArray(body.documents) ? body.documents.slice(0, 4) : []
    // Vem pronta de api/find-amostras.ts (passada dedicada, com muito mais tempo pra buscar do
    // que esta função teria sozinha) — quando presente, nunca buscamos de novo aqui.
    comparaveisReaisPrebuscados = Array.isArray(body.comparaveisReais) ? body.comparaveisReais : null
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  // Same raw-byte budget rationale as api/analyze.ts: Gemini caps the whole
  // request at ~20MB after base64 encoding (~4/3 inflation over raw bytes).
  const MAX_TOTAL_RAW_BYTES = 14 * 1024 * 1024
  const allFiles = [...photos, ...documents]

  // NUNCA inclui "complemento" (apto/torre/bloco) — quebra a geocodificação (Nominatim não
  // resolve número de apartamento), mesmo quando rua+número sozinhos resolveriam.
  const enderecoParaGeocodificacao = `${propertyData.logradouro}, ${propertyData.numero}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}`

  const [fetched, comparaveisReais] = await Promise.all([
    Promise.all(
      allFiles.map(async (file) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(file.url, { headers: blobToken ? { authorization: `Bearer ${blobToken}` } : {} })
            if (res.ok) return { file, buf: await res.arrayBuffer() }
          } catch {
            // retry once before giving up on this file
          }
        }
        return { file, buf: null as ArrayBuffer | null }
      }),
    ),
    comparaveisReaisPrebuscados !== null
      ? Promise.resolve(comparaveisReaisPrebuscados)
      : buscarComparaveisReais({
          enderecoCompleto: enderecoParaGeocodificacao,
          cidade: propertyData.cidade,
          uf: propertyData.uf,
          bairro: propertyData.bairro,
          tipoImovel: propertyData.tipoImovel,
          numeroAvaliando: propertyData.numero,
        }).then((r) => r.comparaveis),
  ])

  const fileParts: Record<string, unknown>[] = []
  const unreadable: string[] = []
  let usedBytes = 0
  for (const { file, buf } of fetched) {
    if (!buf) {
      unreadable.push(file.label)
      continue
    }
    if (usedBytes + buf.byteLength > MAX_TOTAL_RAW_BYTES) {
      unreadable.push(file.label)
      continue
    }
    usedBytes += buf.byteLength
    fileParts.push({ text: `Arquivo anexado: ${file.label}` })
    fileParts.push({ inlineData: { mimeType: guessMimeType(file.url), data: arrayBufferToBase64(buf) } })
  }

  const propertyText = `DADOS INFORMADOS PELO PROPRIETÁRIO/COMPRADOR:
- Endereço: ${propertyData.logradouro}, ${propertyData.numero}${propertyData.complemento ? ` - ${propertyData.complemento}` : ''}, ${propertyData.bairro}
- CEP: ${propertyData.cep}
- Cidade: ${propertyData.cidade}
- UF: ${propertyData.uf}
- Tipo de imóvel: ${propertyData.tipoImovel}
- Área construída: ${propertyData.areaConstruida} m²
- Área do terreno: ${propertyData.areaTerreno || 'não informado'} m²
- Dormitórios: ${propertyData.dormitorios}
- Banheiros: ${propertyData.banheiros}
- Vagas de garagem: ${propertyData.vagas}
- Padrão percebido: ${propertyData.padraoPercebido}
- Observações: ${propertyData.observacoes || 'nenhuma'}
- Quantidade de fotos anexadas: ${photos.length}
- Quantidade de documentos anexados: ${documents.length}
- Arquivos efetivamente incluídos nesta análise (analise TODOS, sem exceção): ${allFiles.length - unreadable.length} de ${allFiles.length}
${unreadable.length > 0 ? `- Arquivos que NÃO puderam ser processados (não finja tê-los analisado): ${unreadable.join(', ')}` : ''}
${
  comparaveisReais.length > 0
    ? `\nCOMPARÁVEIS REAIS ENCONTRADOS NA INTERNET (${comparaveisReais.length} encontrados, já geocodificados e com link verificado — esta é a ÚNICA fonte válida de comparáveis, NUNCA invente outros; use o endereço, a URL, a distância e o PREÇO EXATAMENTE como fornecidos):\n${comparaveisReais
        .map(
          (c) =>
            `- [PRECISÃO: ${c.precisaoEndereco}] ${c.endereco}${c.areaM2 ? ` (${c.areaM2} m²)` : ''}${c.distanciaM !== null ? `, a ${c.distanciaM}m do imóvel avaliado${c.precisaoEndereco === 'exato' ? ' (distância real calculada)' : ' (distância ESTIMADA — sem rua/condomínio exato no anúncio, use até o centro do bairro; declare isso na evidência)'}` : ''} — Preço real do anúncio: R$ ${c.valorAnunciado} — URL: ${c.url}`,
        )
        .join('\n')}`
    : '\nCOMPARÁVEIS REAIS ENCONTRADOS NA INTERNET: nenhum encontrado dentro do raio de busca configurado. NÃO invente comparáveis — "comparaveis" deve ser [] e "dadosInsuficientes" deve ser true.'
}

Gere a estimativa de valor (AVM) deste imóvel.`

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      valorMercado: { type: 'NUMBER' },
      faixaMin: { type: 'NUMBER' },
      faixaMax: { type: 'NUMBER' },
      liquidez: { type: 'STRING', enum: ['Muito Alta', 'Alta', 'Normal', 'Baixa', 'Muito Baixa'] },
      comparaveis: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            endereco: { type: 'STRING' },
            distanciaM: { type: 'NUMBER' },
            areaM2: { type: 'NUMBER' },
            valor: { type: 'NUMBER' },
            url: { type: 'STRING' },
          },
          required: ['endereco', 'distanciaM', 'areaM2', 'valor'],
        },
      },
      fundamentacao: { type: 'STRING' },
      dadosInsuficientes: { type: 'BOOLEAN' },
      dadosInsuficientesMotivo: { type: 'STRING' },
      divergencias: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            campo: { type: 'STRING' },
            valorInformado: { type: 'STRING' },
            valorDocumento: { type: 'STRING' },
            percentual: { type: 'NUMBER' },
            mensagem: { type: 'STRING' },
          },
          required: ['campo', 'valorInformado', 'valorDocumento', 'percentual', 'mensagem'],
        },
      },
      financiabilidade: {
        type: 'OBJECT',
        properties: {
          status: { type: 'STRING', enum: ['Financiável', 'Financiável com restrições', 'Não financiável'] },
          motivos: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['status', 'motivos'],
      },
      fatoresConsiderados: { type: 'ARRAY', items: { type: 'STRING' } },
      orientacaoCredito: {
        type: 'OBJECT',
        properties: {
          ltvMaximoRecomendado: { type: 'NUMBER' },
          texto: { type: 'STRING' },
        },
        required: ['ltvMaximoRecomendado', 'texto'],
      },
    },
    required: [
      'valorMercado',
      'faixaMin',
      'faixaMax',
      'liquidez',
      'comparaveis',
      'fundamentacao',
      'dadosInsuficientes',
      'divergencias',
      'financiabilidade',
      'fatoresConsiderados',
      'orientacaoCredito',
    ],
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: propertyText }, ...fileParts] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 6144,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      // Rede de segurança: sem isso, estourar o tempo aqui é a Vercel matando a função com um
      // erro genérico e não-recuperável (confirmado em produção acontecendo em analyze-verify.ts,
      // o equivalente deste módulo no Empresa Avaliadora), em vez de eu devolver um erro tratável.
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
      return json({ error: 'A análise ficou grande demais para o modelo. Tente com menos anexos.' }, 502)
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) {
      return json({ error: 'A IA não retornou uma estimativa. Tente novamente.' }, 502)
    }

    let resultado: Record<string, unknown>
    try {
      resultado = JSON.parse(text)
    } catch {
      return json({ error: 'A IA retornou um formato inesperado. Tente novamente.' }, 502)
    }

    // A IA às vezes inventa um comparável inteiro (endereço, "url" em domínio inventado)
    // mesmo sendo instruída a nunca fazer isso — nunca confiamos na "url" só porque a IA a
    // preencheu; qualquer comparável cuja url não esteja na lista que nós mesmos buscamos e
    // validamos (ver api/_lib/real-comparaveis.ts) é removido do array inteiro.
    try {
      const urlsPermitidas = new Set(comparaveisReais.map((c) => c.url))
      const brutos = (resultado.comparaveis as { url?: string }[]) || []
      resultado.comparaveis = brutos.filter((c) => c.url && urlsPermitidas.has(c.url))
      resultado.dadosInsuficientes = (resultado.comparaveis as unknown[]).length < 10
    } catch {
      // Mantém o que a IA respondeu se o formato vier inesperado.
    }

    // Ancora o valor de mercado na média real dos comparáveis (R$/m² × área do imóvel),
    // em vez de aceitar um "valorMercado" que a IA declarou à parte e que podia ficar
    // desconectado do que os próprios comparáveis diziam — mesmo problema e mesma
    // correção aplicada no Empresa Avaliadora (ver api/_lib/nbr-recompute.ts).
    try {
      const comparaveis = (resultado.comparaveis as { areaM2?: number; valor?: number }[]) || []
      const areaAvalianda = Number(propertyData.areaConstruida) || 0
      const unitarios = comparaveis
        .filter((c) => (c.areaM2 ?? 0) > 0 && (c.valor ?? 0) > 0)
        .map((c) => (c.valor as number) / (c.areaM2 as number))
      if (areaAvalianda > 0 && unitarios.length > 0) {
        const mediaUnitario = unitarios.reduce((a, b) => a + b, 0) / unitarios.length
        const minUnitario = Math.min(...unitarios)
        const maxUnitario = Math.max(...unitarios)
        resultado.valorMercado = Math.round(mediaUnitario * areaAvalianda * 100) / 100
        resultado.faixaMin = Math.round(minUnitario * areaAvalianda * 100) / 100
        resultado.faixaMax = Math.round(maxUnitario * areaAvalianda * 100) / 100
      }
    } catch {
      // Sem comparáveis utilizáveis — segue com o valor que a IA propôs.
    }

    const r = resultado as { valorMercado?: number }
    await incrementEvaluationUsage(user.id, 'avm', {
      resumo: `${propertyData.tipoImovel} — ${propertyData.logradouro}, ${propertyData.numero}, ${propertyData.bairro}`,
      valorEstimado: r?.valorMercado,
      resultadoJson: resultado,
    })
    return json({ resultado })
  } catch (err) {
    // Sem isso, uma falha real (timeout, erro de rede, resposta malformada) fica invisível nos
    // logs — indistinguível de qualquer outro motivo (mesma correção aplicada em todo o
    // pipeline depois de confirmado em produção que analyze-verify.ts sofria disso).
    console.error('[avm] erro ao conectar/processar resposta do Gemini:', String(err))
    return json({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
