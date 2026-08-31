import { describe, expect, it } from 'vitest'
import {
  SEQUENCIAL_MAXIMO,
  calcularDigitoVerificador,
  montarCodigoRastreio,
  prefixoDoServico,
  validarCodigoRastreio,
} from './codigo-rastreio'
import { CodigoRastreioInvalidoError } from '../errors'

describe('calcularDigitoVerificador', () => {
  it('aplica os pesos 8,6,4,2,3,5,9,7 e devolve 11 menos o resto da divisão por 11', () => {
    // 1*8 + 2*6 + 3*4 + 4*2 + 5*3 + 6*5 + 7*9 + 8*7 = 8+12+12+8+15+30+63+56 = 204
    // 204 % 11 = 6 → dígito = 11 - 6 = 5
    expect(calcularDigitoVerificador('12345678')).toBe(5)
  })

  it('devolve 5 quando o resto é 0 e 0 quando o resto é 1, conforme a convenção módulo 11', () => {
    // Busca exaustiva pelos dois casos de exceção, para não depender de
    // constantes mágicas que ninguém consegue conferir de cabeça.
    const pesos = [8, 6, 4, 2, 3, 5, 9, 7]
    const resto = (digitos: string): number =>
      pesos.reduce((soma, peso, i) => soma + Number(digitos.charAt(i)) * peso, 0) % 11

    let comResto0: string | null = null
    let comResto1: string | null = null
    for (let n = 0; n < 100000 && (!comResto0 || !comResto1); n += 1) {
      const digitos = String(n).padStart(8, '0')
      const r = resto(digitos)
      if (r === 0 && !comResto0) comResto0 = digitos
      if (r === 1 && !comResto1) comResto1 = digitos
    }

    expect(calcularDigitoVerificador(comResto0!)).toBe(5)
    expect(calcularDigitoVerificador(comResto1!)).toBe(0)
  })

  it('recusa entrada que não sejam exatamente 8 dígitos', () => {
    expect(() => calcularDigitoVerificador('1234567')).toThrow(CodigoRastreioInvalidoError)
    expect(() => calcularDigitoVerificador('123456789')).toThrow(CodigoRastreioInvalidoError)
    expect(() => calcularDigitoVerificador('1234567a')).toThrow(CodigoRastreioInvalidoError)
  })
})

describe('montarCodigoRastreio', () => {
  it('monta prefixo + 8 dígitos com zero à esquerda + dígito verificador + BR', () => {
    const codigo = montarCodigoRastreio('EC', 1)
    expect(codigo).toBe(`EC00000001${calcularDigitoVerificador('00000001')}BR`)
    expect(codigo).toHaveLength(13)
  })

  it('gera códigos que passam na própria validação, para qualquer sequencial', () => {
    for (const sequencial of [1, 2, 9, 42, 12345678, SEQUENCIAL_MAXIMO]) {
      expect(validarCodigoRastreio(montarCodigoRastreio('EC', sequencial))).toBe(true)
    }
  })

  it('gera códigos distintos para sequenciais distintos', () => {
    const codigos = new Set(
      Array.from({ length: 500 }, (_, i) => montarCodigoRastreio('EC', i + 1)),
    )
    expect(codigos.size).toBe(500)
  })

  it('normaliza o prefixo para maiúsculas', () => {
    expect(montarCodigoRastreio('ec', 1)).toBe(montarCodigoRastreio('EC', 1))
  })

  it('recusa prefixo que não seja duas letras', () => {
    expect(() => montarCodigoRastreio('E', 1)).toThrow(CodigoRastreioInvalidoError)
    expect(() => montarCodigoRastreio('ECO', 1)).toThrow(CodigoRastreioInvalidoError)
    expect(() => montarCodigoRastreio('E1', 1)).toThrow(CodigoRastreioInvalidoError)
  })

  it('recusa sequencial fora da faixa representável em 8 dígitos', () => {
    expect(() => montarCodigoRastreio('EC', 0)).toThrow(CodigoRastreioInvalidoError)
    expect(() => montarCodigoRastreio('EC', -1)).toThrow(CodigoRastreioInvalidoError)
    expect(() => montarCodigoRastreio('EC', 1.5)).toThrow(CodigoRastreioInvalidoError)
    expect(() => montarCodigoRastreio('EC', SEQUENCIAL_MAXIMO + 1)).toThrow(
      CodigoRastreioInvalidoError,
    )
  })
})

describe('validarCodigoRastreio', () => {
  it('aceita um código bem formado com dígito verificador correto', () => {
    expect(validarCodigoRastreio('EC000000014BR')).toBe(true)
  })

  it('recusa código com dígito verificador trocado', () => {
    const valido = montarCodigoRastreio('EC', 1)
    const digitoErrado = String((Number(valido[10]) + 1) % 10)
    expect(validarCodigoRastreio(`${valido.slice(0, 10)}${digitoErrado}BR`)).toBe(false)
  })

  it('detecta erro de digitação em um dígito do sequencial, exceto na ambiguidade conhecida do dígito 5', () => {
    // O módulo 11 mapeia resto 0 e resto 6 para o mesmo dígito verificador
    // (5), então um erro que leve de um resto ao outro passa despercebido.
    // É a única brecha do algoritmo, e o teste a fixa explicitamente: se
    // alguma outra classe de erro começar a passar, este teste quebra.
    let verificados = 0
    let escaparam = 0

    for (const sequencial of [1, 4242, 12345678, 99999999]) {
      const valido = montarCodigoRastreio('EC', sequencial)
      for (let posicao = 2; posicao < 10; posicao += 1) {
        for (let delta = 1; delta <= 9; delta += 1) {
          const trocado =
            valido.slice(0, posicao) +
            String((Number(valido[posicao]) + delta) % 10) +
            valido.slice(posicao + 1)
          verificados += 1
          if (validarCodigoRastreio(trocado)) {
            escaparam += 1
            expect(trocado[10]).toBe('5')
          }
        }
      }
    }

    // A brecha vale ~1/11 dos erros de um dígito, o limite teórico do
    // módulo 11. Acima disso, o algoritmo regrediu.
    expect(verificados).toBeGreaterThan(0)
    expect(escaparam / verificados).toBeLessThan(0.1)
  })

  it('recusa formato inválido sem estourar', () => {
    for (const invalido of ['', 'EC1BR', 'ECO00000015BR', 'EC000000015XX', '0C000000015BR']) {
      expect(validarCodigoRastreio(invalido)).toBe(false)
    }
  })
})

describe('prefixoDoServico', () => {
  it('usa as duas primeiras letras do código do serviço, em maiúsculas', () => {
    expect(prefixoDoServico('ECONOMICO')).toBe('EC')
    expect(prefixoDoServico('rapido')).toBe('RA')
    expect(prefixoDoServico('EXPRESSO')).toBe('EX')
  })

  it('cai no prefixo padrão quando o código do serviço não começa com duas letras', () => {
    expect(prefixoDoServico('1X')).toBe('FR')
    expect(prefixoDoServico('E')).toBe('FR')
    expect(prefixoDoServico('')).toBe('FR')
  })

  it('ignora acentos e separadores ao derivar o prefixo', () => {
    expect(prefixoDoServico('ÉCONOMICO')).toBe('EC')
    expect(prefixoDoServico('e-conomico')).toBe('EC')
  })
})
