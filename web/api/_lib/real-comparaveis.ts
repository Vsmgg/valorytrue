import { geocodeEndereco, haversineMeters, sleep, type Coordenadas } from './geocode.js'

export interface ComparavelReal {
  endereco: string
  areaM2: number | null
  /** Preço real extraído do próprio anúncio (nunca uma estimativa) — a exigência de um preço
   * detectável no texto é o que distingue um anúncio de unidade específica de uma página
   * genérica do condomínio/empreendimento (que não tem preço de venda de uma unidade). */
  valorAnunciado: number | null
  distanciaM: number | null
  url: string
  /** Tipologia detectada por palavra-chave no próprio texto do anúncio (ex.: "Apartamento",
   * "Casa", "Sobrado") — null quando o texto não deixa claro. Só um SINAL pra transparência
   * (mostrar ao usuário quantos imóveis de cada tipo a busca realmente encontrou, mesmo os que
   * não viram amostra por serem de tipo incompatível com o avaliando) — nunca usado como filtro
   * de aceitação/rejeição do candidato em si. */
  tipoDetectado: string | null
  /** 'exato' (rua+número real) | 'condominio' (nome do condomínio real) | 'bairro' (nem rua nem
   * condomínio identificados no texto — usa o bairro como ponto aproximado). Quando não-'exato',
   * "distanciaM" é uma ESTIMATIVA, não um cálculo exato — consumidores (prompt de geração de
   * amostras, laudo narrativo) devem refletir isso na linguagem (DADO ESTIMADO), nunca afirmar
   * como distância exata calculada. Ver extrairEnderecoComPrecisao. */
  precisaoEndereco: PrecisaoEndereco
}

interface BuscarParams {
  /** Full postal address of the subject property (street, number, bairro, cidade - uf), used for geocoding. */
  enderecoCompleto: string
  cidade: string
  uf: string
  bairro: string
  /** Pedido explícito do usuário: buscar pelo CEP em vez de só pelo endereço exato — usado
   * pra encontrar a página de CATÁLOGO/LISTAGEM de cada portal pra essa região (ver
   * buscarPaginaCategoriaPorCep), que costuma render muito mais anúncios reais de uma vez do
   * que pedir anúncios individuais direto. */
  cep?: string
  tipoImovel: string
  /** Número do endereço do imóvel avaliando (ex.: "250") — usado só pra priorizar, na
   * ordenação final, um candidato cujo endereço bate no número exato do avaliando, mesmo que
   * ruído de geocodificação faça outro candidato aparecer nominalmente alguns metros "mais
   * perto" (pedido explícito do usuário: "se houver um imóvel no endereço exato, priorize
   * esse resultado"). */
  numeroAvaliando?: string
  max?: number
  /** Overrides OVERALL_BUDGET_MS — callers with their own dedicated Edge Function invocation
   * (see api/find-amostras.ts) can afford to give this far more time than callers who run it
   * squeezed alongside a heavy generation call within the same 25s request (api/analyze.ts). */
  budgetMs?: number
  /** Deslocamento inicial de paginação (0, 10, 20...) — usado quando o CHAMADOR encadeia
   * múltiplas invocações separadas do Edge Function (cada uma com seu próprio limite de 25s)
   * pra buscar por mais tempo total do que uma única invocação permitiria. Sem isso, uma 2ª
   * invocação re-buscaria as mesmas primeiras páginas da 1ª. */
  offsetBase?: number
  /** Coordenadas do imóvel avaliando já geocodificadas por uma chamada anterior — quando o
   * chamador encadeia múltiplas invocações pra mesma busca, evita geocodificar o MESMO
   * endereço do zero a cada chamada (economiza chamadas ao serviço de geocodificação, que tem
   * limite de uso justo e é compartilhado — confirmado via teste real que buscas exaustivas
   * repetidas no mesmo dia esgotaram a cota). Se não informado, geocodifica normalmente. */
  origemCoords?: Coordenadas
}

export interface ResultadoBusca {
  comparaveis: ComparavelReal[]
  /** Coordenadas do imóvel avaliando, pra o chamador reaproveitar em chamadas seguintes via
   * `origemCoords` — null quando a geocodificação do endereço avaliando falhou. */
  origem: Coordenadas | null
  /** Próximo `offsetBase` a usar numa chamada encadeada seguinte desta mesma busca — o offset
   * real onde esta chamada parou de paginar, não um múltiplo fixo. Sem isso, um chamador que
   * incrementa `offsetBase` num passo fixo (ex.: +10 por chamada) pode pular ou pular menos
   * páginas do que as que esta chamada efetivamente consumiu (que depende de quantas rodadas
   * couberam no orçamento de tempo desta invocação). */
  proximoOffsetBase: number
}

interface GroundingChunk {
  web?: { uri?: string; title?: string }
}

interface GroundingSupport {
  segment?: { text?: string }
  groundingChunkIndices?: number[]
}

// Captura SÓ o nome da rua (até a primeira vírgula, sem HTML, sem pipe/asterisco de
// formatação) — deliberadamente curto. Bairro, cidade, nome de condomínio, preço etc. NUNCA
// são capturados aqui; nós já sabemos bairro/cidade/UF por fora (vêm de propertyData), então
// não precisamos (e não devemos) tentar extrair isso do texto livre do resultado de busca.
// A lista de caracteres de corte cresceu por necessidade real: cada fonte de busca usa um
// separador diferente entre endereço/preço/taxa no título do resultado — Google/Gemini usam
// vírgula, a Brave usa "·" (meio-ponto) e "-" (confirmado via teste real: sem "·" na lista,
// "Avenida X · R$ 424.000 · Cond. R$ 387" vazava inteiro pro campo de endereço).
const ENDERECO_BASE_RE = /(?:Rua|Avenida|Av\.|Alameda|Travessa|Estrada|Rodovia)[^,\n*|<>·•\-:]{2,55}/i
// Número do imóvel — é a única outra coisa que capturamos do endereço em si. Permite até ~20
// caracteres de texto antes do número (ex.: ", nº ", " - ", "próximo ao "), não só adjacência
// estrita — confirmado via teste real que exigir adjacência total perdia o número em textos
// tipo "Avenida Faria Lima, apto 2 quartos, 3477" (número mais distante do nome da rua), o que
// fazia o endereço geocodificar sem número (um ponto genérico ao longo de avenidas longas) e
// rejeitava candidatos que na verdade estavam pertinho. Nunca cruza um "R$"/"m²" no meio (evita
// capturar o preço ou a área por engano).
const NUMERO_PROXIMO_RE = /^(?:(?!R\$|m²)[^\d]){0,20}?(\d{1,6})[A-Za-z]?\b/
// Pedido explícito do usuário: "tem que funcionar para casas também" — em bairros de
// condomínio fechado (comuns em casas/sobrados, ex. Granja Viana), a MAIORIA dos anúncios reais
// nunca cita uma rua no texto (o portal só mostra o nome do condomínio + bairro, sem endereço
// exato — prática comum de privacidade do vendedor/corretor). Exigir "Rua/Avenida X" descartava
// esses anúncios reais em massa, mesmo quando o nome do condomínio (um identificador real e
// geocodificável) estava bem ali no texto. Confirmado via teste manual: só 2 de 30 anúncios
// reais de sobrados na Granja Viana citavam uma rua, mas praticamente todos citavam o
// condomínio.
const CONDOMINIO_RE = /(?:Condom[ií]nio|Cond\.)\s+([A-ZÀ-Ú][^,\n*|<>·•\-.:]{2,45})/
// O símbolo "²" às vezes some do texto (confirmado via teste real: um bloco JSON-LD de SEO do
// imovelweb.com.br trazia "Área Privativa de 59 m," sem o "²") — aceita "m" sozinho como
// fallback, desde que seguido de fronteira de palavra (evita casar o "m" no meio de outra
// palavra qualquer).
const AREA_RE = /(\d{2,4})\s*m(?:²|\b)/
// "R$" às vezes vem com espaço solto DENTRO do próprio número (confirmado via teste real no
// mesmo bloco JSON-LD: "R$ 410. 000, 00" em vez de "R$ 410.000,00") — sem tolerar espaço entre
// os separadores de milhar/decimal, a captura parava no 1º grupo de 3 dígitos e lia um preço
// 1000x menor (ex.: R$ 410 em vez de R$ 410.000), que depois falhava o piso de R$30 mil e
// descartava um candidato real. Espaço é removido antes de converter pra número (ver abaixo).
const PRECO_RE = /R\$\s*(\d{1,3}(?:[.\s]*\d{3})*(?:,\s*\d{2})?)/
// Preço/área às vezes só aparecem de forma limpa na própria URL do anúncio, não no texto ao
// redor do link — confirmado via teste real com páginas de categoria buscadas direto (ver
// extrairCandidatosDeCategoria): o padrão "...-59m2-RS425000/id-.../" (ou variações, ex.
// "...venda-RS530000-id-.../") é comum a vários portais (chavesnamao, vivareal, zapimoveis), e
// nem sempre bate com o texto visível do "card" do anúncio na listagem. Usado como
// FALLBACK quando o texto não traz um preço/área formatado.
const PRECO_URL_RE = /RS(\d{4,})/i
const AREA_URL_RE = /(\d{2,4})m2\b/i

/** Remove marcação HTML (a Brave Search API destaca termos batidos com <strong>...</strong> nos
 * trechos, por padrão) — sem isso, "<strong>" literal vazava pro campo "endereco" e quebrava a
 * geocodificação (confirmado via teste real). */
function removerHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ')
}

/** Extrai só "rua + número" do texto — captura deliberadamente estreita (ver ENDERECO_BASE_RE)
 * em vez da abordagem antiga de "capturar bastante e cortar nos padrões de lixo conhecidos",
 * que virou um jogo de gato e rato: cada fonte de busca nova (Gemini, Google, Brave) trazia um
 * formato de lixo à direita do endereço diferente (nome de condomínio, preço, "no Brasil - ID",
 * HTML) que a lista de padrões de corte não previa. Capturar só o essencial evita o problema
 * inteiro — não hÁ nada pra cortar se nunca foi capturado. */
