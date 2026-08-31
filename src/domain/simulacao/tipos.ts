/**
 * Tipos do motor de simulação de transporte.
 *
 * Ver docs/superpowers/specs/2026-08-31-simulacao-transporte.md.
 * Os literais espelham os enums do Prisma (CenarioSimulacao) e o campo
 * `codigo` de TrackingEvent, mas ficam declarados aqui para que o domínio
 * não dependa do cliente gerado.
 */

export type CenarioSimulacao =
  | 'ENTREGA_NORMAL'
  | 'ATRASO'
  | 'TENTATIVA_FALHA'
  | 'EXTRAVIO'
  | 'DEVOLUCAO'

export type CodigoEvento =
  | 'ETIQUETA_EMITIDA'
  | 'POSTADO'
  | 'TRANSFERENCIA'
  | 'AGUARDANDO_TRATAMENTO'
  | 'SAIU_PARA_ENTREGA'
  | 'TENTATIVA_FRUSTRADA'
  | 'AGUARDANDO_RETIRADA'
  | 'ENTREGUE'
  | 'EXTRAVIADO'
  | 'DEVOLUCAO_INICIADA'
  | 'DEVOLVIDO'

export interface LocalidadeSimulacao {
  cidade: string
  uf: string
}

export interface EntradaRoteiro {
  cenario: CenarioSimulacao
  /** Prazo do serviço em dias úteis. Escala todos os offsets. */
  prazoDias: number
  origem: LocalidadeSimulacao
  destino: LocalidadeSimulacao
  /** Nome do operador nas unidades. Neutro por padrão — nunca "DOS CORREIOS". */
  operador?: string
}

export interface EventoRoteiro {
  sequencia: number
  offsetMinutos: number
  codigo: CodigoEvento
  titulo: string
  descricao: string
  unidadeOrigem: string | null
  unidadeDestino: string | null
  cidade: string
  uf: string
}
