import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  impressaoDigitalCpf,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefoneLead,
} from './identidade'

describe('normalizarCpf', () => {
  it('tira máscara e devolve só dígitos', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725')
  })

  it('recusa o que não tem onze dígitos', () => {
    expect(normalizarCpf('123')).toBeNull()
    expect(normalizarCpf('')).toBeNull()
    expect(normalizarCpf(null)).toBeNull()
  })
})

describe('normalizarTelefoneLead', () => {
  it('trata o mesmo número com e sem DDI como um só', () => {
    // É o defeito que duplicaria o lead: a conversa do WhatsApp chega com
    // DDI e o pedido da loja chega sem.
    expect(normalizarTelefoneLead('(21) 99999-0001')).toBe('21999990001')
    expect(normalizarTelefoneLead('5521999990001')).toBe('21999990001')
  })

  it('recusa número curto demais para ser telefone', () => {
    expect(normalizarTelefoneLead('999')).toBeNull()
    expect(normalizarTelefoneLead(undefined)).toBeNull()
  })
})

describe('normalizarEmail', () => {
  it('ignora caixa e espaço nas pontas', () => {
    expect(normalizarEmail('  Maria@Exemplo.COM ')).toBe('maria@exemplo.com')
  })

  it('recusa o que não parece e-mail', () => {
    expect(normalizarEmail('maria')).toBeNull()
    expect(normalizarEmail('')).toBeNull()
  })
})

describe('impressaoDigitalCpf', () => {
  it('é determinística: mesma entrada, mesma saída', () => {
    expect(impressaoDigitalCpf('52998224725')).toBe(impressaoDigitalCpf('52998224725'))
  })

  it('entradas diferentes dão saídas diferentes', () => {
    expect(impressaoDigitalCpf('52998224725')).not.toBe(impressaoDigitalCpf('52998224726'))
  })

  it('não é um SHA-256 puro do CPF', () => {
    /*
      A prova de que o segredo entra no cálculo. Se a impressão digital fosse
      apenas `sha256(cpf)`, quem roubasse o banco testaria o bilhão de CPFs
      válidos em segundos e teria todos de volta em claro.
    */
    const shaPuro = createHash('sha256').update('52998224725').digest('hex')
    expect(impressaoDigitalCpf('52998224725')).not.toBe(shaPuro)
  })
})