function extrairEndereco(text: string): string | null {
  const baseMatch = text.match(ENDERECO_BASE_RE)
  if (!baseMatch || baseMatch.index === undefined) return null
  let endereco = baseMatch[0].trim()
  const resto = text.slice(baseMatch.index + baseMatch[0].length)
  const numeroMatch = resto.match(NUMERO_PROXIMO_RE)
  if (numeroMatch) endereco += `, ${numeroMatch[1]}`
  endereco = endereco.trim().replace(/[,\s]+$/, '')
  return endereco || null
}

/** Nível de precisão da localização de uma amostra — usado pra nunca afirmar uma distância
 * exata quando na verdade só temos uma localização aproximada (pedido explícito do usuário:
 * aceitar bairro como último recurso, mas "marcar isso claramente pro laudo não afirmar uma
 * distância falsamente exata"). 'exato' = rua+número real, geocodificado direto. 'condominio' =
 * nome do condomínio real, geocodificado com o bairro/cidade pra desambiguar. 'bairro' = nem rua
 * nem condomínio identificados no texto — usa o centro do bairro (que já sabemos ser onde o
 * anúncio está, é o escopo da própria busca) como ponto aproximado; a distância vira uma
 * ESTIMATIVA, não um cálculo exato. */
type PrecisaoEndereco = 'exato' | 'condominio' | 'bairro'

/** Extrai o endereço em 3 níveis de precisão, na ordem pedida pelo usuário: rua+número exato
 * primeiro, nome do condomínio como 2º recurso, bairro como último recurso — nunca descarta um
 * anúncio real só por não citar uma rua (comum em casas/sobrados de condomínio fechado, ver
 * CONDOMINIO_RE). `bairro` vem do PRÓPRIO escopo da busca (é o bairro que estamos pesquisando),
 * não é extraído do texto — por isso o nível 'bairro' está sempre disponível como último
 * recurso, nunca null. */
function extrairEnderecoComPrecisao(text: string, bairro: string): { endereco: string; precisao: PrecisaoEndereco } | null {
  const exato = extrairEndereco(text)
  if (exato) return { endereco: exato, precisao: 'exato' }
  const condoMatch = text.match(CONDOMINIO_RE)
  if (condoMatch) {
    const nome = condoMatch[1].trim().replace(/[,\s]+$/, '')
    if (nome) return { endereco: `Condomínio ${nome}`, precisao: 'condominio' }
  }
  if (bairro.trim()) return { endereco: bairro.trim(), precisao: 'bairro' }
  return null
}
/** Extrai o número final de um endereço "rua, número" (mesmo formato produzido por
 * extrairEndereco) — usado só pra comparar com o número do avaliando (priorização) e pra
 * corroborar deduplicação entre portais (ver deduplicarPorImovelFisico). */
function numeroDoEndereco(endereco: string): string | null {
  const m = endereco.match(/,\s*(\d+)[A-Za-z]?\s*$/)
  return m ? m[1] : null
}

// A amostra deve ser real — nunca inventada. Preferimos o mesmo endereço/prédio (ver
// ordenarPorPrioridade, que prioriza o número exato independente da distância dentro deste
// raio), mas quando não há oferta suficiente ali, aceitamos expandir até este raio, nunca além
// dele. Subiu de 500m pra 1000m a pedido explícito do usuário.
const RAIO_INICIAL_M = 1_000
// Tipos de imóvel de baixa densidade (casas, sobrados, terrenos, imóveis rurais) têm
// naturalmente muito menos anúncios por m² de região do que apartamentos — confirmado via
// teste real com um endereço rural (Estrada Velha de Sorocaba, Cotia/SP) que tinha anúncios
// reais e verificados na região, mas todos a 900-1400m do ponto exato: o piso de 500m (correto
// pra apartamento/sala comercial, onde há muito mais oferta por m²) descartava candidatos
// genuinamente da mesma região só por causa da baixa densidade típica desses tipos de imóvel.
// Pedido explícito do usuário: manter 500m pros tipos densos, abrir um raio maior só pra esses.
const RAIO_BAIXA_DENSIDADE_M = 2_000
const TIPOS_BAIXA_DENSIDADE = new Set([
  'Casa residencial', // Empresa Avaliadora (TIPOS_IMOVEL_NBR)
  'Sobrado',
  'Terreno/lote urbano',
  'Imóvel rural',
  'Casa', // AVM Cliente Final (opções próprias, strings diferentes do laudo NBR)
  'Terreno',
])
function raioParaTipoImovel(tipoImovel: string): number {
  return TIPOS_BAIXA_DENSIDADE.has(tipoImovel) ? RAIO_BAIXA_DENSIDADE_M : RAIO_INICIAL_M
}
// DEFAULT budget, used when a caller doesn't pass its own `budgetMs` — i.e. callers that run
// this search squeezed inside a request that also has to fit a heavy Gemini generation call
// within the same 25s Edge Function deadline (api/analyze.ts's fallback path, api/avm.ts).
// Measured empirically there: 4s cut the search short before real results could come back
// (confirmed via logs showing zero candidates for an obviously well-covered address), but
// 8-12s pushed the TOTAL request past 25s on its own (the generation call alone varies
// 10-24s). 4s is the safest default in that cramped context. Callers that instead run this
// as their OWN dedicated Edge Function invocation (api/find-amostras.ts) pass a much larger
// `budgetMs` — with no generation call sharing the request, there's no such ceiling pressure.
const OVERALL_BUDGET_MS = 4_000
// Real listing URLs from search grounding go stale fast (properties sell, ads expire) —
// presenting a dead link as "real evidence" in a professional laudo is worse than not
// showing it, so every candidate URL is verified to actually resolve before being kept.
// Subiu de 2,5s pra 5s — confirmado via teste real que o desafio antibot do Cloudflare em
// portais como o VivaReal (que serve um 403 real, não uma página realmente morta) às vezes
// não responde a tempo dentro de 2,5s rodando do Edge Function da Vercel, o que fazia a
// checagem cair no timeout/erro de rede e tratar um link VIVO como morto (ver urlEstaViva).
const URL_CHECK_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

/** A regex de preço às vezes pega o número errado da página (entrada/parcela de financiamento,
 * taxa de condomínio) em vez do preço de venda — um teto/piso universal (ver validação acima)
 * não pega isso quando o número errado ainda cai numa faixa plausível em ALGUM lugar do Brasil,
 * mas é implausível PARA ESSA região específica (confirmado via teste real: R$150.000 por 59m²
 * passou pelo teto de R$60.000/m² porque dava só ~R$2.500/m², mas a região real gira em torno de
 * R$5.400-7.100/m² — 2,5x mais). Como não sabemos o preço real da região neste ponto do código,
 * comparamos cada candidato aos OUTROS candidatos do mesmo lote de busca — um preço muito
 * distante da mediana do próprio grupo é mais provavelmente um erro de extração do que uma
 * pechincha real. Só atua quando há pelo menos 2 candidatos com área para formar uma mediana. */
function filtrarOutliersDePreco(candidatos: CandidatoBruto[]): CandidatoBruto[] {
  const comArea = candidatos.filter(
    (c): c is CandidatoBruto & { areaM2: number; valorAnunciado: number } => Boolean(c.areaM2 && c.areaM2 > 0 && c.valorAnunciado),
  )

  // Rede de segurança adicional pra candidatos SEM área — confirmado via teste real que a
  // mesma página institucional de condomínio (sem preço de nenhuma unidade específica, só um
  // valor promocional tipo "a partir de R$150.000") reaparece consistentemente em buscas
  // diferentes (Gemini, Google, Brave) com um preço absoluto muito abaixo do resto do lote,
  // e sem área pra calcular R$/m² o teto/piso por m² acima não pega esse caso. Quando não dá
  // pra comparar por m², comparamos o preço absoluto com a mediana dos preços absolutos do
  // lote inteiro. 0,5x-2x (mais apertado que o filtro por m²) porque com poucos candidatos
  // (às vezes só 2) a "mediana" é instável — testado com R$150.000 vs R$380.000 real (razão
  // 0,39x) e confirmado que só um teto mais apertado rejeita esse caso específico.
  const precosAbsolutos = candidatos.map((c) => c.valorAnunciado).filter((v): v is number => Boolean(v)).sort((a, b) => a - b)
  const medianaAbsoluta = precosAbsolutos.length >= 2 ? precosAbsolutos[Math.floor(precosAbsolutos.length / 2)] : null

  if (comArea.length < 2 && !medianaAbsoluta) return candidatos

  const precosM2 = comArea.map((c) => c.valorAnunciado / c.areaM2).sort((a, b) => a - b)
  const medianaM2 = comArea.length >= 2 ? precosM2[Math.floor(precosM2.length / 2)] : null

  return candidatos.filter((c) => {
    if (c.areaM2 && c.areaM2 > 0 && c.valorAnunciado && medianaM2) {
      const precoM2 = c.valorAnunciado / c.areaM2
      return precoM2 >= medianaM2 * 0.4 && precoM2 <= medianaM2 * 2.5
    }
    if (c.valorAnunciado && medianaAbsoluta) {
      return c.valorAnunciado >= medianaAbsoluta * 0.5 && c.valorAnunciado <= medianaAbsoluta * 2
    }
    return true // sem dados suficientes pra comparar — os outros filtros já cobrem o básico
  })
}

interface CandidatoBruto {
  endereco: string
  areaM2: number | null
  valorAnunciado: number | null
  url: string
  tipoDetectado: string | null
  precisaoEndereco: PrecisaoEndereco
}

/** Normaliza "rua, número" pra comparação: sem acento, minúsculo, sem prefixo de logradouro
 * (Rua/Av./Alameda/etc.), sem pontuação. A extração de endereço (ver ENDERECO_BASE_RE) já
 * corta em pontos diferentes dependendo da fonte, então a comparação de rua usa prefixo em
 * comum, não igualdade estrita. */
function normalizarEnderecoBase(endereco: string): { rua: string; numero: string | null } {
  const numero = numeroDoEndereco(endereco)
  const semNumero = numero ? endereco.replace(/,\s*\d+[A-Za-z]?\s*$/, '') : endereco
  const rua = semNumero
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(av\.?|avenida|r\.?|rua|al\.?|alameda|tv\.?|travessa|est\.?|estrada|rod\.?|rodovia)\s+/, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { rua, numero }
}

