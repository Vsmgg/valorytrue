import { geocodeEndereco, haversineMeters, sleep, type Coordenadas } from './geocode.js'

// BUG real encontrado e corrigido — causa raiz de "0 amostras" que nenhuma das outras correções
// (novas fontes de URL, novos portais) resolvia: confirmado por teste real e isolado que 3
// requisições SIMULTÂNEAS pro MESMO domínio (vivareal.com.br) disparam bloqueio antibot
// IMEDIATO (403), mesmo em URLs nunca visitadas antes — enquanto 1 requisição isolada, na
// mesma hora, pro MESMO domínio, funcionou normal (200). Ou seja: o gatilho não é volume
// histórico acumulado, é CONCORRÊNCIA — vários requests ao mesmo tempo pro mesmo site é uma
// assinatura de bot que um navegador de verdade nunca produz (uma pessoa não carrega 3 páginas
// do mesmo site no mesmo milissegundo). O código tinha VÁRIOS pontos disparando isso sem querer:
// duas URLs previstas do VivaReal em paralelo (ver umaRodada), e a resolução de redirecionamento
// do Gemini (resolverRedirecionamentoGemini) rodando em Promise.all pra TODOS os links de uma
// vez — quando o Gemini cita 2+ anúncios do mesmo portal (comum), isso sozinho já dispara 2+
// requests simultâneos pro mesmo domínio. Este limitador garante NO MÁXIMO 1 requisição em voo
// por domínio a qualquer momento (fila por hostname) — domínios DIFERENTES continuam paralelos
// entre si, só o mesmo domínio nunca mais se sobrepõe.
// BUG real encontrado e corrigido: só evitar SOBREPOSIÇÃO não foi suficiente — confirmado via
// teste real que 2 requisições pro vivareal.com.br, mesmo perfeitamente serializadas (uma
// terminando antes da outra começar), ainda dispararam bloqueio na 2ª quando ficaram só ~1-2s
// de intervalo. Além de nunca sobrepor, agora força um respiro mínimo entre o FIM de uma
// requisição e o INÍCIO da próxima pro mesmo domínio — mais parecido com o ritmo de navegação
// humana real.
const INTERVALO_MINIMO_MESMO_DOMINIO_MS = 3_000
const filaPorDominio = new Map<string, Promise<unknown>>()
async function comLimiteDominio<T>(url: string, fn: () => Promise<T>): Promise<T> {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    host = url
  }
  const anterior = filaPorDominio.get(host) ?? Promise.resolve()
  // O resultado volta pra quem chamou assim que `fn()` termina — só a fila (pra próxima
  // requisição pro MESMO domínio) precisa esperar o respiro extra, não quem já recebeu a
  // resposta.
  const resultado = anterior.catch(() => undefined).then(fn)
  const liberaProximo = resultado.catch(() => undefined).then(() => sleep(INTERVALO_MINIMO_MESMO_DOMINIO_MS))
  filaPorDominio.set(host, liberaProximo)
  return resultado
}

