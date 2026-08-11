export type Finalidade = 'Valor de mercado' | 'Valor de garantia'

export interface PropertyData {
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
  // Campos NBR 14653 — só preenchidos e usados no fluxo do Empresa Avaliadora.
  finalidade?: Finalidade
  topografia?: string
  testada?: string
  posicao?: string
  infraestruturaUrbana?: string
  zoneamentoInformado?: string
  ocupacaoUso?: string
}

export function formatEndereco(p: Pick<PropertyData, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf'>): string {
  const line1 = p.complemento ? `${p.logradouro}, ${p.numero} - ${p.complemento}` : `${p.logradouro}, ${p.numero}`
  return `${line1}, ${p.bairro}, ${p.cidade} - ${p.uf}`
}

export type Liquidez = 'Muito Alta' | 'Alta' | 'Normal' | 'Baixa' | 'Muito Baixa'
export type FinanciabilidadeStatus = 'Financiável' | 'Financiável com restrições' | 'Não financiável'
export type IqgClassificacao = 'Premium' | 'Atenção' | 'Inadequada'

/** Reused by the AVM Cliente Final / Reavaliação de Carteiras modules, which don't follow the full NBR 14653 rite. */
export interface Comparavel {
  endereco: string
  distanciaM: number
  areaM2: number
  valor: number
  /** Present only when this comparable came from a real Google Search result (see api/_lib/real-comparaveis.ts); absent for AI-simulated comparables. */
  url?: string
}

export interface Divergencia {
  campo: string
  valorVistoria: string
  valorDocumento: string
  percentual: number
  mensagem: string
}

export const TIPOS_IMOVEL_NBR = [
  'Terreno/lote urbano',
  'Casa residencial',
  'Apartamento',
  'Sobrado',
  'Imóvel comercial',
  'Sala/conjunto comercial',
  'Galpão',
  'Loja',
  'Prédio comercial',
  'Imóvel industrial',
  'Imóvel rural',
  'Empreendimento imobiliário',
  'Outros',
] as const
export type TipoImovelNBR = (typeof TIPOS_IMOVEL_NBR)[number]

export type GrauNBR = 'I' | 'II' | 'III'

export interface FatorHomogeneizacao {
  fator: string
  valor: number
  origem: string
  justificativa: string
  campoAplicacao: string
  abrangenciaRegional: string
  abrangenciaTemporal: string
}

/** Ficha de amostra conforme NBR 14653-2 — cada comparável usado no tratamento por fatores. */
export interface Amostra {
  id: string
  fonte: string
  data: string
  endereco: string
  tipologia: string
  areaM2: number
  valorAnunciado: number
  valorUnitario: number
  dormitorios: number
  suites: number
  banheiros: number
  vagas: number
  padrao: string
  conservacao: string
  idadeAnos: number
  distanciaM: number
  evidencia: string
  /** Presente só quando a amostra veio de uma busca real (ver api/_lib/real-comparaveis.ts). */
  url?: string
  fatoresAplicados: FatorHomogeneizacao[]
  valorUnitarioHomogeneizado: number
}

export interface MetodoAvaliacao {
  metodo: string
  justificativa: string
}

export interface TratamentoEstatistico {
  media: number
  mediana: number
  minimo: number
  maximo: number
  coeficienteVariacao: number
  amplitude: number
  amostrasUtilizadas: number
  amostrasExcluidas: { id: string; motivo: string }[]
}

export interface GrauFundamentacaoItem {
  item: string
  grauAtingido: GrauNBR
  descricao: string
}

export interface GrauFundamentacao {
  itens: GrauFundamentacaoItem[]
  grauFinal: GrauNBR
  justificativa: string
}

export interface GrauPrecisao {
  estimativaPontual: number
  limiteInferior: number
  limiteSuperior: number
  amplitude: number
  grauFinal: GrauNBR
}

export interface ValorFinalNBR {
  valorUnitario: number
  areaAvalianda: number
  valorTotal: number
  intervaloMin: number
  intervaloMax: number
  valorAdotado: number
  justificativaAdocao: string
}

export interface AvaliacaoResultado {
  tipoImovel: TipoImovelNBR
  finalidade: Finalidade
  caracterizacao: {
    padraoConstrutivo: string
    estadoConservacao: string
    patologias: string[]
    descricaoEntorno: string
    zoneamento: string
  }
  metodo: MetodoAvaliacao
  amostras: Amostra[]
  tratamentoEstatistico: TratamentoEstatistico
  parecer: {
    valorMercado: number
    faixaMin: number
    faixaMax: number
    liquidez: Liquidez
    fundamentacao: string
  }
  grauFundamentacao: GrauFundamentacao
  grauPrecisao: GrauPrecisao
  valorFinal: ValorFinalNBR
  descricaoLaudo: string
  /** true quando não foi possível reunir amostras reais suficientes (mínimo técnico: 3) num raio de
   * até 500m do imóvel — o laudo é entregue mesmo assim, mas o valor não deve ser tratado como uma
   * precificação totalmente confiável pelo método comparativo direto. */
  dadosInsuficientes: boolean
  dadosInsuficientesMotivo?: string
  /** Uma entrada para CADA documento/foto anexado na vistoria, confirmando que foi
   * lido e resumindo o que ele mostra — nunca deve faltar um anexo aqui. */
  documentosAnalisados: { label: string; resumo: string }[]
  divergencias: Divergencia[]
  financiabilidade: {
    status: FinanciabilidadeStatus
    motivos: string[]
  }
  iqg: {
    score: number
    classificacao: IqgClassificacao
    fatores: {
      liquidez: number
      conservacao: number
      localizacao: number
      riscoJuridico: number
      riscoAmbiental: number
      riscoDocumental: number
    }
  }
  /** Resumo bruto de TUDO que a busca de amostras encontrou de verdade (todos os tipos de
   * imóvel, não só os usados no cálculo) — transparência pedida explicitamente pelo usuário,
   * pra poder ver quantos imóveis reais existem na região mesmo os que não viram amostra por
   * serem de tipo incompatível com o avaliando. Calculado no front-end, opcional (ausente em
   * laudos revisados via chat, que não refazem a busca). */
  buscaResumo?: { total: number; porTipo: Record<string, number> }
}

export interface AvaliacaoCase {
  caseId: string
  propertyData: PropertyData
  photoUrls: { label: string; url: string }[]
  documentUrls: { label: string; url: string }[]
  resultado?: AvaliacaoResultado
  approvedAt?: string
  adjustments?: Partial<AvaliacaoResultado['parecer']>
}
