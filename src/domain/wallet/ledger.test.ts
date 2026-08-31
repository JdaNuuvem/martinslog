import { describe, expect, it } from 'vitest'
import { aplicarCredito, aplicarDebito } from './ledger'
import { SaldoInsuficienteError, ValorInvalidoError } from '../errors'

describe('aplicarDebito', () => {
  it('reduz o saldo', () => {
    expect(aplicarDebito(10000, 1416)).toEqual({
      tipo: 'DEBITO', valorCentavos: 1416, saldoAposCentavos: 8584,
    })
  })

  it('permite zerar o saldo exatamente', () => {
    expect(aplicarDebito(1416, 1416).saldoAposCentavos).toBe(0)
  })

  it('recusa débito maior que o saldo', () => {
    expect(() => aplicarDebito(1000, 1416)).toThrow(SaldoInsuficienteError)
  })

  it('recusa valor zero ou negativo', () => {
    expect(() => aplicarDebito(1000, 0)).toThrow(ValorInvalidoError)
    expect(() => aplicarDebito(1000, -5)).toThrow(ValorInvalidoError)
  })

  it('recusa valor não inteiro', () => {
    expect(() => aplicarDebito(1000, 14.16)).toThrow(ValorInvalidoError)
  })

  it('recusa valor NaN', () => {
    expect(() => aplicarDebito(1000, NaN)).toThrow(ValorInvalidoError)
  })

  it('recusa valor Infinity ou -Infinity', () => {
    expect(() => aplicarDebito(1000, Infinity)).toThrow(ValorInvalidoError)
    expect(() => aplicarDebito(1000, -Infinity)).toThrow(ValorInvalidoError)
  })
})

describe('aplicarCredito', () => {
  it('aumenta o saldo', () => {
    expect(aplicarCredito(0, 10000).saldoAposCentavos).toBe(10000)
  })

  it('recusa valor zero, negativo, não inteiro, NaN, Infinity ou -Infinity', () => {
    expect(() => aplicarCredito(1000, 0)).toThrow(ValorInvalidoError)
    expect(() => aplicarCredito(1000, -5)).toThrow(ValorInvalidoError)
    expect(() => aplicarCredito(1000, 14.16)).toThrow(ValorInvalidoError)
    expect(() => aplicarCredito(1000, NaN)).toThrow(ValorInvalidoError)
    expect(() => aplicarCredito(1000, Infinity)).toThrow(ValorInvalidoError)
    expect(() => aplicarCredito(1000, -Infinity)).toThrow(ValorInvalidoError)
  })
})
