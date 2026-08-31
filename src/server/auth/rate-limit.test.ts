import { beforeEach, describe, expect, it } from 'vitest'
import { limiteExcedido, limparPorEmail, limparRateLimit, registrarFalha, registrarTentativa } from './rate-limit'

beforeEach(() => {
  limparRateLimit()
})

describe('registrarTentativa', () => {
  it('permite até 5 tentativas e bloqueia a 6ª pelo mesmo e-mail', () => {
    const email = 'alguem@teste.com'
    for (let i = 0; i < 5; i += 1) {
      expect(registrarTentativa('escopo', `10.0.0.${i}`, email)).toBe(true)
    }
    expect(registrarTentativa('escopo', '10.0.0.99', email)).toBe(false)
  })

  it('bloqueia pelo mesmo IP mesmo com e-mails diferentes', () => {
    const ip = '10.0.0.1'
    for (let i = 0; i < 5; i += 1) {
      expect(registrarTentativa('escopo', ip, `email-${i}@teste.com`)).toBe(true)
    }
    expect(registrarTentativa('escopo', ip, 'mais-um@teste.com')).toBe(false)
  })
})

describe('limiteExcedido / registrarFalha / limparPorEmail (IMP-3)', () => {
  it('limiteExcedido não consome cota (chamar várias vezes não bloqueia sozinho)', () => {
    const email = 'peek@teste.com'
    for (let i = 0; i < 10; i += 1) {
      expect(limiteExcedido('login', '10.0.0.1', email)).toBe(false)
    }
  })

  it('registrarFalha consome cota; a 6ª falha fica bloqueada', () => {
    const email = 'falhas@teste.com'
    for (let i = 0; i < 5; i += 1) {
      expect(limiteExcedido('login', '10.0.0.1', email)).toBe(false)
      registrarFalha('login', '10.0.0.1', email)
    }
    expect(limiteExcedido('login', '10.0.0.1', email)).toBe(true)
  })

  it('limparPorEmail zera apenas o contador de e-mail, permitindo novas tentativas para aquele e-mail', () => {
    const email = 'zera@teste.com'
    for (let i = 0; i < 5; i += 1) {
      registrarFalha('login', `10.0.1.${i}`, email)
    }
    expect(limiteExcedido('login', '10.0.1.99', email)).toBe(true)

    limparPorEmail('login', email)

    // Com um IP novo (nunca usado antes), o e-mail recém-zerado não está
    // mais no limite.
    expect(limiteExcedido('login', '10.0.2.1', email)).toBe(false)

    // A partir daqui, uma nova sequência de 5 falhas volta a ser permitida
    // e a 6ª volta a ser bloqueada — prova de que o contador reiniciou do
    // zero, e não apenas "descontou uma".
    for (let i = 0; i < 5; i += 1) {
      expect(limiteExcedido('login', `10.0.3.${i}`, email)).toBe(false)
      registrarFalha('login', `10.0.3.${i}`, email)
    }
    expect(limiteExcedido('login', '10.0.3.99', email)).toBe(true)
  })
})