// Solução definitiva pro bloqueio antibot, pedida explicitamente pelo usuário: em vez de só
// mitigar (limitar concorrência, espaçar no tempo — ambos continuam valendo como fallback),
// rotear as buscas nos 5 portais através de um proxy com IP ROTATIVO (ScraperAPI) quando
// configurado. Cada requisição passa por um IP diferente do lado deles, então a reputação de
// IP (a causa raiz confirmada do bloqueio) deixa de ser um problema — não importa quantas
// buscas rodem, nenhum IP nosso acumula histórico suspeito. Só usado nos pontos que tocam os 5
// portais imobiliários diretamente; Nominatim (geocodificação) e a API do Gemini nunca tiveram
// esse problema e continuam com fetch direto.
async function fetchPortalImobiliario(url: string, timeoutMs: number): Promise<Response> {
  const headersNavegador = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'pt-BR,pt;q=0.9',
  }
  const apiKey = process.env.SCRAPERAPI_KEY
  if (apiKey) {
    const urlProxy = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(url)}`
    return fetch(urlProxy, { signal: AbortSignal.timeout(timeoutMs) })
  }
  // Sem a chave configurada, cai pro fetch direto de sempre — ainda protegido pelo limitador de
  // concorrência/espaçamento por domínio (ver comLimiteDominio), que sozinho já resolvia a
  // maior parte dos casos, só não elimina o risco por completo.
  return comLimiteDominio(url, () =>
    fetch(url, { method: 'GET', redirect: 'follow', headers: headersNavegador, signal: AbortSignal.timeout(timeoutMs) }),
  )
}

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
  /** URLs de amostras que uma chamada ANTERIOR desta mesma busca encadeada já devolveu como
   * resultado (ver find-amostras.ts) — pedido explícito do usuário: "seja fixo, sempre trazer
   * 10 amostras". BUG real encontrado e corrigido: sem isso, cada chamada encadeada
   * redescobria do zero a MESMA página de catálogo (é estática — sempre lista os mesmos
   * anúncios, na mesma ordem) e gastava seu orçamento de geocodificação nos MESMOS primeiros
   * candidatos que a chamada anterior já tinha verificado (confirmado via log real: 4 chamadas
   * seguidas encontraram "34 candidatos do HTML", mas a lista final ficava travada em 3-6
   * amostras — o `if (novos.length === 0) break` do front-end interrompia a cadeia cedo demais
   * porque quase tudo já tinha sido "descoberto" antes, mesmo havendo 20+ candidatos reais
   * ainda não tentados na mesma página). Candidatos com url aqui são pulados ANTES de gastar
   * tempo de geocodificação neles — o chamador já os tem, não precisa de novo. */
  urlsJaVistas?: string[]
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
// BUG real encontrado e corrigido: sem exigir espaço logo após a palavra-chave, o regex
// combinava "Rodovia"/"Avenida" como SUBSTRING de qualquer palavra que começasse igual — ex.
// "rodovias e outras vias de acesso" virava um "endereço exato" chamado "rodovias e outras vias
// de acesso", e "avenidas e conveniências da região" virava "Av." + resto. Confirmado via teste
// real: um anúncio genérico sem endereço nenhum, só mencionando "rodovias" e "avenidas" no
// sentido comum da palavra (não como início de nome de rua), foi classificado como precisão
// 'exato' com um "endereço" fabricado sem sentido. Palavra-chave de logradouro sempre é seguida
// de espaço + o nome de verdade ("Rodovia Raposo Tavares", "Avenida Paulista") — nunca de "s"
// (plural) ou pontuação direto. Exigir "\s" logo depois resolve sem afetar nenhum caso real.
const ENDERECO_BASE_RE = /(?:Rua|Avenida|Av\.|Alameda|Travessa|Estrada|Rodovia)\s[^,\n*|<>·•\-:]{2,55}/i
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
// BUG real encontrado e corrigido: "Cond." também é abreviação comum de "taxa de condomínio"
// num contexto de preço (ex.: "Taxa de condomínio: R$ 750"), e "R$" começa com um "R" maiúsculo
// — satisfaz o `[A-ZÀ-Ú]` inicial do grupo de captura sem querer. Confirmado via teste real:
// "Condomínio R$ 750" e "Condomínio R$ 1" viraram "nome de condomínio" fabricado. O nome de um
// condomínio de verdade nunca começa com "R$" nem com um número — a negative lookahead rejeita
// esses casos sem afetar nomes reais.
// BUG real encontrado e corrigido — pedido explícito do usuário (resultado veio com só 4
// amostras em vez de 10): o grupo de captura genérico ("qualquer caractere, até 45") não parava
// em limite nenhum de palavra — quando a descrição do anúncio não tinha pontuação logo depois
// do nome do condomínio (comum em texto corrido de marketing), a captura engolia a frase
// inteira junto: confirmado via log real de produção, "Condomínio Viva Mais Barueri" virou
// "Condomínio Viva Mais Barueri Conforto e PraticidadeEste e" (e outras variações igualmente
// quebradas, uma por anúncio diferente do MESMO condomínio). Cada uma dessas falha na
// geocodificação (não é um endereço de verdade) — mas cada tentativa de geocodificar ocupa uma
// vaga da fila serial (1/s no Nominatim, ver geocodarEFiltrar), então 7+ tentativas
// desperdiçadas só nesse condomínio sozinho custaram tempo real que sobraria pra candidatos
// genuinamente diferentes. Limita a captura a no máximo 5 "palavras" no formato de nome próprio
// (Maiúscula+minúsculas, ou um conector comum minúsculo como "de"/"da"/"do") — para na primeira
// palavra que não se encaixa nesse formato, que é exatamente onde o texto corrido começa.
const CONDOMINIO_RE =
  /(?:Condom[ií]nio|Cond\.)\s+(?!R\$|\d)((?:[A-ZÀ-Ú][a-zà-ú]*|dos|das|do|da|de|e)(?:\s+(?:[A-ZÀ-Ú][a-zà-ú]*|dos|das|do|da|de|e)){0,4})/
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

// BUG real encontrado e corrigido: "sem dígito na URL = página de categoria" (heurística
// antiga) falha pra URLs de categoria que embutem um filtro numérico na própria slug, ex.
// "imovelweb.com.br/casas-sobrado-venda-granja-viana-cotia-2-quartos-ordem-precio-menor.html"
// ("2-quartos" tem dígito) — confirmado via teste real: essa URL de listagem (42 anúncios,
// não uma unidade) passou pelo filtro antigo e virou uma "amostra" com preço/área extraídos
// do texto ao redor, sem ser um anúncio real de unidade nenhuma. Critério mais robusto: cada
// portal tem um caminho de URL fixo pra anúncio de unidade individual (ver
// CAMINHO_ANUNCIO_POR_PORTAL, já usado em extrairCandidatosDeCategoria pra achar hrefs de
// anúncio dentro de uma página de categoria) — páginas de categoria/listagem nunca usam esse
// caminho, então checar a presença dele é decisivo, ao contrário de "tem algum dígito".
function urlContemCaminhoDeAnuncio(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  const portal = PORTAIS.find((p) => host === p || host.endsWith(`.${p}`))
  const caminho = portal ? CAMINHO_ANUNCIO_POR_PORTAL[portal] : undefined
  return Boolean(caminho) && url.includes(caminho)
}

/** Mesmo critério que extrairCandidato usa pra rejeitar uma URL como "página de categoria/
 * listagem" (não tem o caminho de anúncio individual do portal, não institucional, não
 * aluguel) — mas aqui só identifica, não descarta: essas URLs viram "leads" pra buscar direto
 * (ver extrairCandidatosDeCategoria), porque cada uma tende a listar dezenas de anúncios
 * individuais reais de uma vez. */
function ehPaginaDeCategoria(url: string): boolean {
  return (
    urlPertenceAPortalConhecido(url) &&
    !PAGINA_INSTITUCIONAL_RE.test(url) &&
    !ALUGUEL_URL_RE.test(url) &&
    !urlContemCaminhoDeAnuncio(url)
  )
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

// BUG real encontrado e corrigido — pedido explícito do usuário ("as amostras agora estejam
// corretas... estes erros não podem acontecer jamais"): quando o VivaReal serve a versão
// reduzida da página (sem "address.streetAddress" — confirmado que acontece sob defesa
// antibot, mesmo com HTTP 200) E o texto livre também não cita rua nem "Condomínio X", o
// candidato caía direto pro nível 'bairro' — mostrando só o nome do bairro inteiro com uma
// distância até o centroide dele, que pode passar de 2500m mesmo pra imóveis genuinamente
// próximos (Granja Viana é um bairro grande). A URL do próprio anúncio do VivaReal, no entanto,
// SEMPRE embute o nome da sub-região/condomínio na slug (confirmado em dezenas de exemplos reais
// nesta sessão: ".../casa-de-condominio-4-quartos-sao-paulo-ii-cotia-com-garagem-.../" →
// "São Paulo II"), independente de a página estar servindo a versão reduzida ou não — não é um
// dado que a defesa antibot consegue omitir sem quebrar a própria URL. Usa isso como fallback
// ANTES de aceitar o nível 'bairro' — sobe a precisão pra 'condomínio', que já teve seu raio de
// busca corretamente restrito, em vez de cair no bairro inteiro sem restrição de raio.
function extrairSubregiaoDaUrlVivaReal(url: string, bairro: string): string | null {
  try {
    if (!new URL(url).hostname.toLowerCase().endsWith('vivareal.com.br')) return null
  } catch {
    return null
  }
  const m = url.match(/\/imovel\/[a-z0-9-]*?-\d+-quartos-([a-z0-9-]+)-com-garagem-/)
  if (!m || !m[1]) return null
  const palavras = m[1].split('-').filter(Boolean)
  if (palavras.length === 0) return null
  // BUG real encontrado e corrigido: quando o anúncio não pertence a um condomínio/sub-região
  // NOMEADO, a própria slug repete só o nome do BAIRRO (+ a cidade) — ex.
  // ".../3-quartos-granja-viana-cotia-com-garagem-.../" pro bairro "Granja Viana". Sem checar
  // isso, virava um "endereço" tipo "Condomínio/região Granja Viana Cotia", que geocodifica
  // pra um ponto ESTRANHO (confirmado via teste real: 4990m de distância, quando o bairro
  // sozinho geocodifica certinho) — pior que simplesmente cair pro nível 'bairro' normal, que já
  // tem raio isento e distância capada. Só promove pra 'condomínio' quando a slug tem PELO MENOS
  // uma palavra a mais além das palavras do próprio bairro (a cidade sozinha não conta).
  const palavrasBairro = slugParaUrl(bairro).split('-').filter(Boolean)
  const mesmoPrefixo = palavrasBairro.every((p, i) => palavras[i] === p)
  const palavrasExtras = palavras.length - palavrasBairro.length
  if (mesmoPrefixo && palavrasExtras <= 1) return null
  return palavras.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function extrairCandidato(textoBruto: string, url: string | undefined, bairro: string, ruaConhecida?: string): CandidatoBruto | null {
  if (!url) return null
  if (!urlPertenceAPortalConhecido(url)) return null
  if (PAGINA_INSTITUCIONAL_RE.test(url)) return null
  if (ALUGUEL_URL_RE.test(url)) return null
  // Páginas de CATEGORIA/listagem (ex.: "zapimoveis.com.br/venda/apartamentos/sp+barueri++jd-
  // belval/") não são um anúncio de uma unidade específica, mesmo que o trecho de busca
  // mencione um preço de algum imóvel listado nela — confirmado via teste real. Ver
  // urlContemCaminhoDeAnuncio: exigir o caminho de URL fixo do anúncio individual do portal é
  // mais confiável que "tem algum dígito" (uma página de categoria pode ter dígito também, ex.
  // um filtro de quartos embutido na slug — confirmado via teste real com
  // ".../2-quartos-ordem-precio-menor.html", uma listagem de 42 anúncios que passava despercebida).
  if (!urlContemCaminhoDeAnuncio(url)) return null
  // BUG real encontrado e corrigido: o imovelweb anexa parâmetros de rastreio de onde o link foi
  // clicado na página de catálogo (ex. "?n_src=Listado&n_pills=Churrasqueira&n_pg=1&n_pos=8") —
  // o MESMO anúncio aparece com querystrings DIFERENTES dependendo de qual "pill"/posição da
  // listagem gerou o link. Confirmado via teste real: o mesmo imóvel (mesmo ID numérico no
  // caminho) apareceu 2x como amostra "diferente" numa busca encadeada, porque a dedupe (por
  // string de URL exata, tanto aqui quanto em urlsJaVistas entre chamadas) via cada querystring
  // como uma URL distinta. Remove a querystring aqui, na entrada — o caminho do anúncio já é
  // por si só o identificador único da unidade, e o link fica mais limpo pro laudo final.
  const urlLimpa = url.split('?')[0].split('#')[0]
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
  // `ruaConhecida` (rua real vinda de "address.streetAddress" do JSON-LD do próprio portal —
  // ver ListingJsonLd) sempre ganha de qualquer coisa extraída do texto livre: é dado
  // estruturado do próprio anúncio, não uma tentativa de adivinhar via regex. Nunca junta com
  // um número aqui — o portal não publica o número exato da unidade, e inventar um seria pior
  // que não ter (a distância calculada a partir dele já é honesta o suficiente: rua real,
  // mesmo sem número, é bem mais preciso que cair pro bairro inteiro).
  let enderecoInfo = ruaConhecida ? { endereco: ruaConhecida, precisao: 'exato' as PrecisaoEndereco } : extrairEnderecoComPrecisao(text, bairro)
  if (enderecoInfo?.precisao === 'bairro') {
    const subregiao = extrairSubregiaoDaUrlVivaReal(url, bairro)
    if (subregiao) enderecoInfo = { endereco: `Condomínio/região ${subregiao}`, precisao: 'condominio' }
  }
  if (!enderecoInfo) return null

  return {
    endereco: enderecoInfo.endereco,
    precisaoEndereco: enderecoInfo.precisao,
    areaM2,
    valorAnunciado,
    url: urlLimpa,
    tipoDetectado: detectarTipo(text, urlLimpa),
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
// BUG real encontrado e corrigido: uma falha de rede (timeout, conexão recusada) nesta única
// tentativa fazia o candidato inteiro ser descartado mais adiante (a URL de redirecionamento do
// Google nunca bate em urlPertenceAPortalConhecido) — mesmo quando o Gemini já tinha achado um
// candidato real com preço/endereço no texto. Confirmado via teste real: sob defesa antibot
// ativa num portal (ver ehPaginaDeCategoria/categoria non-OK), a MESMA condição de rede também
// deixa esta resolução mais lenta/instável, derrubando pra 0 candidatos aceitos mesmo com
// groundingSupports > 0. Uma retentativa rápida cobre o caso comum de instabilidade passageira
// sem custar tempo demais (a rodada já orçava fetchTimeoutMs pra isso).
async function resolverRedirecionamentoGemini(url: string): Promise<string> {
  if (!url.includes('vertexaisearch.cloud.google.com')) return url
  // BUG real encontrado e corrigido: cheguei a serializar isto globalmente por
  // comLimiteDominio (todos esses links compartilham o mesmo host intermediário
  // "vertexaisearch.cloud.google.com"), pensando em evitar 2 resoluções concorrentes pousando
  // no MESMO site de destino final. Testado ao vivo: isso serializou TODAS as resoluções de
  // TODOS os 5 portais entre si (mesmo host intermediário = mesma fila), o que estourou o
  // orçamento de tempo da rodada inteira antes mesmo de começar a geocodificar — 0 amostras por
  // falta de tempo, não por bloqueio. Na prática, os destinos que o grounding cita são
  // DIVERSOS (confirmado: dezenas de domínios diferentes nos logs reais desta sessão, quase
  // nunca dois no mesmo domínio na mesma rodada) — o risco real de colisão aqui é baixo. O
  // ponto de colisão CONFIRMADO e sistemático era outro (as URLs previstas do VivaReal, ver
  // extrairCandidatosDeCategoria, que SEMPRE mira os mesmos domínios) — a serialização fica só
  // lá, onde o problema é garantido, não aqui, onde o custo supera o benefício.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6_000),
      })
      if (res.url) return res.url
    } catch {
      // tenta de novo antes de desistir
    }
  }
  return url
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

    // Diagnóstico temporário — pedido explícito do usuário pra entender por que "parsed
    // candidates 0" persiste mesmo com groundingSupports > 0: sem isso, não dá pra saber se o
    // problema é resolução de redirecionamento falhando (chunkUrl fica undefined) ou o texto/URL
    // resolvidos sendo rejeitados pelos filtros de extrairCandidato (sem preço, portal
    // desconhecido, página de categoria etc.) — motivos bem diferentes, correções bem diferentes.
    let semUrlResolvida = 0
    let rejeitadoPeloFiltro = 0
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
      if (!candidato || seenUrls.has(candidato.url)) {
        if (!chunkUrl || chunkUrl.includes('vertexaisearch.cloud.google.com')) semUrlResolvida++
        else if (!candidato) {
          rejeitadoPeloFiltro++
          console.error('[real-comparaveis] rejeitado:', chunkUrl, '| texto:', text.slice(0, 140).replace(/\s+/g, ' '))
        }
        continue
      }
      seenUrls.add(candidato.url)
      results.push(candidato)
      if (results.length >= max) break
    }

    console.error(
      '[real-comparaveis] parsed candidates',
      results.length,
      'from',
      supports.length,
      'grounding supports |',
      categorias.length,
      'página(s) de categoria vista(s) | sem-url-resolvida:',
      semUrlResolvida,
      '| rejeitado-por-filtro:',
      rejeitadoPeloFiltro,
    )
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
    const res = await fetchPortalImobiliario(url, URL_CHECK_TIMEOUT_MS)
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
// BUG real encontrado e corrigido: o nível 'exato' geocodificava só "rua, número, cidade - uf",
// SEM o bairro — mas o endereço do PRÓPRIO avaliando (origem, geocodificado em
// buscarComparaveisReaisSemLimite a partir de `enderecoCompleto`) sempre inclui o bairro. Pra
// ruas longas tipo "Estrada" (comuns em zona rural/baixa densidade, atravessando mais de um
// bairro ao longo do trajeto), essa assimetria faz o Nominatim resolver a MESMA rua+número pra
// pontos DIFERENTES dependendo de ter ou não o bairro como desambiguador — confirmado via teste
// real: duas amostras rotuladas com a MESMA rua+número do próprio avaliando ("Estrada Velha de
// Sorocaba, 599") vieram a 1328m de distância, quando deveriam estar a ~0m (é literalmente o
// mesmo texto de endereço). Incluir o bairro também no nível 'exato' garante que a mesma
// rua+número sempre geocodifica pro mesmo ponto que o avaliando, seja lá qual for a amostra.
function montarQueryGeocode(candidato: CandidatoBruto, cidade: string, uf: string, bairro: string): string {
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
  // BUG real encontrado e corrigido: 350ms de intervalo excede o próprio limite documentado do
  // Nominatim (no máximo 1 requisição por SEGUNDO) — funcionava antes porque poucos candidatos
  // por rodada nunca sustentavam esse ritmo tempo suficiente pra disparar o limite. Depois da
  // busca por bairro passar a achar 40+ candidatos brutos por rodada, confirmado via log real de
  // produção: uma sequência de respostas 429 "Too many requests" do Nominatim, descartando
  // dezenas de candidatos reais só por causa do ritmo (não por serem inválidos). 1000ms respeita
  // o limite deles à risca.
  const NOMINATIM_INTERVALO_MS = 1_000
  const resultados: (ComparavelReal | null)[] = []
  const processadosUrls: string[] = []
  // BUG real encontrado e corrigido — pedido explícito do usuário ("verifique, veja o
  // processo... tem que dar certo"): um condomínio grande lista DEZENAS de unidades diferentes,
  // cada uma um candidato/URL distinto, mas todas com o MESMO texto de endereço (ex.
  // "Condomínio Viva Mais Barueri") — sem esse cache, cada uma virava uma chamada SEPARADA ao
  // Nominatim, MESMO quando a query de geocodificação é idêntica. Confirmado via log real de
  // produção: "Condomínio Viva Mais Barueri" geocodificado (e falhando) 4 vezes seguidas na
  // MESMA rodada, desperdiçando 4 vagas da fila serial (1/s) que sobrariam pra candidatos
  // genuinamente diferentes — com só ~15-18s reais de orçamento pra geocodificação depois da
  // busca, cada vaga desperdiçada custa uma amostra real a menos no resultado final. Cacheia
  // por STRING DE QUERY (não por URL do candidato) — a segunda ocorrência da mesma query nunca
  // bate na rede, nem soma o intervalo de 1s do Nominatim.
  const cacheQueryGeocode = new Map<string, Coordenadas | null>()
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
    const queryGeocode = montarQueryGeocode(candidato, cidade, uf, bairro)
    const jaTinhaEssaQuery = cacheQueryGeocode.has(queryGeocode)
    const coords = jaTinhaEssaQuery ? cacheQueryGeocode.get(queryGeocode)! : await geocodeEndereco(queryGeocode)
    if (!jaTinhaEssaQuery) cacheQueryGeocode.set(queryGeocode, coords)
    if (!coords) {
      console.error('[real-comparaveis] candidato descartado (geocode falhou):', candidato.endereco)
      resultados.push(null)
    } else {
      const distanciaBrutaM = haversineMeters(origem, coords)
      // O filtro de raio não REJEITA no nível 'bairro' — a distância aí é até o CENTRO do
      // bairro (geocodificado por falta de rua/condomínio identificável no anúncio), não até o
      // imóvel de verdade, então pode por acaso computar além do raio mesmo sendo
      // comprovadamente do mesmo bairro do avaliando (ex.: avaliando numa ponta do bairro,
      // centroide do bairro na outra). O próprio fato de já estarmos pesquisando ESSE bairro
      // específico (é ele que geramos a query com) já é o critério de proximidade pra este
      // nível — descartar por raio aqui rejeitaria candidatos reais e válidos por um artefato
      // de cálculo, não por estarem genuinamente longe.
      //
      // BUG real encontrado e corrigido — pedido explícito do usuário ("a pessoa não vai saber
      // quanto vale realmente" — mesmo motivo do fix no intervalo de valor): mesmo não
      // rejeitando, mostrar a distância BRUTA (que pode passar de 2500m, um artefato do
      // centroide do bairro ficar longe do avaliando) num campo "distanciaM" sem nenhuma ressalva
      // passa a impressão de uma medição precisa que simplesmente não é — o próprio comentário
      // acima já reconhece que esse número "pode computar além do raio... por um artefato de
      // cálculo". Em vez de mostrar o valor bruto, exibe o TETO do raio de busca desse tipo de
      // imóvel (o limite que já está sendo usado como critério de proximidade) — nunca afirma uma
      // distância mais precisa do que realmente se sabe, mas também nunca mostra um número maior
      // que o próprio critério de busca usado.
      const distanciaM =
        candidato.precisaoEndereco === 'bairro' && raioM !== null ? Math.min(distanciaBrutaM, raioM) : distanciaBrutaM
      if (raioM !== null && distanciaBrutaM > raioM && candidato.precisaoEndereco !== 'bairro') {
        console.error('[real-comparaveis] candidato descartado (fora do raio):', candidato.endereco, '-', Math.round(distanciaBrutaM), 'm')
        resultados.push(null)
      } else {
        resultados.push({ ...candidato, distanciaM } as ComparavelReal)
      }
    }
    // Sem chamada real ao Nominatim (resultado veio do cache), não há limite de ritmo pra
    // respeitar — só espera quando de fato acabou de usar a rede.
    if (!jaTinhaEssaQuery && candidato !== candidatos[candidatos.length - 1]) await sleep(NOMINATIM_INTERVALO_MS)
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

// Confirmado via log real de produção (Sobrado, bairro Granja Viana, Cotia/SP): a página de
// catálogo do VivaReal pra esse bairro+tipo tem URL PREVISÍVEL —
// "vivareal.com.br/venda/sp/cotia/bairros/granja-viana/sobrado_residencial/" — e trouxe 40
// candidatos reais via JSON-LD assim que buscada. O problema: normalmente essa URL só é
// descoberta INDIRETAMENTE, via um link de categoria que aparece no texto de uma busca de
// grounding (ver buscarDeCategoriasNovas) — e pra tipos de baixa densidade (casa/sobrado), o
// grounding por anúncio individual às vezes não acha NADA em 1-2 rodadas inteiras (~7-16s cada)
// antes de finalmente topar com esse link, deixando pouco tempo de orçamento pra geocodificar
// (serial, ~1 req/s no Nominatim) os dezenas de candidatos que a página traria. Tentar essa URL
// prevista DIRETO, em paralelo com a 1ª rodada de grounding (nunca bloqueando nem substituindo
// ela), evita esse desperdício quando o palpite acerta — e é inofensivo quando erra (só um 404
// silencioso, já tratado por extrairCandidatosDeCategoria). Só pros tipos onde o padrão
// "{tipo}_residencial" foi de fato observado/confirmado (casa e sobrado) — terreno e imóvel
// rural ficam de fora por incerteza real sobre o esquema de URL usado pra eles.
const MARCAS_DIACRITICAS_RE = new RegExp('[̀-ͯ]', 'g')
function slugParaUrl(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
const TIPO_SLUG_VIVAREAL: Record<string, string> = {
  'Casa residencial': 'casa_residencial',
  Casa: 'casa_residencial',
  Sobrado: 'sobrado_residencial',
  // Confirmado via log real de produção (Vila Madalena, São Paulo/SP): a mesma URL prevista
  // pra apartamento existe e segue o padrão idêntico ao de casa/sobrado.
  Apartamento: 'apartamento_residencial',
}
function montarUrlCategoriaVivaRealPrevista(tipoImovel: string, bairro: string, cidade: string, uf: string): string | null {
  const tipoSlug = TIPO_SLUG_VIVAREAL[tipoImovel]
  if (!tipoSlug || !bairro || !cidade || !uf) return null
  return `https://www.vivareal.com.br/venda/${slugParaUrl(uf)}/${slugParaUrl(cidade)}/bairros/${slugParaUrl(bairro)}/${tipoSlug}/`
}