/** Decide se dois candidatos (já geocodificados/verificados) são o MESMO imóvel físico
 * anunciado em portais diferentes — pedido explícito do usuário ("se o mesmo imóvel aparecer
 * em vários portais, considere como uma única amostra"). Nunca funde só porque o endereço
 * bate: um prédio grande tem várias unidades reais e distintas no mesmo número (apto 201 vs.
 * apto 502), cada uma uma amostra legítima e diferente — por isso exige corroboração adicional
 * de preço OU área dentro de uma tolerância apertada antes de considerar duplicata. */
function mesmoImovelFisico(a: ComparavelReal, b: ComparavelReal): boolean {
  const na = normalizarEnderecoBase(a.endereco)
  const nb = normalizarEnderecoBase(b.endereco)
  if (!na.rua || !nb.rua) return false
  const ruaBate = na.rua === nb.rua || na.rua.startsWith(nb.rua) || nb.rua.startsWith(na.rua)
  if (!ruaBate) return false
  if (na.numero && nb.numero && na.numero !== nb.numero) return false

  const areaBate =
    a.areaM2 && b.areaM2 ? Math.abs(a.areaM2 - b.areaM2) / Math.max(a.areaM2, b.areaM2) <= 0.08 : null
  const precoBate =
    a.valorAnunciado && b.valorAnunciado
      ? Math.abs(a.valorAnunciado - b.valorAnunciado) / Math.max(a.valorAnunciado, b.valorAnunciado) <= 0.05
      : null

  if (areaBate === false || precoBate === false) return false
  return areaBate === true || precoBate === true
}

function candidatoMaisCompleto(candidato: ComparavelReal, existente: ComparavelReal): boolean {
  if (Boolean(candidato.areaM2) !== Boolean(existente.areaM2)) return Boolean(candidato.areaM2)
  return (candidato.distanciaM ?? Infinity) < (existente.distanciaM ?? Infinity)
}

/** Colapsa candidatos que representam o mesmo imóvel físico anunciado em portais diferentes
 * numa única amostra (mantendo o mais completo dos dois — o que tem área, ou o mais próximo em
 * caso de empate) — nunca mostra múltiplos links por amostra (decisão de escopo: manter o
 * modelo de dado com uma única `url` por amostra, só evitar contar o mesmo imóvel 2x). */
function deduplicarPorImovelFisico(comparaveis: ComparavelReal[]): ComparavelReal[] {
  const mantidos: ComparavelReal[] = []
  for (const candidato of comparaveis) {
    const idx = mantidos.findIndex((m) => mesmoImovelFisico(m, candidato))
    if (idx === -1) {
      mantidos.push(candidato)
      continue
    }
    if (candidatoMaisCompleto(candidato, mantidos[idx])) {
      console.error('[real-comparaveis] duplicata entre portais — troca por versão mais completa:', candidato.url, 'no lugar de', mantidos[idx].url)
      mantidos[idx] = candidato
    } else {
      console.error('[real-comparaveis] duplicata entre portais descartada:', candidato.url, '(mantido:', mantidos[idx].url, ')')
    }
  }
  return mantidos
}

/** Extrai os campos de um item de resultado de busca (título + trecho, de qualquer fonte —
 * Gemini grounding, Google CSE, Brave) usando as mesmas regras de qualidade: preço obrigatório
 * (distingue anúncio real de página institucional), endereço restrito a rua+número (ver
 * extrairEndereco), e teto/piso de R$/m² absoluto. Compartilhada pelos três caminhos de busca. */
// Caminhos de URL que sites imobiliários usam pra páginas INSTITUCIONAIS de condomínio/
// empreendimento (visão geral do prédio, não um anúncio de uma unidade específica à venda) —
// confirmado via teste real que "vivareal.com.br/condominio/viva-mais-barueri-.../" e páginas
// parecidas continuavam passando pelos outros filtros (têm número na URL, às vezes até
// mencionam um preço de alguma unidade do prédio) mesmo não sendo o anúncio de uma unidade.
const PAGINA_INSTITUCIONAL_RE = /\/condominio\/|\/empreendimento\/|\/lancamento\//i
// "-aluguel"/"-locacao" na query já pede pro buscador excluir, mas nem sempre funciona —
// confirmado via teste real que um anúncio de ALUGUEL (não venda) passou mesmo assim, com
// "aluguel" literalmente na URL (ex.: ".../390m2-aluguel-RS70200-id-.../"). Segunda camada de
// defesa: nunca é uma amostra válida pro método comparativo de VALOR DE VENDA.
const ALUGUEL_URL_RE = /aluguel|locacao|locação/i

/** BUG real encontrado e corrigido: o grounding de busca do Gemini (usado em paralelo com a
 * Brave, ver umaRodada) às vezes devolve como "url" da fonte um link de REDIRECIONAMENTO do
 * Google (domínio cloud.google.com/vertexaisearch), não o link direto do anúncio — confirmado
 * via teste real: uma amostra entregue ao usuário tinha "Ver anúncio real" apontando pra um
 * link do Google, com "fonte" derivada como "cloud.google.com" em vez do portal de verdade. Um
 * link errado é pior que uma amostra a menos, então toda URL passa por este check: só é aceita
 * se o domínio bater com um dos 5 portais configurados (ou um subdomínio deles, ex.
 * "www."/"ca." na frente) — não importa a fonte de busca que a trouxe. */
function urlPertenceAPortalConhecido(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return PORTAIS.some((p) => host === p || host.endsWith(`.${p}`))
  } catch {
    return false
  }
}

/** Mesmo critério que extrairCandidato usa pra rejeitar uma URL como "página de categoria/
 * listagem" (sem dígito, não institucional, não aluguel) — mas aqui só identifica, não
 * descarta: essas URLs viram "leads" pra buscar direto (ver extrairCandidatosDeCategoria),
 * porque cada uma tende a listar dezenas de anúncios individuais reais de uma vez. */
function ehPaginaDeCategoria(url: string): boolean {
  return urlPertenceAPortalConhecido(url) && !PAGINA_INSTITUCIONAL_RE.test(url) && !ALUGUEL_URL_RE.test(url) && !/\d/.test(url)
}

/** Detecção simples por palavra-chave (URL + texto do anúncio) — só pra fins de transparência
 * (mostrar ao usuário quantos imóveis de cada tipo a busca encontrou de verdade, mesmo os que
 * não viram amostra por incompatibilidade de tipologia com o avaliando), nunca usada como
 * filtro de aceitação/rejeição do candidato. Ordem importa: "casa em condomínio"/"casa de
 * condomínio" tende a vir antes de "casa" isolado nos títulos, então checa a variante composta
 * primeiro. */
const TIPO_DETECCAO: [RegExp, string][] = [
  [/apartamento/i, 'Apartamento'],
  [/sobrado/i, 'Sobrado'],
  [/casa[\s-]*(em|de)[\s-]*condom[ií]nio/i, 'Casa em condomínio'],
  [/\bcasa\b/i, 'Casa'],
  [/terreno|lote\b/i, 'Terreno/lote'],
  [/gal[pã]?[aã]o|dep[oó]sito/i, 'Galpão/Depósito'],
  [/sala[\s-]*comercial|conjunto[\s-]*comercial/i, 'Sala/conjunto comercial'],
  [/loja\b/i, 'Loja'],
]
function detectarTipo(textoBruto: string, url: string): string | null {
  const alvo = `${url} ${textoBruto}`
  for (const [re, label] of TIPO_DETECCAO) {
    if (re.test(alvo)) return label
  }
  return null
}

function extrairCandidato(textoBruto: string, url: string | undefined, bairro: string): CandidatoBruto | null {
  if (!url) return null
  if (!urlPertenceAPortalConhecido(url)) return null
  if (PAGINA_INSTITUCIONAL_RE.test(url)) return null
  if (ALUGUEL_URL_RE.test(url)) return null
  // Páginas de CATEGORIA/listagem (ex.: "zapimoveis.com.br/venda/apartamentos/sp+barueri++jd-
  // belval/") não são um anúncio de uma unidade específica, mesmo que o trecho de busca
  // mencione um preço de algum imóvel listado nela — confirmado via teste real. Um anúncio de
  // unidade específica sempre tem algum número na URL (ID do anúncio, número do endereço,
  // preço, CEP); uma página de categoria/listagem, quase nunca.
  if (!/\d/.test(url)) return null
  const text = removerHtml(textoBruto)

  const precoMatch = text.match(PRECO_RE)
  const valorAnunciado = precoMatch
    ? Number(precoMatch[1].replace(/\s+/g, '').replace(/\./g, '').replace(',', '.'))
    : (() => {
        const m = url.match(PRECO_URL_RE)
        return m ? Number(m[1]) : null
      })()
  if (!valorAnunciado || !Number.isFinite(valorAnunciado) || valorAnunciado < 30_000) return null

  const areaMatch = text.match(AREA_RE)
  const areaM2 = areaMatch ? Number(areaMatch[1]) : (() => {
    const m = url.match(AREA_URL_RE)
    return m ? Number(m[1]) : null
  })()
  if (areaM2) {
    const precoM2 = valorAnunciado / areaM2
    if (precoM2 < 800 || precoM2 > 60_000) return null
  }
  const enderecoInfo = extrairEnderecoComPrecisao(text, bairro)
  if (!enderecoInfo) return null

  return {
    endereco: enderecoInfo.endereco,
    precisaoEndereco: enderecoInfo.precisao,
    areaM2,
    valorAnunciado,
    url,
    tipoDetectado: detectarTipo(text, url),
  }
}

/**
 * BUG real encontrado e corrigido: a Brave Search API foi removida do pipeline a pedido
 * explícito do usuário (considerou o resultado dela ruim demais). A Google Custom Search
 * TAMBÉM foi removida — confirmado via teste real que credenciais antigas ainda salvas na
 * Vercel (de uma tentativa anterior abandonada nesta mesma sessão por um erro 403 de permissão
 * nunca resolvido) estavam SEQUESTRANDO a prioridade de volta pro caminho quebrado assim que a
 * Brave saiu do código, mesmo sem nenhuma intenção de usar o Google — 20 rodadas, todas com
 * erro 403/400, zero amostras. Deixar um "caminho alternativo se configurado" é perigoso
 * quando a credencial pode ficar esquecida configurada mas quebrada; mais seguro remover o
 * caminho inteiro. O Gemini (google_search grounding) é agora a ÚNICA fonte de busca real.
 */
