import { CepInvalidoError } from '../errors'

export function normalizarCep(entrada: string): string {
  const trimado = entrada.trim()
  if (!/^\d{5}-?\d{3}$/.test(trimado)) {
    throw new CepInvalidoError(`CEP inválido: ${entrada}`)
  }
  return trimado.replace('-', '')
}

export function cepParaNumero(cep: string): number {
  return Number(normalizarCep(cep))
}
