import { describe, expect, it } from 'vitest'
import { cepParaNumero, normalizarCep } from './cep'
import { CepInvalidoError } from '../errors'

describe('normalizarCep', () => {
  it('remove hífen e espaços', () => {
    expect(normalizarCep('01001-000')).toBe('01001000')
    expect(normalizarCep(' 01001000 ')).toBe('01001000')
  })

  it('rejeita CEP com tamanho errado', () => {
    expect(() => normalizarCep('123')).toThrow(CepInvalidoError)
    expect(() => normalizarCep('010010000')).toThrow(CepInvalidoError)
  })

  it('rejeita CEP com letra', () => {
    expect(() => normalizarCep('0100100A')).toThrow(CepInvalidoError)
  })

  it('rejeita entrada malformada com dígitos suficientes no meio', () => {
    expect(() => normalizarCep('0100-100A0')).toThrow(CepInvalidoError)
  })

  it('rejeita string vazia', () => {
    expect(() => normalizarCep('')).toThrow(CepInvalidoError)
  })

  it('rejeita oito caracteres sem dígito nenhum', () => {
    expect(() => normalizarCep('abcdefgh')).toThrow(CepInvalidoError)
  })

  it('rejeita espaço no meio', () => {
    expect(() => normalizarCep('0100 1000')).toThrow(CepInvalidoError)
  })

  it('retorna CEP sem hífen quando entrada é válida', () => {
    expect(normalizarCep('01001000')).toBe('01001000')
  })
})

describe('cepParaNumero', () => {
  it('preserva a ordem numérica com zeros à esquerda', () => {
    expect(cepParaNumero('01001000')).toBe(1001000)
    expect(cepParaNumero('20040002')).toBe(20040002)
    expect(cepParaNumero('01001000') < cepParaNumero('20040002')).toBe(true)
  })
})