interface ResultadoBuscaPortal {
  candidatos: CandidatoBruto[]
  /** URLs de página de CATEGORIA (ex.: "chavesnamao.com.br/apartamentos-a-venda/sp-barueri/
   * bairros/.../") vistas nesta rodada — descartadas como amostra (não são o anúncio de uma
   * unidade), mas guardadas à parte porque cada uma dessas páginas costuma listar DEZENAS de
   * unidades reais de uma vez. Ver extrairCandidatosDeCategoria. */
  categorias: string[]
}

/**
 * Pedido explícito do usuário: em vez de pedir anúncios individuais direto (que o grounding do
 * Gemini às vezes não consegue achar de forma confiável), busca primeiro a URL da página de
 * CATÁLOGO/LISTAGEM de cada portal pra região do CEP informado (ex.: pesquisar algo como
 * "06420-130 imóveis comprar site:chavesnamao.com.br") — depois essa página é buscada DIRETO
 * (ver extrairCandidatosDeCategoria) e os anúncios individuais reais são extraídos do HTML
 * dela, o que já foi testado manualmente e confirmado funcionar (15 de 15 anúncios reais
 * extraídos de uma única página de catálogo). Devolve só a URL, não faz extração aqui.
 */
async function buscarPaginaCategoriaPorCep(
  site: string,
  cep: string,
  bairro: string,
  cidade: string,
  uf: string,
  tipoImovel: string,
  timeoutMs: number,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  const prompt = `Busque no Google a URL da página de LISTAGEM/CATÁLOGO (a página que lista MÚLTIPLOS imóveis de uma vez, tipo "X imóveis à venda em [bairro]" — NÃO um anúncio de uma única unidade) de imóveis do tipo "${tipoImovel}" À VENDA, em site:${site}, para a região do CEP ${cep} (bairro ${bairro}, ${cidade} - ${uf}). Responda SOMENTE com a URL encontrada, nada mais, sem introdução.`
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      console.error('[real-comparaveis] categoria-por-cep non-OK', site, res.status)
      return null
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: GroundingChunk[] } }[]
    }
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || []
    // As URLs do grounding vêm sempre como link de redirecionamento do Google — resolve antes
    // de checar o domínio (ver resolverRedirecionamentoGemini).
    const brutas = chunks.map((c) => c.web?.uri).filter((u): u is string => Boolean(u))
    const resolvidas = await Promise.all(brutas.map((u) => resolverRedirecionamentoGemini(u)))
    let achada = resolvidas.find((u) => urlPertenceAPortalConhecido(u))
    // Fallback: o texto da RESPOSTA da IA (não os chunks de grounding) foi pedido explicitamente
    // pra ser só a URL — às vezes o grounding não gera um chunk pro resultado que a IA de fato
    // usou pra responder (confirmado via teste real: grounding trouxe 0 chunks no domínio certo
    // em duas regiões bem diferentes, mesmo com resultado plausível), mas o texto puro da
    // resposta ainda pode conter uma URL válida e real (o Google Search grounding não inventa
    // URLs fora do que a busca encontrou, só a citação via chunk que às vezes falha).
    if (!achada) {
      const textoResposta = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') || ''
      const matchUrl = textoResposta.match(/https?:\/\/\S+/)
      if (matchUrl) {
        const resolvidaDoTexto = await resolverRedirecionamentoGemini(matchUrl[0].replace(/[.,;)\]]+$/, ''))
        if (urlPertenceAPortalConhecido(resolvidaDoTexto)) achada = resolvidaDoTexto
      }
    }
    console.error(
      '[real-comparaveis] categoria-por-cep',
      site,
      ':',
      achada || `nenhuma URL do portal encontrada (${chunks.length} chunk(s) de grounding, ${brutas.length} url(s) bruta(s))`,
    )
    return achada ?? null
  } catch (err) {
    console.error('[real-comparaveis] categoria-por-cep error', site, String(err))
    return null
  }
}

/**
 * BUG real encontrado e corrigido — a causa raiz de "0 candidatos aceitos" no caminho do
 * Gemini: as URLs devolvidas em `groundingChunks[].web.uri` NUNCA são o link direto do
 * anúncio — são SEMPRE um link de redirecionamento do próprio Google
 * ("vertexaisearch.cloud.google.com/grounding-api-redirect/...", confirmado via teste real em
 * dezenas de resultados, sem uma única exceção). O filtro de portal conhecido
 * (urlPertenceAPortalConhecido, criado antes pra bloquear esse mesmo domínio quando aparecia
 * como link final de uma amostra) estava rejeitando TODO resultado do Gemini por causa disso,
 * mesmo quando o texto já trazia preço e endereço reais. Resolve o redirecionamento (uma
 * requisição HTTP simples que segue o redirect — `response.url` já vem com o destino final)
 * antes de aplicar qualquer filtro, pra chegar no link de verdade do anúncio.
 */
async function resolverRedirecionamentoGemini(url: string): Promise<string> {
  if (!url.includes('vertexaisearch.cloud.google.com')) return url
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5_000),
    })
    return res.url || url
  } catch {
    return url
  }
}

async function buscarCandidatos(prompt: string, max: number, fetchTimeoutMs: number, bairro: string): Promise<ResultadoBuscaPortal> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { candidatos: [], categorias: [] }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(fetchTimeoutMs),
    })
    if (!res.ok) {
      console.error('[real-comparaveis] search non-OK', res.status, await res.text().catch(() => ''))
      return { candidatos: [], categorias: [] }
    }

    const data = (await res.json()) as {
      candidates?: {
        groundingMetadata?: {
          groundingChunks?: GroundingChunk[]
          groundingSupports?: GroundingSupport[]
        }
      }[]
    }

    const meta = data.candidates?.[0]?.groundingMetadata
    const chunks = meta?.groundingChunks || []
    const supports = meta?.groundingSupports || []
    if (chunks.length === 0 || supports.length === 0) {
      console.error('[real-comparaveis] no grounding results', 'chunks=', chunks.length, 'supports=', supports.length)
      return { candidatos: [], categorias: [] }
    }

    // Resolve todos os links de redirecionamento únicos em paralelo ANTES de filtrar — ver
    // resolverRedirecionamentoGemini acima.
    const urlsBrutas = [...new Set(chunks.map((c) => c.web?.uri).filter((u): u is string => Boolean(u)))]
    const resolvidas = await Promise.all(urlsBrutas.map((u) => resolverRedirecionamentoGemini(u)))
    const mapaResolvido = new Map(urlsBrutas.map((u, i) => [u, resolvidas[i]]))

    const results: CandidatoBruto[] = []
    const categorias: string[] = []
    const seenUrls = new Set<string>()

    for (const support of supports) {
      const text = support.segment?.text || ''
      const chunkIndex = support.groundingChunkIndices?.[0]
      const chunkUrlBruta = chunkIndex !== undefined ? chunks[chunkIndex]?.web?.uri : undefined
      const chunkUrl = chunkUrlBruta ? mapaResolvido.get(chunkUrlBruta) : undefined
      // Assim como no caminho da Brave: o grounding do Gemini às vezes bate numa página de
      // categoria/listagem em vez de um anúncio individual — em vez de só descartar, guarda a
      // URL à parte pra ser buscada direto depois (ver extrairCandidatosDeCategoria).
      if (chunkUrl && ehPaginaDeCategoria(chunkUrl) && !categorias.includes(chunkUrl)) categorias.push(chunkUrl)
      const candidato = extrairCandidato(text, chunkUrl, bairro)
      if (!candidato || seenUrls.has(candidato.url)) continue
      seenUrls.add(candidato.url)
      results.push(candidato)
      if (results.length >= max) break
    }

    console.error('[real-comparaveis] parsed candidates', results.length, 'from', supports.length, 'grounding supports |', categorias.length, 'página(s) de categoria vista(s)')
    return { candidatos: results, categorias }
  } catch (err) {
    console.error('[real-comparaveis] search error', String(err))
    return { candidatos: [], categorias: [] }
  }
}

/** Confirms a listing URL doesn't point at a page that's genuinely gone (404/410 — "página
 * não encontrada") before it's shown as "real" evidence in the laudo, matching a real
 * failure a user found by hand-clicking a link. Real-estate portals commonly run bot
 * defenses (Cloudflare etc.) that 403/429/503 automated fetches even when the page is
 * live for a real browser — confirmed empirically: a link this check accepted still got
 * blocked on an unrelated follow-up automated request. Treating those ambiguous statuses
 * as "dead" would silently throw away good real candidates, which is worse than the
 * occasional stale link slipping through — so only the unambiguous dead signals reject. */
export async function urlEstaViva(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
    })
    return res.status !== 404 && res.status !== 410
  } catch {
    // BUG real encontrado e corrigido: timeout/erro de rede rejeitava o candidato (return
    // false), contradizendo o objetivo declarado desta função de só rejeitar sinal INEQUÍVOCO
    // de link morto (404/410). Confirmado via teste real e testado manualmente fora do Edge
    // Function: os mesmos links do VivaReal marcados "morto" em rodadas diferentes na verdade
    // devolvem 403 do Cloudflare (proteção antibot), não 404 — a página está viva. Um
    // timeout/erro de rede não é evidência de que o anúncio saiu do ar, é só evidência de que
    // a checagem automatizada não conseguiu confirmar (o mesmo tipo de bloqueio antibot que já
    // sabíamos existir pra 403/429/503 explícitos). Manter o candidato (true) é mais seguro do
    // que descartar um anúncio real só porque nossa checagem automatizada foi bloqueada.
    return true
  }
}

/** Monta a string de busca do geocodificador — varia pelo nível de precisão do endereço (ver
 * PrecisaoEndereco). 'exato' já tem rua+número, só precisa de cidade/uf pra desambiguar. Já
 * 'condominio' e 'bairro' são nomes mais genéricos (nome de condomínio pode repetir em outra
 * cidade; o próprio bairro sozinho é ambíguo sem cidade) — inclui o bairro explicitamente pra
 * ajudar o geocodificador a achar o ponto certo. Quando a precisão já É 'bairro', o campo
 * "endereco" do candidato já é literalmente o nome do bairro (ver extrairEnderecoComPrecisao),
 * então não duplica. */
