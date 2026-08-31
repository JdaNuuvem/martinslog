import { DimensoesInvalidasError } from '../errors'

export type Dimensoes = { alturaCm: number; larguraCm: number; comprimentoCm: number }

const DIVISOR_CUBAGEM = 6000

export function calcularPesoCubadoG({ alturaCm, larguraCm, comprimentoCm }: Dimensoes): number {
  for (const valor of [alturaCm, larguraCm, comprimentoCm]) {
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new DimensoesInvalidasError('Altura, largura e comprimento devem ser maiores que zero.')
    }
  }
  const volumeCm3 = alturaCm * larguraCm * comprimentoCm
  return Math.ceil((volumeCm3 / DIVISOR_CUBAGEM) * 1000)
}

export function calcularPesoTaxavelG(pesoRealG: number, pesoCubadoG: number): number {
  return Math.max(pesoRealG, pesoCubadoG)
}

export { DimensoesInvalidasError } from '../errors'
