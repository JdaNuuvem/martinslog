import { describe, expect, it } from 'vitest'
import { normalizarDocumento, validarCnpj, validarCpf } from './documento'

describe('validarCpf', () => {
  it('aceita CPFs válidos reais', () => {
    expect(validarCpf('52998224725')).toBe(true)
    expect(validarCpf('11144477735')).toBe(true)
  })

  it('aceita CPF válido formatado com máscara', () => {
    expect(validarCpf('529.982.247-25')).toBe(true)
  })

  it('rejeita CPF com todos os dígitos repetidos', () => {
    expect(validarCpf('11111111111')).toBe(false)
    expect(validarCpf('00000000000')).toBe(false)
  })

  it('rejeita CPF com dígito verificador errado', () => {
    expect(validarCpf('52998224726')).toBe(false)
  })

  it('rejeita CPF com tamanho incorreto', () => {
    expect(validarCpf('123456789')).toBe(false)
    expect(validarCpf('')).toBe(false)
  })
})

describe('validarCnpj', () => {
  it('aceita CNPJ válido real', () => {
    expect(validarCnpj('11444777000161')).toBe(true)
  })

  it('aceita CNPJ válido formatado com máscara', () => {
    expect(validarCnpj('11.444.777/0001-61')).toBe(true)
  })

  it('rejeita CNPJ com todos os dígitos repetidos', () => {
    expect(validarCnpj('11111111111111')).toBe(false)
    expect(validarCnpj('00000000000000')).toBe(false)
  })

  it('rejeita CNPJ com dígito verificador errado', () => {
    expect(validarCnpj('11444777000162')).toBe(false)
  })

  it('rejeita CNPJ com tamanho incorreto', () => {
    expect(validarCnpj('123')).toBe(false)
  })
})

describe('normalizarDocumento', () => {
  it('remove máscara e mantém apenas dígitos', () => {
    expect(normalizarDocumento('529.982.247-25')).toBe('52998224725')
    expect(normalizarDocumento('11.444.777/0001-61')).toBe('11444777000161')
  })

  it('mantém documento já normalizado inalterado', () => {
    expect(normalizarDocumento('52998224725')).toBe('52998224725')
  })
})