function montarQueryGeocode(candidato: CandidatoBruto, cidade: string, uf: string, bairro: string): string {
  if (candidato.precisaoEndereco === 'exato') return `${candidato.endereco}, ${cidade} - ${uf}`
  if (candidato.precisaoEndereco === 'bairro') return `${bairro}, ${cidade} - ${uf}`
  return `${candidato.endereco}, ${bairro}, ${cidade} - ${uf}`
}

async function geocodarEFiltrar(
  candidatos: CandidatoBruto[],
  origem: Coordenadas,
  raioM: number | null,
  cidade: string,
  uf: string,
  bairro: string,
  prazoMs: number,
): Promise<{ aprovados: ComparavelReal[]; processadosUrls: string[] }> {
  // BUG real encontrado e corrigido: geocodificava TODOS os candidatos novos de uma rodada em
  // paralelo (Promise.all) — a política de uso do Nominatim proíbe explicitamente requisições
  // concorrentes, e isso era tolerável antes porque cada rodada só trazia 1-3 candidatos novos.
  // Depois da busca por portal (round-robin, ver enderecoParaBraveRonda) passar a achar 6-8
  // candidatos novos por rodada, disparar todas as geocodificações ao mesmo tempo derrubava o
  // Nominatim com "429 Too many requests" em cascata — confirmado via teste real: uma rodada
  // com 8 candidatos novos gerou 8 erros 429 seguidos, descartando candidatos reais só porque a
  // checagem de endereço não conseguiu completar. Agora a geocodificação roda em SÉRIE, uma de
  // cada vez com um pequeno intervalo — mais lento, mas o usuário pediu explicitamente pra
  // aceitar demorar mais em troca de achar as amostras de verdade.
  //
  // BUG real encontrado e corrigido: esta etapa também chamava urlEstaViva() aqui pra rejeitar
  // link morto ANTES do candidato virar amostra. Testado manualmente fora do Edge Function: os
  // mesmos anúncios do VivaReal (e alguns da Attria) rejeitados repetidamente como "link morto"
  // em testes diferentes na verdade voltam com um bloqueio antibot (Cloudflare) quando checados
  // a partir do ambiente da Vercel — não são anúncios removidos de verdade. Como não dá pra
  // distinguir com confiança "bloqueio disfarçado" de "removido de verdade" nesta etapa,
  // verificar o link aqui só descartava anúncios reais em massa sem ganho real de segurança. A
  // checagem de link continua existindo, mas só na passada final (api/analyze-confirm.ts,
  // right before delivery) — um único ponto de verificação, mais perto da entrega, em vez de
  // dois pontos igualmente sujeitos ao mesmo bloqueio.
  const NOMINATIM_INTERVALO_MS = 350
  const resultados: (ComparavelReal | null)[] = []
  const processadosUrls: string[] = []
  // BUG real encontrado e corrigido: a correção da janela de extração de categoria (ver
  // extrairCandidatosDeCategoria) passou a achar MUITO mais candidatos brutos por rodada (até
  // 23 de 30 num teste real, contra 1 de 30 antes) — mas cada candidato geocodificado em SÉRIE
  // custa ~350ms de intervalo + o tempo real do Nominatim (~300-800ms), então 20-30 candidatos
  // novos numa única rodada podem sozinhos consumir 15-25s. Como buscarComparaveisReais tem um
  // `withTimeout` externo que, ao estourar o orçamento total, descarta TUDO (não devolve
  // parcial), geocodificar mais candidatos do que cabe no tempo restante corria o risco de
  // travar a função até o timeout externo — trocando "poucas amostras" por "ZERO amostras",
  // uma regressão pior que o bug original. Este laço agora para de geocodificar assim que o
  // prazo (compartilhado com o orçamento total da chamada) se esgota, devolvendo o que já foi
  // verificado — os candidatos restantes ficam pra próxima rodada (ou são perdidos de forma
  // graciosa se o orçamento total realmente acabou), nunca travando a função inteira.
  for (const candidato of candidatos) {
    if (Date.now() >= prazoMs) {
      console.error('[real-comparaveis] geocodificação interrompida por prazo —', candidatos.length - resultados.length, 'candidato(s) não verificado(s) nesta rodada')
      break
    }
    // A cidade/UF (e o bairro, quando a precisão não é 'exato' — ver montarQueryGeocode) são
    // anexados aqui (o endereço do candidato sozinho não os tem, ao contrário do endereço do
    // imóvel avaliando) — sem isso, nomes de rua/condomínio comuns podem geocodificar para a
    // cidade errada, ou simplesmente não resolver.
    processadosUrls.push(candidato.url)
    const coords = await geocodeEndereco(montarQueryGeocode(candidato, cidade, uf, bairro))
    if (!coords) {
      console.error('[real-comparaveis] candidato descartado (geocode falhou):', candidato.endereco)
      resultados.push(null)
    } else {
      const distanciaM = haversineMeters(origem, coords)
      // O filtro de raio não se aplica ao nível 'bairro' — a distância aí é até o CENTRO do
      // bairro (geocodificado por falta de rua/condomínio identificável no anúncio), não até o
      // imóvel de verdade, então pode por acaso computar além do raio mesmo sendo
      // comprovadamente do mesmo bairro do avaliando (ex.: avaliando numa ponta do bairro,
      // centroide do bairro na outra). O próprio fato de já estarmos pesquisando ESSE bairro
      // específico (é ele que geramos a query com) já é o critério de proximidade pra este
      // nível — descartar por raio aqui rejeitaria candidatos reais e válidos por um artefato
      // de cálculo, não por estarem genuinamente longe.
      if (raioM !== null && distanciaM > raioM && candidato.precisaoEndereco !== 'bairro') {
        console.error('[real-comparaveis] candidato descartado (fora do raio):', candidato.endereco, '-', Math.round(distanciaM), 'm')
        resultados.push(null)
      } else {
        resultados.push({ ...candidato, distanciaM } as ComparavelReal)
      }
    }
    if (candidato !== candidatos[candidatos.length - 1]) await sleep(NOMINATIM_INTERVALO_MS)
  }
  // Mais próximos primeiro — preferência por proximidade mesmo quando o raio permite até 500m.
  const aprovados = resultados.filter((c): c is ComparavelReal => c !== null).sort((a, b) => (a.distanciaM ?? 0) - (b.distanciaM ?? 0))
  // Devolve também QUAIS urls chegaram a ser processadas (aprovadas ou não) — distinto de
  // "todos os candidatos recebidos", já que o corte por prazo acima pode ter deixado alguns de
  // fora sem sequer tentar. O chamador (verificarNovos) usa isso pra só marcar como
  // "verificado/rejeitado" quem de fato passou pela checagem — os que ficaram de fora por falta
  // de tempo continuam elegíveis pra tentativa numa rodada seguinte, em vez de serem tratados
  // como rejeitados permanentemente.
  return { aprovados, processadosUrls }
}

/**
 * Best-effort real-world comparable search: Gemini's Google Search grounding finds
 * candidate listings (free-text, since grounding and structured `responseSchema`
 * output cannot be combined in the same Gemini call — confirmed via a 400
 * INVALID_ARGUMENT response when both are set), then each candidate address is
 * geocoded (Nominatim) and filtered to a real, computed radius around the subject
 * property — a hard cap, not just a search hint, so a real result that merely
 * "sounds close" but geocodes further away is rejected rather than kept. Results
 * are sorted closest-first so callers naturally prefer the nearest real matches.
 * Each candidate's URL is also verified to actually resolve (see urlEstaViva) before
 * being kept — listings expire constantly, and a dead "real" link is worse than none.
 * Any failure at any step (no API key, network issue, no results, geocoding
 * failure, dead link) degrades gracefully to an empty list — the caller (analyze.ts)
 * is instructed to NEVER invent fictitious samples to make up the difference; if too
 * few real ones are found, the evaluation is flagged as having insufficient data
 * instead of fabricating comparables.
 */
// Lista fechada pedida explicitamente pelo usuário ("buscando exclusivamente nestes sites") —
// não inclui QuintoAndar/OLX (que estavam aqui antes) porque o pedido restringiu a exatamente
// estes 5 portais.
const PORTAIS = ['imovelweb.com.br', 'attria.com.br', 'chavesnamao.com.br', 'vivareal.com.br', 'zapimoveis.com.br']

function montarPrompt(site: string | null, max: number, tipoImovel: string, enderecoCompleto: string): string {
  const escopo = site
    ? `Busque especificamente em site:${site}.`
    : `Busque especificamente nestes sites, nesta ordem de prioridade: ${PORTAIS.map((p) => `site:${p}`).join(', ')} — e também em imobiliárias locais da região se os anteriores não trouxerem resultado.`
  return `Busque na internet até ${max} ANÚNCIOS de imóveis do tipo "${tipoImovel}" À VENDA (unidades específicas, com preço, não páginas institucionais de condomínio/empreendimento) o mais próximo possível do endereço "${enderecoCompleto}". Priorize fortemente a MESMA rua/avenida e o MESMO prédio/condomínio (mesmo nome de condomínio ou mesmo número do endereço) — é comum haver várias unidades à venda no mesmo empreendimento. Se não houver opções suficientes na mesma rua, aceite imóveis em ruas vizinhas dentro de um raio de até 1000 metros do endereço informado, sempre preferindo os mais próximos. NÃO traga imóveis fora desse raio de 1000 metros.

IMPORTANTE — SOMENTE VENDA: busque APENAS imóveis À VENDA. NUNCA traga imóveis para ALUGUEL/LOCAÇÃO — se um anúncio mencionar "aluguel", "locação", "alugar" ou valor mensal de locação, IGNORE-O completamente, mesmo que o restante pareça relevante.

${escopo}

Para cada anúncio encontrado, escreva uma linha própria com o endereço EXATO (rua e número, e nome do condomínio/prédio quando houver), o PREÇO DE VENDA em R$ e a área em m². O preço é obrigatório — se uma página não tiver um preço de venda claro de uma unidade específica, não a inclua. Seja direto, sem introdução.`
}