// Confirmado via link real trazido pelo usuário: o imovelweb tem uma página de catálogo
// filtrada pela RUA do próprio avaliando (não só o bairro inteiro) — URL previsível
// "imovelweb.com.br/casas-venda-{bairro}-{cidade}-drc-{rua}.html" (ex.
// "casas-venda-granja-viana-cotia-drc-estrada-velha-de-sorocaba.html", 164 casas reais). Sendo
// filtrada pela rua exata, tende a devolver candidatos ainda mais próximos que a página de
// catálogo genérica do bairro (ver montarUrlCategoriaVivaRealPrevista) — vale a pena tentar em
// paralelo com ela. Só pros tipos de baixa densidade (ver TIPOS_BAIXA_DENSIDADE) — o segmento
// "casas-venda" é específico pra casa/sobrado, não existe equivalente confirmado pra
// apartamento.
function montarUrlCategoriaImovelwebPrevista(tipoImovel: string, ruaAvaliando: string, bairro: string, cidade: string): string | null {
  if (!TIPOS_BAIXA_DENSIDADE.has(tipoImovel) || !ruaAvaliando || !bairro || !cidade) return null
  return `https://www.imovelweb.com.br/casas-venda-${slugParaUrl(bairro)}-${slugParaUrl(cidade)}-drc-${slugParaUrl(ruaAvaliando)}.html`
}

