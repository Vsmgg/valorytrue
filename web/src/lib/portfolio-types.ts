import type { Liquidez, IqgClassificacao } from '@/lib/avaliacao-types'

export interface ImovelCarteira {
  linha: number
  endereco: string
  cidade: string
  uf: string
  tipo: string
  areaM2: number
  valorAtual?: number
}

export interface ResultadoCarteira {
  linha: number
  valorEstimado: number
  liquidez: Liquidez
  iqgScore: number
  classificacaoIqg: IqgClassificacao
}
