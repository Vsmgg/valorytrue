import { buscarComparaveisReais } from './_lib/real-comparaveis.js'
import { getUserFromRequest } from './_lib/auth.js'

// BUG real encontrado e corrigido: uma tentativa anterior de sair do Edge Function (limite
// fixo de ~25s, sem exceção) tentando só remover `runtime: 'edge'` e manter o formato antigo
// `export default async function handler(request: Request)` quebrou a produção — a Vercel
// passa um objeto de requisição no estilo Node.js legado (sem `.headers.get()`) pra esse
// formato de export quando não é Edge, incompatível com getUserFromRequest (que espera um
// Request padrão da Web). A correção certa, confirmada na documentação oficial da Vercel: usar
// o formato "Web Handler" (`export default { fetch(request) }`) — aí sim a Vercel garante um
// Request/Response padrão da Web mesmo em runtime Node.js, sem precisar mudar nada em
// getUserFromRequest ou em `request.json()`. Function Node.js no plano atual já tem até 300s
// por padrão (Fluid Compute) — 60s aqui já é uma folga enorme sobre os 25s do Edge, suficiente
// pra terminar a geocodificação de praticamente qualquer rodada sem cortar no meio.
export const config = { maxDuration: 60 }

interface PropertyData {
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  tipoImovel: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Passada dedicada SÓ para buscar amostras reais — separada da 1ª passada (api/analyze.ts)
 * porque, na mesma requisição, a busca real tinha que dividir o orçamento de 25s do Edge
 * Function com a geração principal do laudo (pesada, ~10-24s sozinha), então a busca era
 * forçada a um orçamento de só 4s — tempo real demais insuficiente para o Google Search
 * grounding + geocodificação + verificação de link completarem, mesmo em regiões com
 * fartura de anúncios reais (confirmado: Avenida Paulista, um endereço com dezenas de
 * imóveis à venda documentados pelo próprio usuário, não retornava nada com só 4s).
 * Rodando como sua própria invocação de Edge Function, essa busca ganha um orçamento bem
 * maior sem competir com a geração — o resultado é passado para /api/analyze, que não faz
 * mais busca própria quando já recebe essa lista pronta.
 *
 * O front-end pode chamar este endpoint MAIS DE UMA VEZ em sequência (cada chamada é uma
 * invocação nova do Edge Function, com seu próprio limite de 25s) pra buscar por mais tempo
 * total do que uma única invocação permitiria — o usuário pediu explicitamente pra buscar o
 * máximo possível, mesmo que demore até 2 minutos no total. `offsetBase` evita que a 2ª
 * chamada re-busque as mesmas primeiras páginas da 1ª.
 */
export default {
  fetch: handler,
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user) {
    return json({ error: 'Faça login para usar este módulo.' }, 401)
  }

  let propertyData: PropertyData
  let offsetBase: number
  let origemCoords: { lat: number; lon: number } | undefined
  let urlsJaVistas: string[] | undefined
  try {
    const body = (await request.json()) as {
      propertyData?: PropertyData
      offsetBase?: number
      origemCoords?: { lat: number; lon: number }
      urlsJaVistas?: string[]
    }
    if (!body.propertyData) {
      return json({ error: 'Dados do imóvel não informados.' }, 400)
    }
    propertyData = body.propertyData
    offsetBase = Number.isFinite(body.offsetBase) ? Number(body.offsetBase) : 0
    origemCoords = body.origemCoords
    urlsJaVistas = Array.isArray(body.urlsJaVistas) ? body.urlsJaVistas : undefined
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  // NUNCA inclui "complemento" (apto/torre/bloco) — confirmado via teste real que algo como
  // "Avenida X, 2245 - AP 86 TORRE 4" quebra a geocodificação (Nominatim não resolve número
  // de apartamento), mesmo quando a rua+número sozinhos resolveriam perfeitamente.
  const enderecoCompleto = `${propertyData.logradouro}, ${propertyData.numero}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}`

  const { comparaveis: comparaveisReais, origem, proximoOffsetBase } = await buscarComparaveisReais({
    enderecoCompleto,
    cidade: propertyData.cidade,
    uf: propertyData.uf,
    bairro: propertyData.bairro,
    urlsJaVistas,
    tipoImovel: propertyData.tipoImovel,
    numeroAvaliando: propertyData.numero,
    max: 20,
    // 55s deixa uma margem de 5s dentro do limite de 60s da função Node.js (ver `config` acima
    // — trocado do Edge Function de 25s pra isso exatamente por causa desse orçamento). Sobra
    // tempo real de sobra pra terminar a geocodificação serial (1 req/s no Nominatim) de dezenas
    // de candidatos numa única invocação, em vez de cortar no meio e depender de tantas chamadas
    // encadeadas do front-end.
    budgetMs: 55_000,
    offsetBase,
    origemCoords,
  })

  // Devolve as coordenadas do avaliando pro front-end reaproveitar em chamadas seguintes desta
  // mesma busca (via `origemCoords` no próximo request) — evita geocodificar o MESMO endereço
  // do zero a cada chamada encadeada, o que soma requisições desnecessárias a um serviço de
  // geocodificação gratuito e de uso justo (confirmado via teste real: buscas exaustivas
  // repetidas esgotaram a cota do dia). `proximoOffsetBase` é o offset real onde esta chamada
  // parou de paginar — o front-end usa ele (em vez de recalcular um passo fixo) na próxima
  // chamada encadeada, pra nunca pular nem re-buscar páginas de resultado à toa.
  return json({ comparaveisReais, origem, proximoOffsetBase })
}
