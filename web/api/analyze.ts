import { buscarComparaveisReais, type ComparavelReal } from './_lib/real-comparaveis.js'
import { getUserFromRequest } from './_lib/auth.js'
import { recalcularResultadoNBR, sanitizarUrlsAmostras, type AmostraIA } from './_lib/nbr-recompute.js'
import { nbrResponseSchema } from './_lib/nbr-schema.js'

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
  finalidade?: string
  topografia?: string
  testada?: string
  posicao?: string
  infraestruturaUrbana?: string
  zoneamentoInformado?: string
  ocupacaoUso?: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
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

// A seção 3 (AMOSTRAS) muda dependendo de quem gera o array "amostras" nesta chamada — ver
// buildSystemInstruction abaixo. Quando o front-end já chamou api/generate-amostras.ts numa
// passada dedicada (caminho normal, ver fase2-processando.tsx), as amostras já vêm prontas e
// esta chamada só precisa usá-las como contexto pro resto do laudo, nunca gerá-las de novo —
// gerar as até 15 amostras (com os 4 fatores de homogeneização cada) na MESMA chamada que
// também gera o laudo inteiro (caracterização, IQG, documentosAnalisados etc.) estourava o
// limite de 25s do Edge Function (confirmado via teste real: 6 amostras já chegavam a 23,7s, 8
// estourava) — por isso a separação em duas passadas. O caminho antigo (gerar amostras aqui
// mesmo) continua existindo só como fallback pra um chamador que não mande "amostrasProntas",
// e nesse caminho o limite de 5 amostras (ver `.slice(0, 5)` abaixo) segue necessário.
const SECAO_AMOSTRAS_GERAR = `3. AMOSTRAS (SOMENTE REAIS — leia a lista "COMPARÁVEIS REAIS ENCONTRADOS NA INTERNET" abaixo com atenção):
- Se a lista trouxer 10 ou mais comparáveis, gere uma amostra para cada um (até 5, mais próximos primeiro — o restante é coberto pela passada dedicada quando disponível). Defina "dadosInsuficientes" como false.
- Se a lista trouxer MENOS de 10 comparáveis (abaixo do mínimo exigido), gere amostras apenas para os que houver (pode ser de 0 a 9 — NUNCA complete com amostras inventadas) e defina "dadosInsuficientes" como true. Em "dadosInsuficientesMotivo", explique objetivamente: quantos comparáveis reais foram encontrados dentro do raio de busca configurado (NÃO afirme um valor específico de metros — o raio varia por tipo de imóvel) e por que isso é insuficiente para uma precificação confiável pelo método comparativo direto. Reflita essa limitação também em "parecer.fundamentacao" e em "descricaoLaudo", sendo honesto sobre a baixa confiabilidade do valor estimado nesse cenário.
- Se a lista vier vazia, "amostras" é um array vazio [], "dadosInsuficientes" é true, e "parecer.valorMercado"/"faixaMin"/"faixaMax" devem refletir apenas a pesquisa de preço médio da região se houver alguma referência disponível no seu conhecimento — deixando claro no texto que não é uma precificação validada por comparação direta.
- Para cada amostra REAL usada, preencha: id (ex. "A01"), fonte (nome do site de onde veio, ex. "Zap Imóveis" — extraia do domínio da URL fornecida), data (a "DATA DE HOJE" informada acima, já que é quando a busca foi feita), endereco, distanciaM e "valorAnunciado" EXATAMENTE como vieram na lista (o preço já é o preço real do próprio anúncio — NUNCA estime ou altere esse número, só use o que foi fornecido), areaM2 igual ao fornecido quando disponível (senão estime com base na tipologia), tipologia/dormitorios/suites/banheiros/vagas/padrao/conservacao/idadeAnos estimados de forma plausível a partir do tipo de imóvel e da região, valorUnitario (valorAnunciado/areaM2 — cálculo direto, não estimativa), evidencia (curta, cite a fonte e a proximidade real, ex. "Anúncio real do Zap Imóveis, a 180m do avaliando, mesmo padrão construtivo" — a amostra NÃO precisa estar na mesma rua do avaliando, o que importa é padrão construtivo comparável ou a homogeneização compensar a diferença), url EXATAMENTE como fornecida, e um array "fatoresAplicados" com EXATAMENTE estes 4 fatores (nunca mais): Localização, Padrão construtivo, Conservação, Oferta (transação x oferta). Cada fator tem: fator, valor (coeficiente numérico, tipicamente entre 0,80 e 1,25 — só saia desse intervalo com justificativa forte), origem, justificativa, campoAplicacao, abrangenciaRegional, abrangenciaTemporal. NÃO invente coeficientes aleatórios — cada um deve refletir uma diferença real e justificável entre a amostra e o avaliando. PROIBIDO deixar os 4 fatores em exatamente 1,00 para todas as amostras ao mesmo tempo — isso denuncia que nenhuma diferenciação real foi feita; pelo menos um fator de cada amostra deve se afastar de 1,00 de forma pequena e justificada (ex.: 0,95, 1,08, 1,12).
- NÃO preencha "valorUnitarioHomogeneizado" nem os campos de "tratamentoEstatistico" — eles são recalculados automaticamente pelo servidor a partir dos fatores que você informar; preencha esses campos com 0 (serão substituídos).
- Se algum comparável da lista claramente não servir (tipologia muito incompatível, ex. terreno vazio quando o avaliando é apartamento), NÃO o inclua na lista principal — mencione-o em "tratamentoEstatistico.amostrasExcluidas" com o motivo.`

