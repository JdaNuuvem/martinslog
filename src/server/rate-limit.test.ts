import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumirCota, limparCotas, type PoliticaCota } from './rate-limit'

const politica: PoliticaCota = { escopo: 'teste', limite: 3, janelaMs: 60_000 }

afterEach(() => {
  limparCotas()
  vi.useRealTimers()
})

describe('consumirCota', () => {
  it('permite até o limite e bloqueia a partir dele', () => {
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(true)
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(true)
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(true)
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(false)
  })

  it('conta cada identificador separadamente', () => {
    for (let i = 0; i < 3; i += 1) {
      consumirCota(politica, '10.0.0.1')
    }

    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(false)
    expect(consumirCota(politica, '10.0.0.2').permitido).toBe(true)
  })

  it('conta cada escopo separadamente', () => {
    for (let i = 0; i < 3; i += 1) {
      consumirCota(politica, '10.0.0.1')
    }

    expect(consumirCota({ ...politica, escopo: 'outro' }, '10.0.0.1').permitido).toBe(true)
  })

  it('informa quanto resta e quando a janela reabre', () => {
    const primeiro = consumirCota(politica, '10.0.0.1')

    expect(primeiro.restante).toBe(2)
    expect(primeiro.reabreEmSegundos).toBe(60)
    expect(consumirCota(politica, '10.0.0.1').restante).toBe(1)
  })

  it('não deixa o contador negativo depois do bloqueio', () => {
    for (let i = 0; i < 6; i += 1) {
      consumirCota(politica, '10.0.0.1')
    }

    expect(consumirCota(politica, '10.0.0.1').restante).toBe(0)
  })

  it('reabre a cota quando a janela expira', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))

    for (let i = 0; i < 3; i += 1) {
      consumirCota(politica, '10.0.0.1')
    }
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(false)

    vi.setSystemTime(new Date('2026-08-31T12:01:01Z'))
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(true)
  })

  it('insistir durante o bloqueio não adianta a reabertura', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))

    for (let i = 0; i < 3; i += 1) {
      consumirCota(politica, '10.0.0.1')
    }

    vi.setSystemTime(new Date('2026-08-31T12:00:30Z'))
    consumirCota(politica, '10.0.0.1')

    vi.setSystemTime(new Date('2026-08-31T12:00:59Z'))
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(false)

    vi.setSystemTime(new Date('2026-08-31T12:01:01Z'))
    expect(consumirCota(politica, '10.0.0.1').permitido).toBe(true)
  })
})