// Confirmado via URL real descoberta por grounding numa rodada anterior desta mesma sessão
// (".../bairros/granja-viana/avenida-sao-camilo/sobrado_residencial/") e validada manualmente: o
// VivaReal TAMBÉM tem uma página de catálogo por RUA, inserindo o segmento da rua entre o bairro
// e o tipo — "bairros/{bairro}/{rua}/{tipo}_residencial/". É uma URL DIFERENTE da página de
// bairro inteiro (montarUrlCategoriaVivaRealPrevista) — importante ter as duas como fontes
// independentes: numa defesa antibot pontual contra uma URL específica (confirmado que acontece
// nesta mesma sessão, mesmo portal), a outra pode continuar respondendo normalmente.
function montarUrlCategoriaVivaRealRuaPrevista(tipoImovel: string, ruaAvaliando: string, bairro: string, cidade: string, uf: string): string | null {
  const tipoSlug = TIPO_SLUG_VIVAREAL[tipoImovel]
  if (!tipoSlug || !ruaAvaliando || !bairro || !cidade || !uf) return null
  return `https://www.vivareal.com.br/venda/${slugParaUrl(uf)}/${slugParaUrl(cidade)}/bairros/${slugParaUrl(bairro)}/${slugParaUrl(ruaAvaliando)}/${tipoSlug}/`
}

