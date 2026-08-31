import { describe, expect, it } from 'vitest'
import { calcularPesoCubadoG, calcularPesoTaxavelG, DimensoesInvalidasError } from './cubagem'

describe('calcularPesoCubadoG', () => {
  it('usa o divisor 6000 e devolve gramas inteiras', () => {
    // 4 x 12 x 18 = 864 cm3 -> 864/6000 = 0,144 kg -> 144 g
    expect(calcularPesoCubadoG({ alturaCm: 4, larguraCm: 12, comprimentoCm: 18 })).toBe(144)
  })

  it('arredonda para cima', () => {
    // 10 x 10 x 10 = 1000 -> 1000/6000 = 0,1666... kg -> 167 g
    expect(calcularPesoCubadoG({ alturaCm: 10, larguraCm: 10, comprimentoCm: 10 })).toBe(167)
  })

  it('rejeita dimensão zero ou negativa', () => {
    expect(() => calcularPesoCubadoG({ alturaCm: 0, larguraCm: 10, comprimentoCm: 10 }))
      .toThrow(DimensoesInvalidasError)
    expect(() => calcularPesoCubadoG({ alturaCm: -1, larguraCm: 10, comprimentoCm: 10 }))
      .toThrow(DimensoesInvalidasError)
  })
})

describe('calcularPesoTaxavelG', () => {
  it('cobra o maior entre real e cubado', () => {
    expect(calcularPesoTaxavelG(300, 144)).toBe(300)
    expect(calcularPesoTaxavelG(100, 144)).toBe(144)
  })
})
