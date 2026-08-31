import { SaldoInsuficienteError } from '../errors'

export interface LancamentoCalculado {
  tipo: 'CREDITO' | 'DEBITO'
  valorCentavos: number
  saldoAposCentavos: number
}

function validarValorCentavos(valorCentavos: number): void {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    throw new RangeError(
      `Valor em centavos deve ser um inteiro positivo, recebido: ${valorCentavos}`,
    )
  }
}

export function aplicarCredito(
  saldoAtualCentavos: number,
  valorCentavos: number,
): LancamentoCalculado {
  validarValorCentavos(valorCentavos)
  return {
    tipo: 'CREDITO',
    valorCentavos,
    saldoAposCentavos: saldoAtualCentavos + valorCentavos,
  }
}

export function aplicarDebito(
  saldoAtualCentavos: number,
  valorCentavos: number,
): LancamentoCalculado {
  validarValorCentavos(valorCentavos)
  if (valorCentavos > saldoAtualCentavos) {
    throw new SaldoInsuficienteError(
      `Saldo insuficiente: saldo atual de ${saldoAtualCentavos} centavos é menor que o débito de ${valorCentavos} centavos`,
    )
  }
  return {
    tipo: 'DEBITO',
    valorCentavos,
    saldoAposCentavos: saldoAtualCentavos - valorCentavos,
  }
}
