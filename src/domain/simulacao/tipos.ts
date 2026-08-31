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

/**
 * Etapa criada por uma conta, encaixada no roteiro pela fração do prazo.
 * Ver `src/domain/rastreio/catalogo-status.ts`.
 */
export interface EtapaExtraRoteiro {
  fracao: number
  /** Posição em dias após a emissão. Preenchida, ignora `fracao`. */
  dias?: number
  codigo: string
  titulo: string
  descricao: string
  cenario: CenarioSimulacao
  statusResultante: string
}

export interface EntradaRoteiro {
  cenario: CenarioSimulacao
  /** Prazo do serviço em dias úteis. Escala todos os offsets. */
  prazoDias: number
  origem: LocalidadeSimulacao
  destino: LocalidadeSimulacao
  /** Nome do operador nas unidades. Neutro por padrão — nunca "DOS CORREIOS". */
  operador?: string
  /**
   * Sobrescreve título e descrição por código. Ausente, valem os textos
   * padrão — o comportamento de quem nunca personalizou nada.
   */
  textos?: Readonly<Record<string, { titulo: string; descricao: string }>>
  /** Etapas da conta, fundidas nas do cenário pela fração do prazo. */
  etapasExtras?: readonly EtapaExtraRoteiro[]
  /**
   * Reposiciona, em dias após a emissão, as etapas que o motor gera sozinho.
   * É o que permite "muda de status a cada X dias" sem tocar nos cenários.
   */
  posicoesDias?: Readonly<Record<string, number>>
}

export interface EventoRoteiro {
  sequencia: number
  offsetMinutos: number
  /** `CodigoEvento` para as etapas padrão; livre para as criadas pela conta. */
  codigo: string
  titulo: string
  descricao: string
  unidadeOrigem: string | null
  unidadeDestino: string | null
  cidade: string
  uf: string
}