// BUG real encontrado e corrigido — causa raiz de "0 amostras" descoberta ao investigar por que
// a busca por portal individual (Gemini) não achava nada mesmo com dezenas de imóveis reais
// disponíveis: os únicos 2 atalhos de URL prevista (VivaReal, Imovelweb) tinham ficado
// temporariamente bloqueados por antibot depois de tanto teste na mesma região — sem um 3º
// atalho pros outros portais permitidos, isso zerava tudo mesmo com o ZapImóveis (mesmo grupo
// do VivaReal) respondendo normalmente e com dezenas de anúncios reais da MESMA região.
// Confirmado via teste real: "zapimoveis.com.br/venda/{tipo}/{uf}+{cidade}++{bairro}/" (o "++"
// duplo é um placeholder de sub-região vazia, confirmado empiricamente) devolve JSON-LD completo
// no mesmo formato "RealEstateListing" do VivaReal (mesmo grupo empresarial).
const TIPO_SLUG_ZAP: Record<string, string> = {
  'Casa residencial': 'casas',
  Casa: 'casas',
  Sobrado: 'casas',
  Apartamento: 'apartamentos',
}
function montarUrlCategoriaZapImoveisPrevista(tipoImovel: string, bairro: string, cidade: string, uf: string): string | null {
  const tipoSlug = TIPO_SLUG_ZAP[tipoImovel]
  if (!tipoSlug || !bairro || !cidade || !uf) return null
  return `https://www.zapimoveis.com.br/venda/${tipoSlug}/${slugParaUrl(uf)}+${slugParaUrl(cidade)}++${slugParaUrl(bairro)}/`
}

