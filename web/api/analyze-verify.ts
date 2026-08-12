import { getUserFromRequest } from './_lib/auth.js'
import { recalcularResultadoNBR, sanitizarUrlsAmostras, type AmostraIA } from './_lib/nbr-recompute.js'
import { nbrResponseSchema } from './_lib/nbr-schema.js'

// BUG real encontrado e corrigido — tentativa de trocar pra função Node.js normal (sem
// "runtime: edge") pra ganhar mais tempo (25s -> 60s) quebrou TUDO: confirmado via teste real
// que o formato de "request" que a Vercel passa pra uma função Node.js legada NÃO é um Request
// padrão da Web (não tem "request.headers.get", usado em toda getUserFromRequest) — toda
// chamada autenticada crashava na hora com "TypeError: request.headers.get is not a function".
// Revertido pra Edge Function (que usa Request/Response padrão da Web, compatível com o resto
// do código) — o problema do tempo precisa de outra solução, não de trocar o runtime.
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
3. AMOSTRAS — VOCÊ NÃO REESCREVE O ARRAY, SÓ SINALIZA REMOÇÕES: o campo "amostras" NÃO faz parte da sua resposta (foi tirado do schema de propósito — o servidor já mantém as amostras do rascunho automaticamente, palavra por palavra, sem você precisar reproduzi-las). Sua única ação sobre amostras é preencher "amostrasParaRemover" com a URL e o motivo de qualquer amostra que deva ser removida — SÓ quando tiver "distanciaM" acima de 1000m, dados claramente incoerentes com o restante, ou parecer inventada (sem "url"). Se nenhuma amostra precisar ser removida, "amostrasParaRemover" deve ser um array vazio []. Você NÃO tem acesso a uma busca própria nesta passada, então NUNCA sinalize uma amostra real como se fosse pra "substituir" — remoção é definitiva, não uma troca. Se depois de remover restarem menos de 10 amostras (ou ZERO) — calcule isso você mesmo a partir da contagem de amostras do rascunho menos as que você está removendo —, defina "dadosInsuficientes" como true e explique em "dadosInsuficientesMotivo" e em "parecer.fundamentacao"/"descricaoLaudo". IMPORTANTE: mesmo com poucas ou nenhuma amostra, "parecer.valorMercado" NUNCA pode ficar 0, vazio ou nulo — mantenha (ou estime, usando seu conhecimento do mercado imobiliário brasileiro real para essa cidade/bairro/tipo de imóvel) um valor aproximado plausível. Divergências só reportadas quando houver certeza técnica real (nunca invente uma divergência que não esteja claramente sustentada).
4. CHECAGEM DE DOCUMENTOS: confira se "documentosAnalisados" tem EXATAMENTE uma entrada para cada rótulo listado em "ARQUIVOS ANEXADOS NESTA VISTORIA" abaixo — sem exceção. Se faltar algum, ADICIONE a entrada com um resumo tecnicamente plausível do que aquele arquivo mostraria. Se sobrar alguma entrada referente a um arquivo que não está na lista, remova-a.
5. LINGUAGEM: nos campos de texto que você de fato reescreve nesta passada (fundamentacao, descricaoLaudo — NÃO evidencia de amostra, que você não gera mais), garanta que nenhuma amostra é descrita como venda/transação concluída (é sempre uma OFERTA) e que nenhum texto mencione "vistoria presencial" ou "visita in loco" — a análise é sempre remota, a partir de fotos e documentos.
6. Corrija qualquer erro, inconsistência, valor implausível ou contradição que encontrar nos campos que você gera. Se um campo já estiver correto, mantenha-o. Não piore um campo que já estava certo.
7. Responda com o JSON do schema (sem o campo "amostras", que não existe mais no schema desta passada) — é a versão definitiva desses campos, pronta para ser entregue ao cliente do banco.
8. VELOCIDADE: quando um campo de texto já estiver correto, REPRODUZA-O EXATAMENTE como veio no rascunho, palavra por palavra — NUNCA reescreva ou reformule um texto só por estilo quando o conteúdo já está certo. Quando precisar corrigir um texto, a correção deve ser CURTA e direta (no máximo ~20 palavras), nunca uma reescrita longa. Isto é obrigatório para o processamento caber no tempo disponível.

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

  // BUG real encontrado e corrigido — causa raiz de verdade do TimeoutError (confirmado via
  // teste real de ponta a ponta repetido: falhava SEMPRE, no limite exato de 23s, mesmo com só
  // 10 amostras — reduzir dados não resolvia, porque o custo real está em GERAR de novo ~10
  // objetos de amostra completos, cada um com 4 fatores + evidência + justificativas, como
  // OUTPUT. Tentar trocar o runtime pra ganhar mais tempo (ver histórico no config acima)
  // quebrou a autenticação inteira — a solução certa é reduzir o que precisa ser GERADO, não
  // aumentar o tempo disponível. Mesma técnica já usada em analyze.ts quando "amostrasProntas"
  // é fornecido: tira "amostras" do schema de saída. Aqui vai mais longe — a IA não gera a
  // "amostras" nunca nesta passada, só sinaliza remoções via "amostrasParaRemover" (url +
  // motivo, um objeto pequeno) — o servidor reconstrói o array a partir do próprio rascunho,
  // que já está confirmado real. Corta a maior parte do output desta chamada.
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
        contents: [{ role: 'user', parts: [{ text: reviewText }] }],
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

    // A IA não gera mais "amostras" nesta passada (ver responseSchema acima) — o array final
    // é reconstruído aqui, no servidor, a partir do PRÓPRIO rascunho (já confirmado real na
    // 1ª passada) menos as urls que a IA sinalizou pra remover. Isso garante, por construção,
    // que toda amostra sobrevivente é IDÊNTICA à do rascunho (impossível a IA alterar um
    // campo por engano, já que ela nunca reescreve o objeto) — mais rígido que a sanitização
    // por url que existia antes, e sem custo de geração nenhum.
    const amostrasEntrada = (rascunho as { amostras?: AmostraIA[] })?.amostras || []
    const amostrasParaRemover = (resultado.amostrasParaRemover as { url?: string; motivo?: string }[] | undefined) || []
    const urlsRemover = new Set(amostrasParaRemover.map((r) => r.url).filter((u): u is string => Boolean(u)))
    resultado.amostras = amostrasEntrada.filter((a) => !(a.url && urlsRemover.has(a.url)))
    if (urlsRemover.size > 0) {
      console.error(
        '[analyze-verify]',
        urlsRemover.size,
        'amostra(s) removida(s):',
        amostrasParaRemover.map((r) => `${r.url} (${r.motivo})`).join('; '),
      )
    }
    delete resultado.amostrasParaRemover
    // Rede de segurança defensiva (deveria ser sempre um no-op, já que "amostras" agora só vem
    // do próprio rascunho) — mantida caso um refactor futuro reintroduza um caminho onde a IA
    // volte a influenciar esse array.
    const urlsJaPresentes = new Set(amostrasEntrada.map((a) => a.url).filter((u): u is string => Boolean(u)))
    sanitizarUrlsAmostras(resultado, urlsJaPresentes)

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