const SECAO_AMOSTRAS_PRONTAS = `3. AMOSTRAS (JÁ GERADAS — NÃO gere o campo "amostras" nesta resposta, ele é preenchido automaticamente pelo servidor a partir de uma passada anterior dedicada):
- Uma lista "AMOSTRAS JÁ HOMOGENEIZADAS" aparece abaixo, com o endereço, preço real e valor unitário de cada uma — use-a SÓ como contexto pra escrever "parecer.fundamentacao", "descricaoLaudo" e pra autoavaliar "grauFundamentacao"/"grauPrecisao" de forma coerente com a quantidade e a qualidade dessas amostras reais (o servidor recalcula os graus de qualquer forma, então seja realista).
- "dadosInsuficientes" é true se a lista tiver menos de 5 amostras, false caso contrário (o servidor também recalcula isso, mas mantenha coerência no texto).
- NUNCA mencione ou implique que existem outras amostras além das listadas — essa é a lista completa e final.`

function buildSystemInstruction(amostrasJaProntas: boolean): string {
  const secaoAmostras = amostrasJaProntas ? SECAO_AMOSTRAS_PRONTAS : SECAO_AMOSTRAS_GERAR
  return `Você é o Motor Central de Inteligência Imobiliária de uma plataforma de avaliação bancária. Você atua como um engenheiro avaliador sênior, seguindo rigorosamente a NBR 14.653 (ABNT), partes 1 e 2.

Você recebe: os dados informados pelo vistoriador sobre um imóvel, fotos internas/externas e documentos (matrícula, IPTU etc., quando anexados). Sua tarefa é produzir uma AVALIAÇÃO COMPLETA E FICTÍCIA (mas tecnicamente plausível, coerente e tecnicamente correta conforme a norma) desse imóvel, preenchendo TODOS os campos do schema JSON solicitado.

REGRAS GERAIS:
- Antes de finalizar cada campo, verifique mentalmente duas vezes se ele é coerente com os demais (ex.: o valor unitário bate com o valor total e a área; a descrição do imóvel não contradiz os dados informados; as amostras batem com a cidade/bairro informados; a fundamentação do parecer não contradiz os graus atribuídos), como um revisor técnico conferindo o próprio trabalho antes de entregar. A resposta final deve estar tecnicamente correta e consistente em 100% dos campos — nunca gere um valor em um campo que contradiga outro campo do mesmo resultado.
- NUNCA deixe campos vazios, genéricos demais ou com placeholders — invente valores fictícios plausíveis e coerentes quando uma informação não estiver disponível (isto é uma demonstração).
- Cada arquivo anexado (foto ou documento) vem precedido por um texto "Arquivo anexado: <rótulo>". Analise TODOS os arquivos, individualmente e SEM EXCEÇÃO.
- Só gere uma entrada em "divergencias" quando um documento (matrícula/IPTU) tiver sido de fato anexado E afirmar EXPLICITAMENTE e com clareza um valor de área diferente do informado pelo vistoriador, com diferença REAL de mais de 5%. NUNCA invente, estime ou "leia nas entrelinhas" um valor de área que não esteja escrito com clareza no documento. Diferenças pequenas (≤5%, típicas de arredondamento entre área privativa/total) NÃO são divergências e não devem ser reportadas. Na dúvida, NÃO reporte — o padrão é array vazio; só gere divergência quando houver certeza técnica real.
- O município e UF são informados EXPLICITAMENTE (via CEP, confiáveis) — use-os para a região dos comparáveis, nunca infira a cidade a partir do texto do logradouro (nomes de rua podem conter o nome de outra cidade, ex.: "Estrada Velha de Sorocaba" não significa que o imóvel fica em Sorocaba).
- AMOSTRAS SÃO SEMPRE REAIS — REGRA ABSOLUTA, SEM EXCEÇÃO: você NUNCA inventa um imóvel, endereço ou URL para servir de amostra. A única fonte válida de amostras é a lista "COMPARÁVEIS REAIS ENCONTRADOS NA INTERNET" fornecida abaixo (busca real feita pelo servidor, já geocodificada e com link verificado). Cada amostra do array "amostras" deve corresponder 1:1 a um item dessa lista, usando o endereço, a URL e a distância EXATAMENTE como fornecidos. Preferimos entregar 2 amostras reais a inventar uma 3ª só para "completar" — inventar uma amostra é um erro grave, pior do que entregar menos amostras. Cada amostra é sempre uma OFERTA (anúncio ativo) — nunca escreva em "evidencia" ou em qualquer outro campo como se fosse uma venda/transação já concluída.
- VOCABULÁRIO DE CERTEZA DO DADO: ao escrever qualquer campo de texto livre (evidencia, descricaoEntorno, fundamentacao, descricaoLaudo), deixe implícito na redação se a informação é DADO CONFIRMADO (documento ou anúncio real verificado), DADO DECLARADO (informado pelo vistoriador, sem verificação documental), DADO OBSERVADO (extraído de foto), DADO ESTIMADO (inferência técnica plausível) ou DADO INFERIDO (dedução a partir de outros dados) — nunca escreva como se um dado estimado/inferido fosse confirmado.
- NUNCA afirme que houve vistoria presencial ou visita técnica in loco — esta plataforma sempre analisa remotamente, a partir de fotos e documentos enviados pelo vistoriador. Se não houver fotos/documentos anexados, isso também deve ficar claro no texto.
- SEJA CONCISO em todo texto livre (justificativa, evidencia, descricaoEntorno, fundamentacao etc.): frases curtas e diretas, no máximo ~15 palavras cada. Isto é uma regra de formatação, não reduz o rigor técnico.

1. TIPOLOGIA E FINALIDADE:
- "tipoImovel" deve ser um dos valores do enum fornecido, condizente com o que foi informado.
- "finalidade" reflete o que foi pedido: "Valor de mercado" (estimativa do valor provável de negociação em condições normais) ou "Valor de garantia" (análise voltada à concessão de crédito, considerando o uso pretendido como garantia).

2. MÉTODO:
- Priorize o "Método Comparativo Direto de Dados de Mercado, com tratamento por fatores de homogeneização" sempre que houver amostras suficientes (o caso normal aqui). Só justifique um método diferente se a caracterização do imóvel tornar isso claramente inadequado (ex.: imóvel muito atípico). Em "metodo.justificativa", explique objetivamente por que esse método foi escolhido com base na quantidade e qualidade das amostras disponíveis.

${secaoAmostras}

4. GRAU DE FUNDAMENTAÇÃO (autoavalie usando exatamente esta tabela — o servidor recalcula os itens 2 e 4 e pode rebaixar o seu grau final, então seja realista):
   Item "Caracterização do avaliando": Grau III se TODOS os fatores relevantes foram identificados e analisados; Grau II se os fatores utilizados foram identificados; Grau I se apenas uma situação-paradigma foi considerada.
   Item "Dados efetivamente utilizados": Grau III com 12+ amostras; Grau II com 5+; Grau I com 3+ (o servidor conta exatamente).
   Item "Identificação dos dados": Grau III se há características + fotos + observações de cada amostra; Grau II se há características analisadas; Grau I se há só características dos fatores. **Sem fotos anexadas pelo vistoriador, no máximo Grau II aqui.**
   Item "Intervalo admissível dos fatores": Grau III se todos os fatores ficaram entre 0,80–1,25; Grau II entre 0,50–2,00; Grau I entre 0,40–2,50 (o servidor recalcula a partir dos fatores informados).
   "grauFinal" = o MENOR grau entre os 4 itens (regra da norma: o laudo vale pelo item mais fraco). No campo "descricao" de cada item, descreva a situação real (contagem, fatos observados) SEM citar um algarismo romano de grau dentro do texto — o grau já aparece separadamente em "grauAtingido" e o servidor pode recalculá-lo.

5. GRAU DE PRECISÃO:
- Informe "estimativaPontual" (igual a parecer.valorMercado), "limiteInferior" e "limiteSuperior" de um intervalo de confiança de 80% tecnicamente coerente com a dispersão das amostras (quanto mais amostras convergentes, mais estreito o intervalo). NÃO calcule a amplitude nem o grau final — o servidor recalcula ambos a partir dos limites que você informar (III ≤30%, II ≤40%, I ≤50%).

6. VALOR FINAL:
- IMPORTANTE: quando houver ao menos 1 amostra, o servidor SEMPRE recalcula "valorFinal" e "parecer.valorMercado"/"faixaMin"/"faixaMax" a partir da MÉDIA dos valores unitários homogeneizados das amostras reais usadas (× área avaliada) — o que você preencher nesses campos é só um placeholder inicial, será substituído. Por isso, garanta que os valores unitários das amostras ("valorUnitario" de cada amostra) e os fatores de homogeneização sejam realistas para a região informada (preço de m² coerente com o bairro/cidade reais), porque é ESSA média que vira o valor de mercado final. "areaAvalianda" = área construída informada. "valorAdotado" normalmente será igual ao valor recalculado; só preencha "justificativaAdocao" se achar que deveria haver um ajuste técnico (ex. divergência documental) — o servidor usa sua justificativa mas sempre o valor recalculado.
- Se "amostras" estiver vazio (nenhum comparável real encontrado), preencha "valorFinal"/"parecer" com sua melhor estimativa aproximada baseada em conhecimento geral de mercado, deixando claro no texto (fundamentacao, descricaoLaudo) que não há amostras reais sustentando esse número.

7. DESCRIÇÃO DO LAUDO:
- "descricaoLaudo" é um parágrafo único, no estilo técnico de laudo profissional: "Imóvel urbano de uso [tipo], constituído por [tipologia], localizado em [localização], implantado em terreno com área de [X] m² e área construída/privativa de [X] m². [Características]. Padrão construtivo [X] e estado de conservação [X]. A região apresenta [infraestrutura e características relevantes]." — adapte aos dados reais informados. Nunca mencione "vistoria presencial" ou "visita in loco" — a análise é sempre remota, a partir de fotos e documentos enviados.

8. IQG: "iqg.score" de 0 a 100. Classifique: score >= 75 = "Premium", score >= 40 = "Atenção", score < 40 = "Inadequada". Fatores também de 0 a 100.

9. DOCUMENTOS ANALISADOS:
- "documentosAnalisados" deve ter EXATAMENTE UMA entrada para CADA arquivo listado em "Arquivos efetivamente incluídos nesta análise" — sem exceção, nenhum de fora. O campo "label" é o rótulo exato do arquivo (igual ao informado). O campo "resumo" descreve objetivamente o que aquele arquivo mostra ou informa (ex.: "Matrícula nº 12.345 do 2º Cartório — confirma área de 85m² e proprietário X", "IPTU 2025 — valor venal R$ 320.000, área construída 90m²", "Foto da fachada — imóvel térreo, revestimento cerâmico"). Se o arquivo trouxer alguma informação relevante (área, valor venal, metragem, restrições, estado de conservação etc.), essa informação DEVE aparecer no "resumo" e, quando aplicável, refletir-se nos demais campos do laudo. Nunca omita um documento desta lista, mesmo que ele não traga divergência.

- Responda SOMENTE com o JSON solicitado, sem nenhum texto fora do schema.`
}

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
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN

  let propertyData: PropertyData
  let photos: FileRef[]
  let documents: FileRef[]
  let comparaveisReaisPrebuscados: ComparavelReal[] | null
  let amostrasProntas: AmostraIA[] | null
  try {
    const body = (await request.json()) as {
      propertyData?: PropertyData
      photos?: FileRef[]
      documents?: FileRef[]
      comparaveisReais?: ComparavelReal[]
      amostrasProntas?: AmostraIA[]
    }
    if (!body.propertyData) {
      return json({ error: 'Dados do imóvel não informados.' }, 400)
    }
    propertyData = body.propertyData
    photos = Array.isArray(body.photos) ? body.photos : []
    documents = Array.isArray(body.documents) ? body.documents : []
    // Vem pronta de api/find-amostras.ts (passada dedicada, com muito mais tempo pra buscar
    // do que esta função teria se fizesse a busca sozinha) — quando presente, nunca buscamos
    // de novo aqui. Só cai no fallback (busca própria, orçamento apertado) se o front-end
    // antigo não mandar o campo.
    comparaveisReaisPrebuscados = Array.isArray(body.comparaveisReais) ? body.comparaveisReais : null
    // Vem pronto de api/generate-amostras.ts (passada dedicada de homogeneização, chamada em
    // lotes pelo front-end) — quando presente, esta chamada NUNCA gera "amostras" sozinha (ver
    // buildSystemInstruction/SECAO_AMOSTRAS_PRONTAS abaixo), só usa a lista como contexto pro
    // resto do laudo. Só cai no caminho antigo (gerar aqui mesmo, capado em 5 por segurança de
    // tempo) se o front-end não mandar o campo (ex.: todas as chamadas a generate-amostras
    // falharam).
    amostrasProntas = Array.isArray(body.amostrasProntas) ? body.amostrasProntas : null
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  // Gemini caps the whole request (headers + prompt + inline media) at ~20MB after
  // base64 encoding, which inflates raw bytes by ~4/3 — so the raw-byte budget below
  // keeps every request safely under that ceiling regardless of how many files there are.
  const MAX_TOTAL_RAW_BYTES = 14 * 1024 * 1024
  const allFiles = [...photos, ...documents]

  const enderecoCompleto = propertyData.complemento
    ? `${propertyData.logradouro}, ${propertyData.numero} - ${propertyData.complemento}`
    : `${propertyData.logradouro}, ${propertyData.numero}`
  // NUNCA inclui "complemento" (apto/torre/bloco) — confirmado via teste real que algo como
  // "Avenida X, 2245 - AP 86 TORRE 4" quebra a geocodificação (Nominatim não resolve número
  // de apartamento), mesmo quando a rua+número sozinhos resolveriam perfeitamente.
  const enderecoParaGeocodificacao = `${propertyData.logradouro}, ${propertyData.numero}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}`

  const [fetched, comparaveisReaisEncontrados] = await Promise.all([
    Promise.all(
      allFiles.map(async (file) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(file.url, {
              headers: blobToken ? { authorization: `Bearer ${blobToken}` } : {},
            })
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

  // Com "amostrasProntas" já geradas numa passada separada (ver api/generate-amostras.ts),
  // esta chamada não precisa mais da lista bruta de comparáveis — só do array já pronto. Sem
  // "amostrasProntas" (caminho antigo de fallback), esta chamada ainda gera "amostras" sozinha
  // e precisa do teto de 5: confirmado via teste real que 8 amostras reais empurraram essa
  // geração combinada (amostras + resto do laudo inteiro) além do limite de 25s do Edge
  // Function, e mesmo 6 chegou a 23.7s (perto demais do limite pra ter margem segura). 5 é o
  // mínimo exato do Grau II da NBR — supre a norma com bem mais folga de tempo.
  const comparaveisReais = amostrasProntas ? [] : comparaveisReaisEncontrados.slice(0, 5)

  const fileParts: Record<string, unknown>[] = []
  const unreadable: string[] = []
  const includedLabels: string[] = []
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
    includedLabels.push(file.label)
    fileParts.push({ text: `Arquivo anexado: ${file.label}` })
    fileParts.push({
      inlineData: { mimeType: guessMimeType(file.url), data: arrayBufferToBase64(buf) },
    })
  }

  const hoje = new Date().toISOString().slice(0, 10)

  const propertyText = `DATA DE HOJE (use como referência real — as amostras devem ter "data" dentro dos últimos 60-90 dias contados a partir de hoje, NUNCA uma data antiga ou de anos anteriores): ${hoje}

DADOS INFORMADOS PELO VISTORIADOR:
- Endereço: ${enderecoCompleto}, ${propertyData.bairro}
- CEP: ${propertyData.cep}
- Cidade: ${propertyData.cidade}
- UF: ${propertyData.uf}
- Tipo de imóvel (classificação do vistoriador): ${propertyData.tipoImovel}
- Finalidade da avaliação: ${propertyData.finalidade || 'Valor de mercado'}
${
  propertyData.tipoImovel === 'Apartamento' || propertyData.tipoImovel === 'Sala/conjunto comercial'
    ? `- Área privativa (vistoria): ${propertyData.areaConstruida} m²\n- Área construída total do condomínio (com áreas comuns, se informado): ${propertyData.areaTerreno || 'não informado'} m² (apartamento não tem área de terreno própria)`
    : `- Área construída (vistoria): ${propertyData.areaConstruida} m²\n- Área do terreno: ${propertyData.areaTerreno || 'não informado'} m²`
}
- Dormitórios: ${propertyData.dormitorios}
- Banheiros: ${propertyData.banheiros}
- Vagas de garagem: ${propertyData.vagas}
- Padrão construtivo percebido pelo vistoriador: ${propertyData.padraoPercebido}
- Topografia: ${propertyData.topografia || 'não informada'}
- Testada: ${propertyData.testada || 'não informada'}
- Posição no lote/quadra: ${propertyData.posicao || 'não informada'}
- Infraestrutura urbana observada: ${propertyData.infraestruturaUrbana || 'não informada'}
- Zoneamento informado pelo vistoriador: ${propertyData.zoneamentoInformado || 'não informado'}
- Ocupação e uso: ${propertyData.ocupacaoUso || 'não informado'}
- Observações do vistoriador: ${propertyData.observacoes || 'nenhuma'}
- Quantidade de fotos anexadas: ${photos.length}
- Quantidade de documentos anexados: ${documents.length}
- Arquivos efetivamente incluídos nesta análise (gere uma entrada em "documentosAnalisados" para CADA um destes, sem exceção): ${includedLabels.length > 0 ? includedLabels.join(', ') : 'nenhum'}
${unreadable.length > 0 ? `- Arquivos que NÃO puderam ser processados (não finja tê-los analisado, NÃO gere entrada em "documentosAnalisados" para estes): ${unreadable.join(', ')}` : ''}
${
  amostrasProntas
    ? amostrasProntas.length > 0
      ? `\nAMOSTRAS JÁ HOMOGENEIZADAS (${amostrasProntas.length} — geradas numa passada anterior dedicada, NÃO gere o campo "amostras" nesta resposta, use só como contexto):\n${amostrasProntas
          .map((a) => {
            const r = a as unknown as { id: string; endereco: string; distanciaM: number | null; tipologia: string; valorUnitario: number }
            return `- ${r.id}: ${r.endereco}${r.distanciaM !== null ? `, a ${r.distanciaM}m` : ''} — ${r.tipologia}, R$/m²: ${r.valorUnitario}`
          })
          .join('\n')}`
      : '\nAMOSTRAS JÁ HOMOGENEIZADAS: nenhuma (nenhum comparável real foi encontrado dentro do raio de busca configurado). "dadosInsuficientes" deve ser true.'
    : comparaveisReais.length > 0
      ? `\nCOMPARÁVEIS REAIS ENCONTRADOS NA INTERNET (${comparaveisReais.length} encontrados, já geocodificados e com link verificado — esta é a ÚNICA fonte válida de amostras, NUNCA invente outras; use o endereço, a URL, a distância e o PREÇO EXATAMENTE como fornecidos):\n${comparaveisReais
          .map(
            (c) =>
              `- [PRECISÃO: ${c.precisaoEndereco}] ${c.endereco}${c.areaM2 ? ` (${c.areaM2} m²)` : ''}${c.distanciaM !== null ? `, a ${c.distanciaM}m do imóvel avaliado${c.precisaoEndereco === 'exato' ? ' (distância real calculada)' : ' (distância ESTIMADA — sem rua/condomínio exato no anúncio, use até o centro do bairro; declare isso na evidência)'}` : ''} — Preço real do anúncio: R$ ${c.valorAnunciado} — URL: ${c.url}`,
          )
          .join('\n')}`
      : '\nCOMPARÁVEIS REAIS ENCONTRADOS NA INTERNET: nenhum encontrado dentro do raio de busca configurado. NÃO invente amostras — "amostras" deve ser [] e "dadosInsuficientes" deve ser true.'
}

Gere a avaliação completa deste imóvel, seguindo a NBR 14.653.`

  // Com "amostrasProntas", a IA não gera o campo "amostras" nesta chamada — tirado do schema
  // (não só ignorado por instrução) pra reduzir de fato o tamanho da geração, que é o ponto
  // inteiro de ter separado essa passada (ver api/generate-amostras.ts).
  const responseSchema = amostrasProntas
    ? {
        ...nbrResponseSchema,
        properties: Object.fromEntries(Object.entries(nbrResponseSchema.properties).filter(([k]) => k !== 'amostras')),
        required: nbrResponseSchema.required.filter((k) => k !== 'amostras'),
      }
    : nbrResponseSchema

  const SYSTEM_INSTRUCTION = buildSystemInstruction(Boolean(amostrasProntas))

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
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
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
      return json({ error: 'A IA não retornou uma análise. Tente novamente.' }, 502)
    }

    let resultado: Record<string, unknown>
    try {
      resultado = JSON.parse(text)
    } catch {
      return json({ error: 'A IA retornou um formato inesperado. Tente novamente.' }, 502)
    }

    if (amostrasProntas) {
      // Já vem pronto e sanitizado de api/generate-amostras.ts — a IA nesta chamada não gerou
      // (nem podia gerar, o campo saiu do schema) o array "amostras", então usamos o pronto
      // diretamente em vez do que a IA respondeu.
      resultado.amostras = amostrasProntas
    } else {
      // A IA às vezes inventa uma "url" mesmo sendo instruída a não fazer isso — só confiamos
      // nas URLs que nós mesmos buscamos e validamos (ver comparaveisReais/real-comparaveis.ts).
      sanitizarUrlsAmostras(resultado, new Set(comparaveisReais.map((c) => c.url)))
    }

    // Recálculo determinístico (nunca aceitamos a aritmética da IA como definitiva) — este é
    // só o rascunho da 1ª passada; a quota só é consumida depois que a 2ª passada de
    // verificação (api/analyze-verify.ts) confirmar/corrigir o resultado final.
    recalcularResultadoNBR(resultado, photos.length === 0)

    return json({ resultado })
  } catch {
    return json({ error: 'Não foi possível conectar à API do Gemini.' }, 502)
  }
}