// BUG real encontrado e corrigido — pedido explícito do usuário ("tire endereço e faça que
// busque pelo bairro"): a busca por ENDEREÇO/rua específica no prompt (versão anterior) e a
// descoberta de catálogo por CEP (buscarPaginaCategoriaPorCep) mostraram-se instáveis em teste
// real repetido — o grounding do Gemini frequentemente não achava nada pra uma consulta tão
// específica, e em pelo menos 2 casos reais (confirmado em log de produção) "achou" uma URL de
// catálogo que na verdade dava 404 (provavelmente um padrão de URL plausível, mas nunca
// confirmado por uma busca real — risco de alucinação do texto puro da resposta). Já testado
// manualmente e confirmado, MÚLTIPLAS vezes, que buscar direto pela página de catálogo do
// BAIRRO inteiro (ex. "imovelweb.com.br/apartamentos-venda-jardim-belval-barueri.html") sempre
// retorna dezenas de anúncios reais, de forma consistente — bairro é uma unidade geográfica bem
// mais indexada e estável do que um endereço/CEP exato. O filtro de raio/proximidade em relação
// ao endereço avaliando continua acontecendo DEPOIS, na geocodificação de cada candidato — só a
// CONSULTA de busca deixou de ser amarrada ao endereço exato.
function montarPrompt(site: string | null, max: number, tipoImovel: string, bairro: string, cidade: string, uf: string): string {
  const escopo = site
    ? `Busque especificamente em site:${site}.`
    : `Busque especificamente nestes sites, nesta ordem de prioridade: ${PORTAIS.map((p) => `site:${p}`).join(', ')} — e também em imobiliárias locais da região se os anteriores não trouxerem resultado.`
  return `Busque na internet até ${max} ANÚNCIOS de imóveis do tipo "${tipoImovel}" À VENDA (unidades específicas, com preço, não páginas institucionais de condomínio/empreendimento) no bairro "${bairro}", ${cidade} - ${uf}. Cubra o bairro inteiro — não se limite a uma única rua ou condomínio, traga o maior número possível de opções reais e diferentes dessa região.

IMPORTANTE — SOMENTE VENDA: busque APENAS imóveis À VENDA. NUNCA traga imóveis para ALUGUEL/LOCAÇÃO — se um anúncio mencionar "aluguel", "locação", "alugar" ou valor mensal de locação, IGNORE-O completamente, mesmo que o restante pareça relevante.

${escopo}

Para cada anúncio encontrado, escreva uma linha própria com o endereço (rua e número quando divulgados no anúncio, ou o nome do condomínio/empreendimento quando a rua não for divulgada — comum em casas de condomínio fechado), o PREÇO DE VENDA em R$ e a área em m². O preço é obrigatório — se uma página não tiver um preço de venda claro de uma unidade específica, não a inclua. Seja direto, sem introdução.`
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
  /** Rua real do anúncio (sem número — os portais nunca publicam o número exato da unidade,
   * só a rua), quando o bloco JSON-LD tem um "address.streetAddress" estruturado. Confirmado
   * via teste real: o VivaReal publica isso pra praticamente todo anúncio ("Avenida José
   * Giorgi", "Rua Santo Amaro" etc.), mesmo quando a "description" em texto livre não cita rua
   * nenhuma (comum em casa de condomínio fechado) — muito mais confiável que tentar achar o
   * nome do condomínio por regex no texto livre (ver CONDOMINIO_RE), que falha na maioria dos
   * casos reais porque o texto raramente usa literalmente "Condomínio X". */
  streetAddress?: string
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
        const enderecoObj = obj.address && typeof obj.address === 'object' ? (obj.address as Record<string, unknown>) : null
        const streetAddress =
          enderecoObj && typeof enderecoObj.streetAddress === 'string' ? enderecoObj.streetAddress.trim() : undefined
        if (url) listings.push({ url, description, streetAddress: streetAddress || undefined })
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
async function extrairCandidatosDeCategoria(urlCategoria: string, site: string, bairro: string): Promise<CandidatoBruto[]> {
  const caminhoAnuncio = CAMINHO_ANUNCIO_POR_PORTAL[site]
  if (!caminhoAnuncio) return []
  try {
    // Roteado via proxy de IP rotativo quando configurado (ver fetchPortalImobiliario) — é
    // exatamente este fetch que, disparado 2x ao mesmo tempo pro vivareal.com.br (bairro + rua
    // previstas, ver umaRodada), foi confirmado como o gatilho direto do bloqueio antibot que
    // zerava a busca inteira mesmo em bairros nunca testados antes.
    const res = await fetchPortalImobiliario(urlCategoria, HTML_CATEGORIA_TIMEOUT_MS)
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
    //
    // BUG real encontrado e corrigido: esta função costumava prepender `ruaReferencia` (a rua do
    // PRÓPRIO avaliando) ao texto sempre que o anúncio não citava rua nenhuma — pensado como
    // fallback pra não descartar o candidato. Mas isso rodava ANTES da classificação de precisão
    // (extrairEnderecoComPrecisao, dentro de extrairCandidato), então fazia TODO candidato sem
    // rua própria (a maioria, em bairro de condomínio fechado — ver CONDOMINIO_RE) ser
    // erroneamente classificado como precisão 'exato' usando o ENDEREÇO DO AVALIANDO, nunca o
    // endereço/condomínio real do anúncio. Confirmado via teste real: 8 amostras de condomínios
    // DIFERENTES (São Paulo II, Bosque do Vianna, Jardim da Glória...) todas rotuladas com o
    // mesmo endereço "Estrada Velha de Sorocaba, 500" (do avaliando) e a MESMA distância (914m,
    // na prática a distância do avaliando até ele mesmo). O fallback certo já existe em
    // extrairEnderecoComPrecisao (condomínio, depois bairro) — não precisa (e não deve) injetar
    // a rua do avaliando no texto do candidato. Quando o próprio JSON-LD publica a RUA REAL do
    // anúncio (`streetAddress`), usa ela direto (via `ruaConhecida` em extrairCandidato) — dado
    // estruturado do portal, não uma adivinhação.
    for (const { url, description, streetAddress } of extrairListingsJsonLd(html)) {
      if (candidatos.length >= MAX_CANDIDATOS_POR_CATEGORIA) break
      if (vistos.has(url)) continue
      vistos.add(url)
      const candidato = extrairCandidato(description, url, bairro, streetAddress)
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
      const janela = removerHtml(html.slice(inicio, fim))
      // Não injeta mais `ruaReferencia` (rua do avaliando) quando o card não cita rua própria —
      // ver o mesmo bug corrigido acima, na extração via JSON-LD: isso classificava o candidato
      // como precisão 'exato' com o ENDEREÇO DO AVALIANDO em vez de deixar
      // extrairEnderecoComPrecisao cair corretamente pra 'condominio' ou 'bairro'.
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
  const { enderecoCompleto, cidade, uf, bairro, tipoImovel, numeroAvaliando, max = budgetMs >= 10_000 ? 12 : 6, offsetBase = 0, urlsJaVistas } = params
  const urlsJaVistasSet = new Set(urlsJaVistas ?? [])
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
  // conteúdo não muda de uma rodada pra outra dentro da mesma avaliação). Teto de 5 por
  // rodada — a busca agora é bairro-wide (ver montarPrompt), então é comum os 5 portais
  // baterem incidentalmente numa página de catálogo do bairro na mesma rodada.
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
    const resultados = await Promise.all(alvos.map(({ url, site }) => extrairCandidatosDeCategoria(url, site, bairro)))
    return resultados.flat()
  }

  async function umaRodada(_rodadaIndex: number, fetchTimeoutMs: number): Promise<CandidatoBruto[]> {
    if (buscarPorPortais) {
      // Só na 1ª rodada: tenta as URLs de catálogo previstas (ver montarUrlCategoriaVivaRealPrevista
      // e montarUrlCategoriaImovelwebPrevista) EM PARALELO com o grounding por portal, em vez de
      // esperar o grounding "descobrir" esses mesmos links (o que pode levar 1-2 rodadas inteiras
      // pra tipos de baixa densidade) — nunca bloqueia nem atrasa o restante da rodada.
      // BUG real encontrado e corrigido: as duas URLs previstas do VivaReal (bairro e rua)
      // miram o MESMO domínio — mesmo serializadas (ver comLimiteDominio) e nunca sobrepondo,
      // testado ao vivo que disparar as duas na MESMA rodada ainda deixa pouco tempo de
      // orçamento pra geocodificar (cada uma soma seu próprio respiro mínimo de 3s). Espalha
      // uma em cada rodada em vez de tentar as duas de uma vez — rua na 1ª (mais específica,
      // prioridade maior), bairro na 2ª (fallback) — cada rodada só toca vivareal.com.br uma
      // vez, sobrando bem mais tempo real pra geocodificação.
      const ruaAvaliando = _rodadaIndex === 1 ? (enderecoCompleto.split(',')[0] || '').trim() : ''
      const urlVivaRealPrevista = _rodadaIndex === 2 ? montarUrlCategoriaVivaRealPrevista(tipoImovel, bairro, cidade, uf) : null
      const urlVivaRealRuaPrevista =
        _rodadaIndex === 1 ? montarUrlCategoriaVivaRealRuaPrevista(tipoImovel, ruaAvaliando, bairro, cidade, uf) : null
      const urlImovelwebPrevista = _rodadaIndex === 1 ? montarUrlCategoriaImovelwebPrevista(tipoImovel, ruaAvaliando, bairro, cidade) : null
      const urlZapPrevista = _rodadaIndex === 1 ? montarUrlCategoriaZapImoveisPrevista(tipoImovel, bairro, cidade, uf) : null
      if (urlVivaRealPrevista) categoriasJaBuscadas.add(urlVivaRealPrevista)
      if (urlVivaRealRuaPrevista) categoriasJaBuscadas.add(urlVivaRealRuaPrevista)
      if (urlImovelwebPrevista) categoriasJaBuscadas.add(urlImovelwebPrevista)
      if (urlZapPrevista) categoriasJaBuscadas.add(urlZapPrevista)
      const [porPortal, daVivaRealPrevista, daVivaRealRuaPrevista, daImovelwebPrevista, daZapPrevista] = await Promise.all([
        Promise.all(
          PORTAIS.map(async (site) => {
            const { candidatos, categorias } = await buscarCandidatos(
              montarPrompt(site, maxPorPortal, tipoImovel, bairro, cidade, uf),
              maxPorPortal,
              fetchTimeoutMs,
              bairro,
            )
            return { site, candidatos, categorias }
          }),
        ),
        urlVivaRealPrevista ? extrairCandidatosDeCategoria(urlVivaRealPrevista, 'vivareal.com.br', bairro) : Promise.resolve([]),
        urlVivaRealRuaPrevista ? extrairCandidatosDeCategoria(urlVivaRealRuaPrevista, 'vivareal.com.br', bairro) : Promise.resolve([]),
        urlImovelwebPrevista ? extrairCandidatosDeCategoria(urlImovelwebPrevista, 'imovelweb.com.br', bairro) : Promise.resolve([]),
        urlZapPrevista ? extrairCandidatosDeCategoria(urlZapPrevista, 'zapimoveis.com.br', bairro) : Promise.resolve([]),
      ])
      const daCategoria = await buscarDeCategoriasNovas(porPortal.map(({ site, categorias }) => ({ site, categorias })))
      // BUG real encontrado e corrigido: a ordem aqui decide quem entra primeiro na fila de
      // geocodificação (ver geocodarEFiltrar — processa em ORDEM DO ARRAY, serial, 1 req/s no
      // Nominatim, e corta assim que o prazo estoura). As páginas de catálogo filtradas pela RUA
      // DO AVALIANDO (VivaReal e Imovelweb) são a fonte mais provável de trazer candidatos
      // genuinamente PRÓXIMOS — mas vinham DEPOIS dos 40 candidatos genéricos do bairro inteiro, e
      // um teste real confirmou: 28 candidatos reais de uma página filtrada foram achados, mas
      // nenhum sobreviveu — o prazo estourou verificando os do bairro primeiro. Rua específica >
      // bairro inteiro (VivaReal e ZapImóveis, mesmo nível de prioridade) > achado individual por
      // grounding > categoria descoberta por acaso, nessa ordem de prioridade.
      return [
        ...daImovelwebPrevista,
        ...daVivaRealRuaPrevista,
        ...daVivaRealPrevista,
        ...daZapPrevista,
        ...porPortal.flatMap((p) => p.candidatos),
        ...daCategoria,
      ]
    }
    if (geminiConfigurado) {
      const { candidatos } = await buscarCandidatos(montarPrompt(null, max, tipoImovel, bairro, cidade, uf), max, fetchTimeoutMs, bairro)
      return candidatos
    }
    return []
  }

  // Com retry via Gemini habilitado (buscarPorPortais), o teto por rodada precisa ser menor
  // que o orçamento total pra caber várias rodadas. Sem orçamento generoso (fallback apertado
  // em analyze.ts/avm.ts), só há UMA rodada, então ela pode usar quase todo o orçamento
  // disponível.
  // BUG real encontrado e corrigido — pedido explícito do usuário ("tem que dar certo"):
  // confirmado via log real de produção que a busca por portal individual (Gemini) contribui
  // ~0 candidatos diretos na prática (o texto que ela cita quase sempre vem de sites fora dos 5
  // portais permitidos, então é descartado — ver "rejeitado-por-filtro" nos logs). Mesmo assim,
  // ela compartilha o MESMO Promise.all das URLs de catálogo previstas (ver umaRodada) — como
  // Promise.all só resolve quando TODOS terminam, um timeout de 7s aqui (maior que os 6s do
  // fetch de categoria) podia sozinho ser o fator mais lento da rodada inteira mesmo
  // contribuindo nada, roubando tempo real que sobraria pra geocodificar os candidatos de
  // verdade (confirmado: 110 candidatos reais achados, só 6 verificados antes do prazo
  // estourar). 4s é suficiente pro caso comum (resposta do Gemini geralmente volta bem antes
  // disso) sem deixar esse ramo de baixo valor segurar a rodada.
  const fetchTimeoutMs = buscarPorPortais ? 4_000 : Math.max(2_000, Math.min(budgetMs - 2_000, 18_000))
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
    // `urlsJaVistasSet` filtra ANTES de entrar no acumulado — sem isso, o tempo de
    // geocodificação desta chamada seria gasto reverificando candidatos que uma chamada
    // encadeada anterior já devolveu como amostra confirmada (ver comentário em
    // BuscarParams.urlsJaVistas), nunca sobrando pra achar os que realmente faltam.
    const novosUnicos = novos.filter((c) => !vistos.has(c.url) && !urlsJaVistasSet.has(c.url))
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
