import { CepInvalidoError } from '../errors'

export function normalizarCep(entrada: string): string {
  const limpo = entrada.replace(/\D/g, '')
  if (limpo.length !== 8) {
    throw new CepInvalidoError(`CEP inválido: ${entrada}`)
  }
  return limpo
}

export function cepParaNumero(cep: string): number {
  return Number(normalizarCep(cep))
}
