import type { Comparavel, FinanciabilidadeStatus, Liquidez } from '@/lib/avaliacao-types'

export interface DivergenciaAvm {
  campo: string
  valorInformado: string
  valorDocumento: string
  percentual: number
  mensagem: string
}

export interface AvmResultado {
  valorMercado: number
  faixaMin: number
  faixaMax: number
  liquidez: Liquidez
  comparaveis: Comparavel[]
  fundamentacao: string
  dadosInsuficientes: boolean
  dadosInsuficientesMotivo?: string
  divergencias: DivergenciaAvm[]
  financiabilidade: {
    status: FinanciabilidadeStatus
    motivos: string[]
  }
  fatoresConsiderados: string[]
  orientacaoCredito: {
    ltvMaximoRecomendado: number
    texto: string
  }
}
