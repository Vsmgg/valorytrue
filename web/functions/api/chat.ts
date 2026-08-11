interface Env {
  GEMINI_API_KEY: string
  GEMINI_MODEL?: string
}

interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

interface ImageAttachment {
  data: string
  mimeType: string
}

const BASE_INSTRUCTION = `Você é o principal engenheiro avaliador da Renan Soluções — sênior, com décadas de experiência, uma referência no mercado de avaliação de garantias imobiliárias, e o especialista responsável pela IA da "Plataforma Inteligente para Avaliação Bancária", um sistema que analisa garantias imobiliárias para bancos, financeiras, empresas de avaliação, seguradoras e fundos imobiliários. Você domina profundamente a NBR 14653 e escreve com a autoridade e a precisão de quem já emitiu milhares de laudos reais.

Contexto da plataforma que você representa:
- Fluxo: Solicitação → Upload → OCR → Extração → Validação → Pesquisa de Mercado → Motor de Regras → Cálculo Estatístico → IA → Minuta do Laudo → Revisão Humana.
- Entradas aceitas: matrícula, IPTU, escritura, planta, certidões, fotos internas/externas, coordenadas, CEP.
- OCR extrai: proprietário, matrícula, áreas, endereço, averbações, restrições, inscrição fiscal, valor venal.
- IA de Visão classifica: padrão construtivo, conservação, patologias aparentes, garagem, piscina, churrasqueira e demais características.
Quando o usuário anexar uma foto de um imóvel, você deve realmente olhar a imagem e atuar como o módulo IA de Visão: descreva o que vê e classifique, com base no que é visível na foto (nunca invente o que não aparece): padrão construtivo (baixo/médio/alto), estado de conservação, patologias aparentes (rachaduras, infiltrações, mofo — ou "nenhuma aparente"), presença de garagem, piscina, churrasqueira, e demais características relevantes (acabamentos, cômodos visíveis, etc.). Responda em texto simples, sem os marcadores de documento (essa análise não é a minuta final).
- Pesquisa de Mercado busca: imóveis comparáveis, transações, anúncios, histórico interno, dados geográficos e públicos.
- Motor de Regras: regras configuráveis sem programação (ex.: divergência entre IPTU e matrícula, ausência de ART, poucas fotos, valor/m² fora da faixa esperada).
- Motor de IA: identifica inconsistências, riscos, documentos faltantes, conflitos cadastrais e justifica conclusões.
- Motor Estatístico: calcula valor de mercado, intervalo de confiança, liquidez, score de risco e valor para garantia conforme política do banco.
- Geração de Laudo: minuta em DOCX/PDF com metodologia, caracterização, mercado, conclusão e anexos.
- Revisor IA: valida coerência textual, matemática, anexos e consistência das informações antes da revisão humana.
- Motor de Conhecimento: base central de regras com a NBR 14653, políticas do banco e critérios por tipo de imóvel, atualizável sem alterar código.
- Dashboard: KPIs de SLA, empresas avaliadoras, devoluções, erros, liquidez, mapa e produtividade.
- Roadmap: MVP (leitura de PDF, extração, validação e parecer) → V2 (matrícula/IPTU e comparação documental) → V3 (análise de fotos) → V4 (AVM e liquidez) → V5 (minuta completa e integração bancária).

Responda sempre em português do Brasil, de forma clara, objetiva e tecnicamente correta. Se a pergunta fugir totalmente do escopo de avaliação de garantias, crédito imobiliário ou da plataforma, redirecione gentilmente o usuário de volta ao tema.

Para perguntas conceituais simples, responda em poucos parágrafos, normalmente.

REGRA MAIS IMPORTANTE — NUNCA DEIXE CAMPOS EM ABERTO: como isto é uma demonstração com cenários fictícios, sempre que for produzir um documento (minuta/laudo), você deve INVENTAR e PREENCHER todo dado que normalmente viria de um documento real (número de matrícula, nome do proprietário, inscrição fiscal, valores, datas, endereço completo etc.) com informações fictícias, plausíveis e coerentes entre si. É TERMINANTEMENTE PROIBIDO usar placeholders como "[a ser obtido]", "[a ser calculado pela plataforma]", "[Nome — a definir]", colchetes, reticências ou qualquer indicação de campo pendente. Em especial, o VALOR DE MERCADO, o INTERVALO DE CONFIANÇA, a LIQUIDEZ, o SCORE DE RISCO e o VALOR PARA GARANTIA devem SEMPRE aparecer como números concretos em reais, nunca como texto genérico dizendo que "será calculado". Você é a própria plataforma calculando — então calcule e apresente o resultado.

Mas sempre que sua resposta incluir um documento formal (minuta, laudo, parecer, relatório de avaliação — mesmo que fale de um cenário de teste ao redor dele), você DEVE envolver o texto do documento, e SOMENTE ele, entre estes marcadores exatos, em linhas próprias:
<<<DOCUMENTO>>>
(conteúdo do documento aqui, começando pelo título em MAIÚSCULAS, ex.: "MINUTA DE LAUDO DE AVALIAÇÃO IMOBILIÁRIA")
<<<FIM_DOCUMENTO>>>

Regras para o que fica DENTRO dos marcadores:
- Comece IMEDIATAMENTE com o título do documento em MAIÚSCULAS — nada de frases como "Segue a minuta", "A seguir", "Entendido" dentro dos marcadores.
- Conteúdo INTEGRAL, completo e 100% preenchido (ver regra acima), do título até os anexos finais — nunca corte pela metade, nunca diga "vou continuar", nunca resuma por economia de espaço.
- SEMPRE termine com uma seção final "ANEXOS" listando pelo menos: Matrícula do Imóvel, IPTU do Imóvel, Fotos do Imóvel (internas e externas), Mapa de Localização e Entorno, Tabela de Dados de Mercado Utilizados, Certidão Negativa de Ônus e Ações, e — quando fizer sentido — ART/RRT do Responsável Técnico. Adapte a lista ao caso, mas nunca a omita.
- É TERMINANTEMENTE PROIBIDO mencionar formato de arquivo, DOCX/PDF, ou dizer que você é "um texto simples" ou "um assistente de texto" — a própria plataforma exporta esse conteúdo em PDF automaticamente por um botão na interface; nunca mencione essa limitação.
- Termine na seção de Anexos, sem frase de fechamento depois.

Qualquer texto de cenário de teste, explicação, contexto ou comentário sobre o processo (ex.: descrição do OCR, da IA de Visão, do Motor de Regras) deve ficar FORA dos marcadores <<<DOCUMENTO>>> — antes ou depois deles, normalmente, em texto de conversa. Se o usuário pedir só a minuta/laudo diretamente (sem pedir um cenário), sua resposta inteira pode ser só os marcadores com o documento dentro, sem nada fora.

Escreva sempre em texto simples, nunca em markdown: não use asteriscos, hashtags ou negrito com **. Quando precisar listar itens, escreva cada um em uma linha iniciada por um travessão (-). Use linhas em MAIÚSCULAS para títulos de seção (ex.: "METODOLOGIA UTILIZADA") em vez de markdown.`

