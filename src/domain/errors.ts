export abstract class DomainError extends Error {
  abstract readonly codigo: string
  constructor(mensagem: string) {
    super(mensagem)
    this.name = new.target.name
  }
}

export class DimensoesInvalidasError extends DomainError {
  readonly codigo = 'DIMENSOES_INVALIDAS'
}
export class PesoInvalidoError extends DomainError {
  readonly codigo = 'PESO_INVALIDO'
}
export class RotaNaoAtendidaError extends DomainError {
  readonly codigo = 'ROTA_NAO_ATENDIDA'
}
export class CepInvalidoError extends DomainError {
  readonly codigo = 'CEP_INVALIDO'
}
export class SaldoInsuficienteError extends DomainError {
  readonly codigo = 'SALDO_INSUFICIENTE'
}
export class TransicaoInvalidaError extends DomainError {
  readonly codigo = 'TRANSICAO_INVALIDA'
}
export class CotacaoExpiradaError extends DomainError {
  readonly codigo = 'COTACAO_EXPIRADA'
}
export class CancelamentoNaoPermitidoError extends DomainError {
  readonly codigo = 'CANCELAMENTO_NAO_PERMITIDO'
}
export class CarteiraNaoEncontradaError extends DomainError {
  readonly codigo = 'CARTEIRA_NAO_ENCONTRADA'
}
export class NaoAutorizadoError extends DomainError {
  readonly codigo = 'NAO_AUTORIZADO'
}
