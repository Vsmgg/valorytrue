import { getUserFromRequest } from './_lib/auth.js'
import type { AmostraIA } from './_lib/nbr-recompute.js'

// Revertido — ver o motivo completo no config de analyze-verify.ts: trocar pra função Node.js
// normal quebrou getUserFromRequest inteiro ("request.headers.get is not a function").
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
  topografia?: string
  testada?: string
  posicao?: string
  infraestruturaUrbana?: string
  zoneamentoInformado?: string
  ocupacaoUso?: string
}

interface FatorAplicado {
  fator: string
  valor: number
  origem: string
  justificativa: string
  campoAplicacao: string
  abrangenciaRegional: string
  abrangenciaTemporal: string
}

interface Amostra extends AmostraIA {
  fonte: string
  data: string
  endereco: string
  tipologia: string
  areaM2: number
  valorAnunciado: number
  dormitorios: number
  suites: number
  banheiros: number
  vagas: number
  padrao: string
  conservacao: string
  idadeAnos: number
  distanciaM: number
  evidencia: string
  fatoresAplicados: FatorAplicado[]
  valorUnitarioHomogeneizado: number
}

interface AvaliacaoResultado {
  tipoImovel: string
  finalidade: string
  caracterizacao: {
    padraoConstrutivo: string
    estadoConservacao: string
    patologias: string[]
    descricaoEntorno: string
    zoneamento: string
  }
  metodo: { metodo: string; justificativa: string }
  amostras: Amostra[]
  tratamentoEstatistico: {
    media: number
    mediana: number
    minimo: number
    maximo: number
    coeficienteVariacao: number
    amplitude: number
    amostrasUtilizadas: number
    amostrasExcluidas: { id: string; motivo: string }[]
  }
  parecer: { valorMercado: number; faixaMin: number; faixaMax: number; liquidez: string; fundamentacao: string }
  grauFundamentacao: { itens: { item: string; grauAtingido: string; descricao: string }[]; grauFinal: string; justificativa: string }
  grauPrecisao: { estimativaPontual: number; limiteInferior: number; limiteSuperior: number; amplitude: number; grauFinal: string }
  valorFinal: {
    valorUnitario: number
    areaAvalianda: number
    valorTotal: number
    intervaloMin: number
    intervaloMax: number
    valorAdotado: number
    justificativaAdocao: string
  }
  descricaoLaudo: string
  dadosInsuficientes: boolean
  dadosInsuficientesMotivo?: string
  documentosAnalisados: { label: string; resumo: string }[]
  divergencias: { campo: string; valorVistoria: string; valorDocumento: string; percentual: number; mensagem: string }[]
  financiabilidade: { status: string; motivos: string[] }
  iqg: {
    score: number
    classificacao: string
    fatores: { liquidez: number; conservacao: number; localizacao: number; riscoJuridico: number; riscoAmbiental: number; riscoDocumental: number }
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

const moeda = (v: number) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Formata o resultado JÁ AUDITADO E CALCULADO deterministicamente (ver
 * api/_lib/nbr-recompute.ts) como texto legível — não um JSON cru — pra facilitar a IA
 * transcrever os números com fidelidade ao redigir a prosa, em vez de precisar reinterpretar
 * uma estrutura aninhada. Um JSON.stringify completo entra depois, como reforço redundante.
 */
function formatarDadosTecnicos(propertyData: PropertyData, resultado: AvaliacaoResultado, documentLabels: string[], hoje: string): string {
  const linhas: string[] = []

  linhas.push(`DATA-BASE: ${hoje}`)
  linhas.push('')
  linhas.push('IMÓVEL AVALIANDO:')
  linhas.push(`- Endereço: ${propertyData.logradouro}, ${propertyData.numero}${propertyData.complemento ? ` - ${propertyData.complemento}` : ''}, ${propertyData.bairro}, ${propertyData.cidade} - ${propertyData.uf}, CEP ${propertyData.cep}`)
  linhas.push(`- Tipo: ${resultado.tipoImovel} · Finalidade: ${resultado.finalidade}`)
  linhas.push(`- Área construída/privativa: ${propertyData.areaConstruida} m²${propertyData.areaTerreno ? ` · Área do terreno: ${propertyData.areaTerreno} m²` : ''}`)
  linhas.push(`- Dormitórios: ${propertyData.dormitorios} · Banheiros: ${propertyData.banheiros} · Vagas: ${propertyData.vagas}`)
  if (propertyData.topografia) linhas.push(`- Topografia: ${propertyData.topografia}`)
  if (propertyData.testada) linhas.push(`- Testada: ${propertyData.testada} m`)
  if (propertyData.posicao) linhas.push(`- Posição no lote/quadra: ${propertyData.posicao}`)
  if (propertyData.infraestruturaUrbana) linhas.push(`- Infraestrutura urbana observada: ${propertyData.infraestruturaUrbana}`)
  if (propertyData.zoneamentoInformado) linhas.push(`- Zoneamento informado: ${propertyData.zoneamentoInformado}`)
  if (propertyData.ocupacaoUso) linhas.push(`- Ocupação e uso: ${propertyData.ocupacaoUso}`)
  if (propertyData.observacoes) linhas.push(`- Observações do vistoriador: ${propertyData.observacoes}`)
  linhas.push('')

  linhas.push('CARACTERIZAÇÃO (já extraída de fotos/documentos nas passadas anteriores — DADO OBSERVADO/DECLARADO, não invente além disto):')
  linhas.push(`- Padrão construtivo: ${resultado.caracterizacao.padraoConstrutivo}`)
  linhas.push(`- Estado de conservação: ${resultado.caracterizacao.estadoConservacao}`)
  if (resultado.caracterizacao.patologias.length > 0) linhas.push(`- Patologias identificadas: ${resultado.caracterizacao.patologias.join(', ')}`)
  linhas.push(`- Entorno: ${resultado.caracterizacao.descricaoEntorno}`)
  linhas.push(`- Zoneamento: ${resultado.caracterizacao.zoneamento}`)
  linhas.push('')

  linhas.push(`DOCUMENTOS/FOTOS ANALISADOS (${documentLabels.length} arquivo(s) — análise remota, NUNCA descreva como vistoria presencial):`)
  if (resultado.documentosAnalisados.length === 0) linhas.push('- Nenhum documento ou foto foi anexado nesta avaliação.')
  for (const d of resultado.documentosAnalisados) linhas.push(`- ${d.label}: ${d.resumo}`)
  linhas.push('')

  if (resultado.divergencias.length > 0) {
    linhas.push('DIVERGÊNCIAS DOCUMENTAIS ENCONTRADAS:')
    for (const d of resultado.divergencias) {
      linhas.push(`- ${d.campo}: vistoriador informou "${d.valorVistoria}", documento indica "${d.valorDocumento}" (diferença de ${d.percentual}%) — ${d.mensagem}`)
    }
    linhas.push('')
  }

  linhas.push(`MÉTODO: ${resultado.metodo.metodo}`)
  linhas.push(`Justificativa da escolha: ${resultado.metodo.justificativa}`)
  linhas.push('')

  linhas.push(`AMOSTRAS DE MERCADO (${resultado.amostras.length} — cada uma é uma OFERTA ativa real, NUNCA uma venda concluída; URL é o link direto e funcional do próprio anúncio):`)
  if (resultado.amostras.length === 0) linhas.push('- Nenhuma amostra real foi encontrada dentro do raio de busca.')
  for (const a of resultado.amostras) {
    linhas.push(`- [${a.id}] ${a.endereco} — ${a.tipologia}, ${a.areaM2} m², a ${a.distanciaM} m do avaliando — Oferta: ${moeda(a.valorAnunciado)} (${moeda(a.valorUnitario)}/m²) — Fonte: ${a.fonte}, pesquisado em ${a.data} — Link: ${a.url || 'sem link (não usar sem fonte verificável)'}`)
    linhas.push(`  Características: ${a.dormitorios} dorm., ${a.suites} suíte(s), ${a.banheiros} banheiro(s), ${a.vagas} vaga(s), padrão ${a.padrao}, conservação ${a.conservacao}, ~${a.idadeAnos} anos`)
    linhas.push(`  Evidência: ${a.evidencia}`)
    for (const f of a.fatoresAplicados) {
      linhas.push(`  Fator ${f.fator}: ${f.valor.toFixed(2)} — ${f.justificativa}`)
    }
    linhas.push(`  Valor original ${moeda(a.valorUnitario)}/m² → após fatores → Valor unitário HOMOGENEIZADO: ${moeda(a.valorUnitarioHomogeneizado)}/m²`)
  }
  linhas.push('')

  linhas.push('AMOSTRAS EXCLUÍDAS DO TRATAMENTO ESTATÍSTICO:')
  if (resultado.tratamentoEstatistico.amostrasExcluidas.length === 0) linhas.push('- Nenhuma amostra foi excluída.')
  for (const e of resultado.tratamentoEstatistico.amostrasExcluidas) linhas.push(`- [${e.id}]: ${e.motivo}`)
  linhas.push('')

  linhas.push('TRATAMENTO ESTATÍSTICO (já calculado deterministicamente — use estes números exatos):')
  linhas.push(`- Média: ${moeda(resultado.tratamentoEstatistico.media)}/m² · Mediana: ${moeda(resultado.tratamentoEstatistico.mediana)}/m²`)
  linhas.push(`- Mínimo: ${moeda(resultado.tratamentoEstatistico.minimo)}/m² · Máximo: ${moeda(resultado.tratamentoEstatistico.maximo)}/m²`)
  linhas.push(`- Coeficiente de variação: ${resultado.tratamentoEstatistico.coeficienteVariacao.toFixed(1)}% · Amplitude: ${resultado.tratamentoEstatistico.amplitude.toFixed(1)}%`)
  linhas.push(`- Amostras efetivamente utilizadas: ${resultado.tratamentoEstatistico.amostrasUtilizadas}`)
  linhas.push('')

  linhas.push('GRAU DE FUNDAMENTAÇÃO (já calculado — use estes graus exatos):')
  for (const it of resultado.grauFundamentacao.itens) linhas.push(`- ${it.item}: Grau ${it.grauAtingido} — ${it.descricao}`)
  linhas.push(`- Grau final: ${resultado.grauFundamentacao.grauFinal} — ${resultado.grauFundamentacao.justificativa}`)
  linhas.push('')

  linhas.push('GRAU DE PRECISÃO (já calculado — use estes números exatos):')
  linhas.push(`- Estimativa pontual: ${moeda(resultado.grauPrecisao.estimativaPontual)}`)
  linhas.push(`- Intervalo de confiança (80%): ${moeda(resultado.grauPrecisao.limiteInferior)} a ${moeda(resultado.grauPrecisao.limiteSuperior)}`)
  linhas.push(`- Amplitude: ${resultado.grauPrecisao.amplitude.toFixed(1)}% · Grau: ${resultado.grauPrecisao.grauFinal}`)
  linhas.push('')

  linhas.push('VALOR DE MERCADO — DEFINITIVO, NUNCA RECALCULE:')
  linhas.push(`- Valor unitário adotado: ${moeda(resultado.valorFinal.valorUnitario)}/m² · Área avaliada: ${resultado.valorFinal.areaAvalianda} m²`)
  linhas.push(`- Valor total: ${moeda(resultado.valorFinal.valorTotal)}`)
  linhas.push(`- Intervalo: ${moeda(resultado.valorFinal.intervaloMin)} a ${moeda(resultado.valorFinal.intervaloMax)}`)
  linhas.push(`- Valor adotado: ${moeda(resultado.valorFinal.valorAdotado)}`)
  linhas.push(`- Justificativa da adoção: ${resultado.valorFinal.justificativaAdocao}`)
  linhas.push(`- Fundamentação do parecer: ${resultado.parecer.fundamentacao}`)
  linhas.push('')

  linhas.push(`LIQUIDEZ CLASSIFICADA: ${resultado.parecer.liquidez}`)
  linhas.push(`FINANCIABILIDADE: ${resultado.financiabilidade.status} — ${resultado.financiabilidade.motivos.join('; ')}`)
  linhas.push(`ÍNDICE DE QUALIDADE DA GARANTIA (IQG): ${resultado.iqg.score}/100 — ${resultado.iqg.classificacao} (liquidez ${resultado.iqg.fatores.liquidez}, conservação ${resultado.iqg.fatores.conservacao}, localização ${resultado.iqg.fatores.localizacao}, risco jurídico ${resultado.iqg.fatores.riscoJuridico}, risco ambiental ${resultado.iqg.fatores.riscoAmbiental}, risco documental ${resultado.iqg.fatores.riscoDocumental})`)
  linhas.push('')

  if (resultado.dadosInsuficientes) {
    linhas.push('*** ATENÇÃO — DADOS INSUFICIENTES ***')
    linhas.push(resultado.dadosInsuficientesMotivo || 'Amostras reais insuficientes para uma precificação confiável pelo método comparativo direto.')
    linhas.push('')
  }

  linhas.push('RESUMO TÉCNICO ADICIONAL (síntese já redigida nas passadas anteriores, pode reaproveitar o conteúdo mas reescreva no estilo do documento):')
  linhas.push(resultado.descricaoLaudo)
  linhas.push('')

  linhas.push('BLOCO JSON COMPLETO (reforço redundante — mesmos dados de cima, use só pra conferir, nunca como fonte adicional de fatos):')
  linhas.push(JSON.stringify(resultado))

  return linhas.join('\n')
}

const SYSTEM_INSTRUCTION = `Você é um ENGENHEIRO DE AVALIAÇÕES IMOBILIÁRIAS especializado em avaliações de imóveis urbanos no Brasil. Sua ÚNICA tarefa nesta chamada é REDIGIR o texto completo e formal de um LAUDO DE AVALIAÇÃO DE IMÓVEL, fundamentado na ABNT NBR 14653-1 (Procedimentos Gerais), NBR 14653-2 (Imóveis Urbanos) e nas orientações do IBAPE.

TODOS os dados, números, amostras, cálculos e graus técnicos já foram apurados, verificados e calculados deterministicamente por passadas anteriores do sistema — eles aparecem no bloco "DADOS TÉCNICOS DEFINITIVOS" abaixo. Você NUNCA recalcula, NUNCA altera, NUNCA arredonda diferente e NUNCA inventa nenhum número, amostra, link ou característica além do que está nesse bloco. Sua função é exclusivamente REDIGIR A PROSA TÉCNICA formal ao redor desses fatos já verificados.

REGRAS DE INTEGRIDADE (absolutas, sem exceção):
- Quando uma informação necessária não estiver no bloco de dados, escreva literalmente "DADO NÃO DISPONÍVEL" — nunca invente, estime ou complete silenciosamente.
- Diferencie sempre, pela forma como escreve cada informação: DADO CONFIRMADO (documento/anúncio real verificado — ex. preço e endereço de cada amostra, dados de matrícula/IPTU quando houver), DADO DECLARADO (informado pelo vistoriador, não verificado por documento), DADO OBSERVADO (extraído de fotos), DADO ESTIMADO (inferência técnica plausível, com base declarada), DADO INFERIDO (dedução lógica a partir de outros dados), ou DADO NÃO DISPONÍVEL. Não precisa rotular cada frase explicitamente, mas a REDAÇÃO deve deixar claro o nível de certeza (ex. "conforme fotos analisadas remotamente" vs "segundo o vistoriador" vs "consta na matrícula").
- Cada amostra de mercado é sempre uma OFERTA (anúncio ativo) — NUNCA descreva como uma venda/transação efetivamente realizada.
- Este sistema NUNCA realiza vistoria presencial — a análise é feita remotamente a partir de fotos e documentos enviados pelo vistoriador. NUNCA escreva "vistoria presencial realizada", "visita técnica in loco" ou frase equivalente. Se nenhuma foto/documento foi anexado, declare isso expressamente.
- Nunca omita uma amostra excluída do tratamento estatístico — sempre liste e justifique exclusões (elas já vêm prontas no bloco de dados).
- Nunca afirme conformidade normativa absoluta sem ressalva — encerre sempre com o parágrafo de responsabilidade técnica (ver formato de saída).
- Nunca substitua a responsabilidade técnica do profissional habilitado — este documento é uma ferramenta de apoio à engenharia de avaliações.

ESTRUTURA DO DOCUMENTO — siga esta ordem, cada título de seção em UMA LINHA PRÓPRIA, TODO EM MAIÚSCULAS, curto (até ~60 caracteres), sem markdown (nunca use **, #, ou | de tabela):

1. CAPA (título do laudo, endereço do imóvel, data-base)
2. IDENTIFICAÇÃO
3. SOLICITANTE (se não informado, escreva DADO NÃO DISPONÍVEL)
4. FINALIDADE
5. OBJETIVO
6. DATA-BASE
7. IDENTIFICAÇÃO E CARACTERIZAÇÃO DO IMÓVEL
8. DOCUMENTAÇÃO ANALISADA
9. ANÁLISE DOCUMENTAL (divergências, quando houver)
10. VISTORIA E ANÁLISE FOTOGRÁFICA (deixe claro que é análise remota de fotos, nunca vistoria presencial)
11. CARACTERIZAÇÃO DA REGIÃO
12. DIAGNÓSTICO DO MERCADO
13. METODOLOGIA
14. PESQUISA DE MERCADO
15. TABELA DAS AMOSTRAS (liste cada amostra como um bloco de linhas com marcador "-", nunca markdown de tabela com pipes — inclua endereço, tipo, preço, área, R$/m², fonte e o link completo de cada uma)
16. FONTES E LINKS DAS AMOSTRAS (repita todos os links, um por linha)
17. TRATAMENTO DOS DADOS
18. HOMOGENEIZAÇÃO
19. MEMÓRIA DE CÁLCULO (escreva SÓ um parágrafo curto de 1-2 frases explicando o método de cálculo — valor original de cada amostra multiplicado pelos fatores de homogeneização resulta no valor unitário homogeneizado. NÃO liste as amostras uma a uma aqui — o documento final insere uma tabela real logo depois desse parágrafo com os números de cada amostra, então repetir os valores em texto seria redundante)
20. ANÁLISE ESTATÍSTICA
21. DETERMINAÇÃO DO VALOR
22. ANÁLISE DE LIQUIDEZ (classificação e, se possível, prazo estimado de comercialização; nunca confunda valor de mercado com valor de liquidação forçada)
23. CONDIÇÕES LIMITANTES
24. CONCLUSÃO (bloco final com IMÓVEL AVALIANDO, DATA-BASE, FINALIDADE, METODOLOGIA, VALOR DE MERCADO, VALOR UNITÁRIO, LIQUIDEZ, GRAU DE FUNDAMENTAÇÃO, GRAU DE PRECISÃO, CONDIÇÕES LIMITANTES)
25. RESUMO EXECUTIVO DA AVALIAÇÃO (valor de mercado, valor unitário, liquidez, metodologia, quantidade de amostras, principais fatores considerados, principais limitações)
26. FONTES CONSULTADAS (portais imobiliários usados na pesquisa, um por linha)

Ao final, inclua sempre este parágrafo, na íntegra: "Este documento é uma ferramenta de apoio à Engenharia de Avaliações, gerada automaticamente a partir de dados e fotos fornecidos e de pesquisa de mercado real. O resultado deve ser submetido à análise, validação e responsabilidade técnica de um profissional legalmente habilitado antes de qualquer emissão ou assinatura formal."

FORMATO: texto simples, sem markdown. Listas usam "-" no início da linha. Seja técnico, objetivo e completo — não abrevie seções por falta de conteúdo; se faltar dado, escreva DADO NÃO DISPONÍVEL e siga em frente.`

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405)
  }

  const user = await getUserFromRequest(request)
  if (!user) {
    return json({ error: 'Faça login para usar este módulo.' }, 401)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY não configurada no servidor.' }, 500)
  }

  let propertyData: PropertyData
  let resultado: AvaliacaoResultado
  let documentLabels: string[]
  try {
    const body = (await request.json()) as {
      propertyData?: PropertyData
      resultado?: AvaliacaoResultado
      photos?: { label: string }[]
      documents?: { label: string }[]
    }
    if (!body.propertyData || !body.resultado) {
      return json({ error: 'Dados insuficientes para gerar o laudo narrativo.' }, 400)
    }
    propertyData = body.propertyData
    resultado = body.resultado
    documentLabels = [...(body.photos || []), ...(body.documents || [])].map((f) => f.label)
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const dadosTecnicos = formatarDadosTecnicos(propertyData, resultado, documentLabels, hoje)

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `DADOS TÉCNICOS DEFINITIVOS — NÃO ALTERAR:\n\n${dadosTecnicos}\n\nRedija o laudo completo agora, seguindo a estrutura de 26 seções.` }] }],
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: {
          temperature: 0.45,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      // Revertido pra 23s — voltou a ser Edge Function (ver comentário no config acima).
      signal: AbortSignal.timeout(23_000),
    })

    const data = (await geminiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      error?: { message?: string }
    }

    if (!geminiRes.ok) {
      return json({ error: data.error?.message || 'Falha ao consultar o Gemini na geração do laudo narrativo.' }, 502)
    }
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      return json({ error: 'O laudo narrativo ficou grande demais para o modelo nesta tentativa. Tente novamente.' }, 502)
    }

    let texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!texto) {
      return json({ error: 'A IA não retornou o laudo narrativo. Tente novamente.' }, 502)
    }

    // O modelo às vezes usa markdown (**negrito**, # títulos) mesmo instruído a não usar —
    // src/lib/pdf.ts não interpreta markdown, só detecta título por linha em MAIÚSCULAS, então
    // símbolos de markdown apareceriam como caracteres literais no PDF. Mesma limpeza já usada
    // em api/chat.ts pro mesmo problema.
    texto = texto.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/#{1,6}\s*/g, '')

    return json({ texto })
  } catch (err) {
    console.error('[generate-laudo-narrativo] erro ao conectar/processar resposta do Gemini:', String(err))
    return json({ error: 'Não foi possível conectar à API do Gemini na geração do laudo narrativo.' }, 502)
  }
}