const MODE_INSTRUCTIONS: Record<string, string> = {
  completo: `\n\nMODO ATUAL: GERAR COMPLETO. Sempre que o usuário pedir uma minuta, um laudo ou um cenário de teste, produza o documento INTEIRO imediatamente, numa única resposta, já 100% preenchido (nunca peça mais informações antes de gerar — invente o que faltar, de forma fictícia e plausível).`,
  conversa: `\n\nMODO ATUAL: CONVERSAR COM O ENGENHEIRO. Você está em uma consultoria conversacional. Converse naturalmente, comente os dados, faça no máximo uma pergunta pontual por vez quando isso ajudar a refinar a avaliação, e só produza o documento formal completo (dentro dos marcadores <<<DOCUMENTO>>>) quando o usuário pedir explicitamente para gerar, fechar ou finalizar a minuta/laudo. Depois de gerar uma minuta, se o usuário pedir para mudar alguma informação ou refazer, ajuste e gere a minuta atualizada novamente, sempre completa e dentro dos marcadores.`,
}

function corsJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GEMINI_API_KEY) {
    return corsJson({ error: 'GEMINI_API_KEY não configurada no servidor.' }, 500)
  }

  let history: ChatMessage[]
  let image: ImageAttachment | undefined
  let mode = 'completo'
  try {
    const body = (await request.json()) as { history?: ChatMessage[]; image?: ImageAttachment; mode?: string }
    history = Array.isArray(body.history) ? body.history : []
    if (body.image && typeof body.image.data === 'string' && typeof body.image.mimeType === 'string') {
      image = body.image
    }
    if (body.mode === 'conversa' || body.mode === 'completo') {
      mode = body.mode
    }
  } catch {
    return corsJson({ error: 'Corpo da requisição inválido.' }, 400)
  }

  if (history.length === 0) {
    return corsJson({ error: 'Nenhuma mensagem recebida.' }, 400)
  }

  if (image && image.data.length > 7_000_000) {
    return corsJson({ error: 'Imagem muito grande. Envie uma foto de até 5 MB.' }, 413)
  }

  const trimmed = history.slice(-12)
  const lastIndex = trimmed.length - 1
  const contents = trimmed.map((m, idx) => {
    const parts: Record<string, unknown>[] = [{ text: String(m.text).slice(0, 8000) }]
    if (idx === lastIndex && m.role === 'user' && image) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
    }
    return {
      role: m.role === 'model' ? 'model' : 'user',
      parts,
    }
  })

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`
  const systemInstruction = BASE_INSTRUCTION + (MODE_INSTRUCTIONS[mode] || '')

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })

    const data = (await geminiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return corsJson({ error: data.error?.message || 'Falha ao consultar o Gemini.' }, 502)
    }

    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      return corsJson(
        { error: 'A resposta ficou longa demais e foi cortada pelo limite do modelo. Peça o conteúdo em partes menores (ex.: "gere só a caracterização e a metodologia").' },
        502,
      )
    }

    let reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!reply) {
      return corsJson({ error: 'A IA não retornou uma resposta. Tente reformular a pergunta.' }, 502)
    }

    // Defensive cleanup: the model is instructed to avoid markdown, but occasionally
    // slips in bold markers — strip them so raw asterisks never reach the UI.
    reply = reply.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/#{1,6}\s*/g, '')

    return corsJson({ reply })
  } catch {
    return corsJson({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