/** O mecanismo de busca programável (Custom Search Engine) já está configurado, no painel do
 * Google, pra restringir a busca aos portais imobiliários — não precisa repetir "site:" aqui.
 * A consulta só precisa do endereço e do tipo de imóvel; o Google cuida do resto. */
// "-aluguel -alugar" exclui resultados de locação — confirmado via teste real que sem isso a
// busca trazia anúncios de ALUGUEL junto com os de venda (ex.: "sala comercial ... aluguel
// R$70.200"), que nunca servem de amostra pro método comparativo direto de VALOR DE VENDA.
const SUFIXO_QUERY = '-aluguel -alugar'

/** Extrai "rua + número" do endereço completo montado pelo chamador (formato
 * "Rua X, número, Bairro, Cidade - UF") no formato "Rua X, número" — usado como referência pra
 * preencher o endereço de um candidato de categoria que não menciona a própria rua (ver
 * `ruaReferencia` em extrairCandidatosDeCategoria).
 *
 * BUG real encontrado e corrigido: esta função unia rua e número com um simples ESPAÇO (ex.
 * "Avenida X 2245"), não vírgula. Quando esse texto é prepended a uma descrição sem vírgula
 * nenhuma logo depois (comum: descrições de anúncio como "Apartamento à venda –..."),
 * ENDERECO_BASE_RE (que só para de capturar a "rua" num desses caracteres: vírgula, quebra de
 * linha, etc.) engolia o número JUNTO do resto do texto seguinte inteiro como se fosse tudo
 * nome de rua — ex.: "endereco" saía como "Henrique Gonçalves Baptista 2245 Apartamento à
 * venda –", sem o número separado em campo próprio. Confirmado via log real de produção: TODOS
 * os candidatos vindos do JSON-LD do imovelweb.com.br falhavam a geocodificação por causa
 * exatamente disso (Nominatim não reconhece esse texto como endereço válido). Unir com vírgula
 * faz ENDERECO_BASE_RE parar exatamente depois do nome da rua, deixando NUMERO_PROXIMO_RE
 * capturar o número corretamente como campo separado, do jeito que extrairEndereco espera. */
function ruaDoEnderecoCompleto(enderecoCompleto: string): string {
  const partes = enderecoCompleto.split(',')
  return partes
    .slice(0, 2)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ')
}

/** Segmento de URL que cada portal usa pra uma página de ANÚNCIO INDIVIDUAL (não uma página de
 * categoria/bairro tipo "201 Casas à venda em..."). Descoberto testando a Brave Search API
 * diretamente: sem esse segmento na consulta, a Brave devolvia quase só páginas de categoria
 * (que o filtro `extrairCandidato` já rejeita corretamente, por não terem preço de UMA
 * unidade) — incluir o trecho de URL do anúncio individual como termo de busca muda o
 * resultado inteiro pra anúncios reais, com preço e endereço exato. Confirmado manualmente
 * pra cada portal antes de codificar aqui — não é um operador "inurl:" (a Brave não documenta
 * um), é só texto normal que casa melhor com o conteúdo/URL das páginas de anúncio. */
const CAMINHO_ANUNCIO_POR_PORTAL: Record<string, string> = {
  'imovelweb.com.br': '/propriedades',
  'attria.com.br': '/imovel',
  'chavesnamao.com.br': '/imovel',
  'vivareal.com.br': '/imovel',
  'zapimoveis.com.br': '/imovel',
}

const HTML_CATEGORIA_TIMEOUT_MS = 6_000
const MAX_CANDIDATOS_POR_CATEGORIA = 40

interface ListingJsonLd {
  url: string
  description: string
}

/**
 * BUG real encontrado e corrigido — causa raiz de "quase nenhum candidato" ao buscar direto
 * uma página de categoria real (confirmado via teste manual contra
 * imovelweb.com.br/imoveis-venda-jardim-belval-barueri.html, buscada exatamente como o usuário
 * mostrou em captura de tela): o HTML puro devolvido por um fetch simples NÃO tem preço nem
 * área em lugar nenhum perto do link de cada anúncio — o card visual da listagem só é montado
 * depois, via JavaScript, no navegador. `extrairCandidatosDeCategoria` (abaixo) dependia só
 * dessa janela de texto ao redor do link — sem preço ali, TODO candidato via href era
 * descartado (preço é obrigatório em extrairCandidato).
 *
 * O preço e a área REALMENTE existem no HTML estático, só que em outro lugar da página: um
 * bloco <script type="application/ld+json"> com dado estruturado schema.org
 * ("RealEstateListing"), publicado pelo próprio portal para rich snippets do Google. Cada item
 * já vem com a "url" direta e definitiva do anúncio (sem precisar resolver redirecionamento) e
 * uma "description" em texto livre que geralmente cita o preço e a área (ver AREA_RE/PRECO_RE
 * acima pelas tolerâncias de formatação encontradas nesse texto). Varre TODOS os blocos
 * ld+json da página em busca de QUALQUER array cujos itens sejam do tipo "RealEstateListing" —
 * não fixa um nome de chave específico (ex. "mainEntity") porque cada portal pode nomear
 * diferente.
 */
function extrairListingsJsonLd(html: string): ListingJsonLd[] {
  const listings: ListingJsonLd[] = []
  const scriptRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let scriptMatch: RegExpExecArray | null
  while ((scriptMatch = scriptRe.exec(html)) !== null) {
    let data: unknown
    try {
      data = JSON.parse(scriptMatch[1].trim())
    } catch {
      continue
    }
    if (!data || typeof data !== 'object') continue
    for (const valor of Object.values(data as Record<string, unknown>)) {
      if (!Array.isArray(valor)) continue
      for (const item of valor) {
        if (!item || typeof item !== 'object') continue
        const obj = item as Record<string, unknown>
        const tipo = obj.type ?? obj['@type']
        if (tipo !== 'RealEstateListing') continue
        const url = typeof obj.url === 'string' ? obj.url : null
        const description =
          typeof obj.description === 'string' ? obj.description : typeof obj.name === 'string' ? obj.name : ''
        if (url) listings.push({ url, description })
      }
    }
  }
  return listings
}

/**
 * Pedido explícito do usuário: em vez de só descartar uma página de categoria/listagem (ex.
 * "chavesnamao.com.br/apartamentos-a-venda/sp-barueri/bairros/avenida-.../") por não ser o
 * anúncio de uma unidade, busca essa página DIRETO (ela já existe — foi encontrada numa busca
 * real) e extrai os anúncios individuais que ela lista. Uma página dessas costuma agregar
 * DEZENAS de unidades reais de uma vez — muito mais do que a Brave/Gemini conseguem indexar
 * individualmente. Pra cada link de anúncio individual encontrado no HTML, usa o texto ao
 * redor do link (onde o preço/área do card geralmente aparece nas listagens) com as MESMAS
 * regras de qualidade do resto do pipeline (extrairCandidato) — nunca aceita um candidato sem
 * preço real extraído do próprio texto.
 */
async function extrairCandidatosDeCategoria(urlCategoria: string, site: string, ruaReferencia: string, bairro: string): Promise<CandidatoBruto[]> {
  const caminhoAnuncio = CAMINHO_ANUNCIO_POR_PORTAL[site]
  if (!caminhoAnuncio) return []
  try {
    const res = await fetch(urlCategoria, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(HTML_CATEGORIA_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[real-comparaveis] categoria non-OK', urlCategoria, res.status)
      return []
    }
    const html = await res.text()
    const candidatos: CandidatoBruto[] = []
    const vistos = new Set<string>()

    // 1ª fonte, PRIORITÁRIA: dado estruturado JSON-LD (ver extrairListingsJsonLd) — url direta
    // e definitiva do anúncio + descrição que quase sempre já traz preço/área, presente no HTML
    // estático independente de o card visual da listagem ser montado via JavaScript.
    for (const { url, description } of extrairListingsJsonLd(html)) {
      if (candidatos.length >= MAX_CANDIDATOS_POR_CATEGORIA) break
      if (vistos.has(url)) continue
      vistos.add(url)
      let texto = description
      if (!ENDERECO_BASE_RE.test(texto)) texto = `${ruaReferencia} ${texto}`
      const candidato = extrairCandidato(texto, url, bairro)
      if (candidato) candidatos.push(candidato)
    }
    console.error('[real-comparaveis] categoria', urlCategoria, ': JSON-LD deu', candidatos.length, 'candidato(s)')

    // 2ª fonte, FALLBACK: janela de texto ao redor de cada href de anúncio individual — cobre
    // portais sem (ou com) JSON-LD incompleto. Caminho de anúncio tem caracteres especiais de
    // regex (ex. "/imovel") — escapa antes de montar o padrão. Exige um dígito em algum lugar do
    // link (mesmo critério de sempre pra distinguir anúncio de unidade de outra coisa).
    const escapado = caminhoAnuncio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hrefRe = new RegExp(`href="([^"]*${escapado}[^"]*\\d[^"]*)"`, 'gi')
    let match: RegExpExecArray | null
    while ((match = hrefRe.exec(html)) !== null && candidatos.length < MAX_CANDIDATOS_POR_CATEGORIA) {
      let url = match[1].replace(/&amp;/g, '&')
      if (url.startsWith('/')) url = `https://${site}${url}`
      if (!url.startsWith('http') || vistos.has(url)) continue
      vistos.add(url)
      // Janela de texto ao redor do link — o "card" do anúncio na listagem costuma ter
      // preço/área pertinho do link no HTML (antes ou depois, varia por portal). BUG real
      // encontrado e corrigido: testado manualmente contra uma página de categoria real do
      // imovelweb.com.br — o preço ("R$ 630.000") fica no TOPO do card, dentro do elemento
      // "data-to-posting" que abre o card inteiro, enquanto o "href=" de fato (que
      // extrairCandidatosDeCategoria usa pra achar o link) só aparece ~1300 caracteres depois,
      // mais pro fim do mesmo card — uma janela de -300 nunca alcançava o preço, rejeitando o
      // candidato quase sempre (confirmado: só 1 de 30 candidatos reais aceito com -300/+800).
      // Alargar a janela pra trás resolve: -2000/+800 aceitou 23 de 30 candidatos reais nesse
      // mesmo teste, sem custo — o filtro de preço/endereço já rejeita qualquer ruído extra que
      // a janela maior capturar do card vizinho.
      const inicio = Math.max(0, match.index - 2_000)
      const fim = Math.min(html.length, match.index + match[0].length + 800)
      let janela = removerHtml(html.slice(inicio, fim))
      // BUG real encontrado e corrigido: testado manualmente contra uma página de categoria
      // real — só ~40% dos cards repetem o nome da rua no texto (o resto só diz "bairro,
      // cidade"), então a maioria era descartada por falta de endereço reconhecível. Como a
      // página INTEIRA já é filtrada por essa rua (é a rua que usamos pra encontrá-la), usa a
      // rua de referência como fallback só quando o texto do card não menciona nenhuma —
      // nunca sobrescreve uma rua que o card já mencionou explicitamente.
      if (!ENDERECO_BASE_RE.test(janela)) janela = `${ruaReferencia} ${janela}`
      const candidato = extrairCandidato(janela, url, bairro)
      if (candidato) candidatos.push(candidato)
    }
    console.error('[real-comparaveis] categoria', urlCategoria, ': total', candidatos.length, 'candidatos do HTML (JSON-LD + href)')
    return candidatos
  } catch (err) {
    console.error('[real-comparaveis] categoria error', urlCategoria, String(err))
    return []
  }
}

// Piso mínimo do NEGÓCIO (mais rígido que o piso técnico da norma, que tecnicamente aceita
// Grau I com só 3 — ver classificarItemQuantidade em nbr-recompute.ts). Subiu de 5 pra 6 e
// depois pra 10 a pedido explícito do usuário — bem acima do Grau II da NBR (5+). Usado como
// piso nos caminhos de orçamento apertado (fallback em analyze.ts/avm.ts) e como alvo mínimo
// da passada dedicada de busca (find-amostras.ts).
const ALVO_MINIMO_AMOSTRAS = 10
// Quando há orçamento de tempo generoso (a passada dedicada em find-amostras.ts), mirar só no
// mínimo deixa pouca margem: páginas institucionais filtradas depois, ou um anúncio que sai do
// ar entre a busca e a entrega do laudo, derrubam o total pra baixo de 5 de novo. Buscar mais
// do que o necessário agora dá uma folga real contra isso — o usuário pediu explicitamente
// pra buscar até 20 (Brave + Gemini rodando juntos, deduplicados) quando houver
// disponibilidade/qualidade/relevância suficientes, mesmo que demore vários minutos no total.
const ALVO_DESEJADO_AMOSTRAS = 20
// Subiu de 10 pra 20 a pedido do usuário ("mais páginas") — desde que a geocodificação passou
// a rodar em série (ver geocodarEFiltrar), cada rodada individual ficou mais lenta, então o
// orçamento de tempo (não mais este teto) é o fator limitante de quantas rodadas cabem numa
// única invocação — mas com várias chamadas encadeadas (ver MAX_CHAMADAS_BUSCA no front-end),
// o total de rodadas possíveis ao longo de toda a busca precisa desse teto mais alto.
const MAX_RODADAS = 20

async function buscarComparaveisReaisSemLimite(params: BuscarParams, budgetMs: number): Promise<ResultadoBusca> {
  // Nominatim's usage policy discourages concurrent requests — firing off geocode/URL-check
  // calls for too many candidates at once adds real tail latency (and risks throttling),
  // which matters a lot under a tight time budget. Callers with a generous dedicated budget
  // (find-amostras.ts) ask for more; callers squeezed inside a bigger request ask for fewer.
  const { enderecoCompleto, cidade, uf, bairro, cep, tipoImovel, numeroAvaliando, max = budgetMs >= 10_000 ? 12 : 6, offsetBase = 0 } = params
  // "Bate o número exato do avaliando" vira a chave de ordenação primária (ver comparador
  // abaixo) — pedido explícito do usuário: "se houver um imóvel no endereço exato, priorize
  // esse resultado", mesmo que ruído de geocodificação faça outro candidato parecer levemente
  // mais perto em linha reta.
  function bateNumeroExato(endereco: string): boolean {
    return Boolean(numeroAvaliando && numeroDoEndereco(endereco) === numeroAvaliando.trim())
  }
  function ordenarPorPrioridade(comparaveis: ComparavelReal[]): ComparavelReal[] {
    return [...comparaveis].sort((a, b) => {
      const prioridadeA = bateNumeroExato(a.endereco) ? 0 : 1
      const prioridadeB = bateNumeroExato(b.endereco) ? 0 : 1
      if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB
      return (a.distanciaM ?? 0) - (b.distanciaM ?? 0)
    })
  }
  if (!cidade || !uf) return { comparaveis: [], origem: null, proximoOffsetBase: offsetBase }

  // Fonte de busca real ÚNICA: Gemini (google_search grounding) — dispara uma busca POR PORTAL
  // em paralelo a cada rodada (ver buscarPorPortais abaixo). Brave e Google Custom Search
  // foram removidos do pipeline (ver comentário acima de buscarCandidatos).
  const geminiConfigurado = Boolean(process.env.GEMINI_API_KEY)

  // A single combined "search these 5 sites" prompt turns out to make Google's grounding
  // issue just one or two actual queries internally, not five — confirmed empirically via
  // a real address the user showed has 50+ live listings across multiple portals, where
  // the combined-prompt search kept returning only 1-3 candidates total. Com orçamento de
  // tempo generoso (find-amostras.ts), disparamos uma busca POR PORTAL em paralelo em vez de
  // uma consulta combinada — mesmo custo de tempo (correm ao mesmo tempo), recall bem melhor.
  const buscarPorPortais = geminiConfigurado && budgetMs >= 10_000
  const maxPorPortal = Math.max(2, Math.ceil(max / PORTAIS.length))
  const startedAt = Date.now()
  // Prazo absoluto (timestamp, não duração) compartilhado por TODAS as geocodificações desta
  // chamada — reserva uma margem antes do fim do orçamento total pra sobrar tempo real de
  // serialização/resposta. Existe porque `buscarComparaveisReais` (o wrapper externo) corta a
  // chamada inteira no orçamento total e descarta QUALQUER progresso se isso acontecer (ver
  // `withTimeout`) — sem geocodarEFiltrar respeitar esse mesmo prazo internamente, uma rodada
  // com muitos candidatos novos (algo que passou a ser comum depois da correção da janela de
  // extração de categoria) podia sozinha ultrapassar o orçamento total e perder TUDO que já
  // tinha sido achado, não só os candidatos daquela rodada.
  // A margem precisa ser MAIOR que o timeout de uma única chamada de geocodificação (5s, ver
  // geocode.ts) — o corte de prazo em geocodarEFiltrar só é checado ENTRE candidatos, nunca
  // interrompe uma chamada já em voo. Se essa única chamada em voo demorar o máximo (5s) e
  // tivesse começado bem em cima do prazo, uma margem menor que isso deixaria o tempo total
  // real estourar `budgetMs` mesmo assim, arriscando cair de volta no `withTimeout` externo
  // (que aí sim descarta tudo). 6s cobre o pior caso (5s de timeout + folga).
  const RESERVA_FINAL_MS = 6_000
  const prazoGlobalMs = startedAt + budgetMs - RESERVA_FINAL_MS

  // Páginas de categoria já vistas em rodadas anteriores nunca são buscadas de novo (o
  // conteúdo não muda de uma rodada pra outra dentro da mesma avaliação). Teto subiu de 2 pra
  // 5 — a 1ª rodada agora descobre deliberadamente até 1 página de catálogo por portal (ver
  // buscarPaginaCategoriaPorCep), então precisa de espaço pra buscar as 5 de uma vez.
  const categoriasJaBuscadas = new Set<string>()
  const MAX_CATEGORIAS_POR_RODADA = 5

  /** Busca as páginas de categoria vistas nesta rodada (até um teto por rodada, já que cada
   * fetch é uma requisição HTTP a mais) e devolve os candidatos extraídos delas. Ver
   * extrairCandidatosDeCategoria — cada página dessas costuma render dezenas de anúncios reais
   * de uma vez, muito mais do que o grounding consegue achar individualmente. */
  async function buscarDeCategoriasNovas(categoriasPorPortal: { site: string; categorias: string[] }[]): Promise<CandidatoBruto[]> {
    const alvos: { url: string; site: string }[] = []
    for (const { site, categorias } of categoriasPorPortal) {
      for (const url of categorias) {
        if (categoriasJaBuscadas.has(url) || alvos.length >= MAX_CATEGORIAS_POR_RODADA) continue
        categoriasJaBuscadas.add(url)
        alvos.push({ url, site })
      }
    }
    if (alvos.length === 0) return []
    const rua = ruaDoEnderecoCompleto(enderecoCompleto)
    const resultados = await Promise.all(alvos.map(({ url, site }) => extrairCandidatosDeCategoria(url, site, rua, bairro)))
    return resultados.flat()
  }

  // A descoberta de página de catálogo por CEP só roda na 1ª rodada de cada chamada — a
  // página de catálogo de um CEP é essencialmente estática, repetir a busca por ela a cada
  // rodada só gastaria mais chamadas ao Gemini sem achar nada novo (o cache
  // `categoriasJaBuscadas` já evita rebuscar a MESMA URL, mas evita também a chamada de
  // descoberta em si).
  let descobertaPorCepFeita = false

  async function umaRodada(_rodadaIndex: number, fetchTimeoutMs: number): Promise<CandidatoBruto[]> {
    if (buscarPorPortais) {
      const [porPortal, categoriasPorCep] = await Promise.all([
        Promise.all(
          PORTAIS.map(async (site) => {
            const { candidatos, categorias } = await buscarCandidatos(
              montarPrompt(site, maxPorPortal, tipoImovel, enderecoCompleto),
              maxPorPortal,
              fetchTimeoutMs,
              bairro,
            )
            return { site, candidatos, categorias }
          }),
        ),
        !descobertaPorCepFeita && cep
          ? Promise.all(
              PORTAIS.map(async (site) => ({
                site,
                categorias: [await buscarPaginaCategoriaPorCep(site, cep, bairro, cidade, uf, tipoImovel, fetchTimeoutMs)].filter(
                  (u): u is string => Boolean(u),
                ),
              })),
            )
          : Promise.resolve([]),
      ])
      descobertaPorCepFeita = true
      const daCategoria = await buscarDeCategoriasNovas([
        ...porPortal.map(({ site, categorias }) => ({ site, categorias })),
        ...categoriasPorCep,
      ])
      return [...porPortal.flatMap((p) => p.candidatos), ...daCategoria]
    }
    if (geminiConfigurado) {
      const { candidatos } = await buscarCandidatos(montarPrompt(null, max, tipoImovel, enderecoCompleto), max, fetchTimeoutMs, bairro)
      return candidatos
    }
    return []
  }

  // Com retry via Gemini habilitado (buscarPorPortais), o teto por rodada precisa ser menor
  // que o orçamento total pra caber várias rodadas. Sem orçamento generoso (fallback apertado
  // em analyze.ts/avm.ts), só há UMA rodada, então ela pode usar quase todo o orçamento
  // disponível.
  const fetchTimeoutMs = buscarPorPortais ? 7_000 : Math.max(2_000, Math.min(budgetMs - 2_000, 18_000))
  const [origem, primeiraRodada] = await Promise.all([
    params.origemCoords ? Promise.resolve(params.origemCoords) : geocodeEndereco(enderecoCompleto),
    umaRodada(1, fetchTimeoutMs),
  ])

  // BUG real encontrado e corrigido: a versão anterior re-rodava um filtro "dedupe" sobre TODA
  // a lista acumulada a cada rodada, usando o mesmo Set `vistos` já populado pelas rodadas
  // anteriores — como os candidatos já acumulados já estavam em `vistos` (adicionados na
  // rodada anterior), eles eram descartados como "duplicados" da PRÓPRIA lista acumulada,
  // apagando tudo que as rodadas anteriores tinham achado. Confirmado via teste real: o total
  // acumulado voltava pra 0 sempre que uma rodada não trazia candidato novo. `adicionarNovos`
  // só ADICIONA ao array (nunca filtra o que já estava lá).
  const vistos = new Set<string>()
  function adicionarNovos(acumulado: CandidatoBruto[], novos: CandidatoBruto[]): CandidatoBruto[] {
    const novosUnicos = novos.filter((c) => !vistos.has(c.url))
    for (const c of novosUnicos) vistos.add(c.url)
    return [...acumulado, ...novosUnicos]
  }
  let candidatosAcumulados = adicionarNovos([], primeiraRodada)

  if (!origem) {
    // Can't compute a real distance without geocoding the subject address. A checagem de link
    // não roda mais aqui (ver o mesmo motivo documentado em geocodarEFiltrar) — a checagem
    // final antes da entrega (api/analyze-confirm.ts) continua sendo a rede de segurança.
    const candidatosLocais = filtrarOutliersDePreco(candidatosAcumulados)
    const comparaveis = deduplicarPorImovelFisico(
      ordenarPorPrioridade(candidatosLocais.map((c) => ({ ...c, distanciaM: null }))),
    )
    // Só a 1ª rodada rodou até aqui (geocodificação do avaliando falhou antes de qualquer
    // retry) — `rodada` ainda não existe neste ponto do escopo, então o próximo offset livre
    // é sempre offsetBase + 1.
    return { comparaveis, origem: null, proximoOffsetBase: offsetBase + 1 }
  }

  // 2º BUG real encontrado e corrigido: a cada rodada de retry, `geocodarEFiltrar` reprocessava
  // a lista acumulada INTEIRA do zero — geocodificando e checando o link dos MESMOS candidatos
  // repetidas vezes (até 10x, uma por rodada, mesmo pra candidatos já verificados nas rodadas
  // anteriores). Confirmado via teste real: isso multiplicou as chamadas ao serviço de
  // geocodificação e às páginas de anúncios reais o suficiente pra gerar bloqueio de uso
  // excessivo (Nominatim) e checagens de link falhando por excesso de requisições repetidas ao
  // mesmo site num curto intervalo (comportamento típico de defesa antibot). Este cache guarda
  // o resultado de cada URL já verificada — só candidatos genuinamente NOVOS de cada rodada são
  // geocodificados/checados de novo.
  const origemConfirmada: Coordenadas = origem
  const verificados = new Map<string, ComparavelReal | null>()
  async function verificarNovos(candidatos: CandidatoBruto[]): Promise<void> {
    // Geocodificação/checagem de link (rede) só roda pra candidatos genuinamente novos — nunca
    // reprocessa quem já está em cache. O filtro de outlier por preço é aplicado separadamente,
    // em finaisAtuais(), porque é pura computação (sem rede) e se beneficia de ver a lista
    // acumulada inteira pra calcular uma mediana melhor — pode rodar de novo à vontade.
    const aVerificar = candidatos.filter((c) => !verificados.has(c.url))
    if (aVerificar.length === 0) return
    const { aprovados, processadosUrls } = await geocodarEFiltrar(
      aVerificar,
      origemConfirmada,
      raioParaTipoImovel(tipoImovel),
      cidade,
      uf,
      bairro,
      prazoGlobalMs,
    )
    const aprovadosPorUrl = new Map(aprovados.map((c) => [c.url, c]))
    // Só marca como "verificado" (aprovado OU rejeitado) quem de fato foi processado — um
    // candidato deixado de fora pelo corte de prazo em geocodarEFiltrar NÃO entra aqui, então
    // continua elegível pra ser tentado de novo numa rodada seguinte, em vez de ser tratado
    // como rejeitado permanentemente só por falta de tempo nesta rodada.
    const processadosSet = new Set(processadosUrls)
    for (const c of aVerificar) {
      if (processadosSet.has(c.url)) verificados.set(c.url, aprovadosPorUrl.get(c.url) ?? null)
    }
  }
  function finaisAtuais(): ComparavelReal[] {
    const semOutliersUrls = new Set(filtrarOutliersDePreco(candidatosAcumulados).map((c) => c.url))
    const validos = candidatosAcumulados
      .filter((c) => semOutliersUrls.has(c.url))
      .map((c) => verificados.get(c.url))
      .filter((c): c is ComparavelReal => Boolean(c))
    // Ordena (endereço exato primeiro, depois mais próximo) ANTES de deduplicar, pra que a
    // versão mantida de um imóvel cross-postado seja sempre a de maior prioridade entre as
    // duplicatas (ver candidatoMaisCompleto, que só desempata por completude/distância).
    return deduplicarPorImovelFisico(ordenarPorPrioridade(validos))
  }

  await verificarNovos(candidatosAcumulados)
  let finais = finaisAtuais()
  console.error('[real-comparaveis] rodada 1: final', finais.length, 'de', candidatosAcumulados.length, 'candidatos')

  // Achar poucas amostras reais não é motivo pra desistir — se ainda sobra orçamento de tempo
  // real, tenta de novo. Com Google CSE, cada rodada pede a PRÓXIMA PÁGINA de resultados
  // (a mesma consulta sempre retorna os mesmos 10 primeiros — pedir de novo não ajudaria).
  // Com o fallback via Gemini, buscas repetidas na mesma consulta de grounding costumam trazer
  // resultados diferentes a cada chamada (confirmado via teste real — variou de 1 a 9
  // candidatos entre tentativas separadas), então repetir genuinamente ajuda ali.
  // Estimativa realista de quanto uma rodada normalmente leva (não o teto de abort de
  // `fetchTimeoutMs`, que é só a rede de segurança para uma chamada travada). Subiu de 3s pra
  // 8s no caminho com API de busca dedicada porque a geocodificação agora roda em série (ver
  // geocodarEFiltrar) — uma rodada que acha vários candidatos novos pode legitimamente levar
  // vários segundos só verificando endereço/link, um por vez. Estimar baixo demais arriscava
  // começar uma rodada nova sem sobrar tempo real pra terminar a verificação, o que faz o
  // orçamento total (budgetMs) estourar e o `withTimeout` de fora descartar TUDO que já tinha
  // sido achado — pior do que simplesmente não tentar mais uma rodada.
  // Caminho "buscarPorPortais" (Gemini, 5 buscas em paralelo por rodada + até 2 páginas de
  // categoria buscadas direto) é o mais pesado — estimativa bem mais generosa, tanto pela
  // chamada de IA em si quanto pela geocodificação em série de potencialmente muitos
  // candidatos novos de uma vez (ver geocodarEFiltrar).
  const RODADA_ESTIMADA_MS = buscarPorPortais ? 16_000 : 9_000
  const podeTentarDeNovo = geminiConfigurado
  // Com orçamento de tempo generoso (find-amostras.ts), mira mais alto que o mínimo técnico —
  // ver ALVO_DESEJADO_AMOSTRAS acima. Nos caminhos de orçamento apertado, o mínimo já é o alvo.
  const alvo = budgetMs >= 10_000 ? ALVO_DESEJADO_AMOSTRAS : ALVO_MINIMO_AMOSTRAS
  let rodada = 1
  while (podeTentarDeNovo && finais.length < alvo && rodada < MAX_RODADAS) {
    const decorrido = Date.now() - startedAt
    const restante = budgetMs - decorrido
    if (restante < RODADA_ESTIMADA_MS) break // não sobra tempo real pra outra rodada completa
    rodada++
    console.error('[real-comparaveis] só', finais.length, 'amostra(s) — tentando rodada', rodada, 'de busca (', restante, 'ms restantes)')
    const novaRodada = await umaRodada(rodada, fetchTimeoutMs)
    candidatosAcumulados = adicionarNovos(candidatosAcumulados, novaRodada)
    await verificarNovos(candidatosAcumulados)
    finais = finaisAtuais()
    console.error('[real-comparaveis] rodada', rodada, ': final', finais.length, 'de', candidatosAcumulados.length, 'candidatos acumulados')
  }

  console.error('[real-comparaveis] resultado final após', rodada, 'rodada(s):', finais.length, 'amostras reais')
  return { comparaveis: finais, origem, proximoOffsetBase: offsetBase + rodada }
}

export async function buscarComparaveisReais(params: BuscarParams): Promise<ResultadoBusca> {
  const budgetMs = params.budgetMs ?? OVERALL_BUDGET_MS
  return withTimeout(buscarComparaveisReaisSemLimite(params, budgetMs), budgetMs, {
    comparaveis: [],
    origem: null,
    proximoOffsetBase: params.offsetBase ?? 0,
  })
}
