import { describe, expect, it } from 'vitest'
import {
  ATRASOS_MINUTOS,
  MAXIMO_TENTATIVAS,
  deveRetentar,
  proximaTentativaEm,
} from './retentativa'

const AGORA = new Date('2026-08-31T12:00:00Z')

describe('proximaTentativaEm', () => {
  it('segue a escala 1min, 5min, 30min, 2h, 12h', () => {
    expect(ATRASOS_MINUTOS).toEqual([1, 5, 30, 120, 720])
  })

  it('agenda a partir do instante da falha, na posição da tentativa', () => {
    const primeira = proximaTentativaEm(1, AGORA)
    const terceira = proximaTentativaEm(3, AGORA)

    expect(primeira?.toISOString()).toBe('2026-08-31T12:01:00.000Z')
    expect(terceira?.toISOString()).toBe('2026-08-31T12:30:00.000Z')
  })

  it('agenda as cinco reentregas e desiste depois delas', () => {
    // A primeira tentativa é imediata; as cinco seguintes são reagendadas.
    expect(proximaTentativaEm(ATRASOS_MINUTOS.length, AGORA)?.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
    expect(proximaTentativaEm(MAXIMO_TENTATIVAS, AGORA)).toBeNull()
    expect(proximaTentativaEm(MAXIMO_TENTATIVAS + 3, AGORA)).toBeNull()
  })

  it('a janela total passa de catorze horas antes da desistência', () => {
    const total = ATRASOS_MINUTOS.reduce((soma, minutos) => soma + minutos, 0)

    expect(MAXIMO_TENTATIVAS).toBe(6)
    expect(total).toBe(876)
  })
})

describe('deveRetentar', () => {
  it('retenta em erro de rede, sem status HTTP', () => {
    expect(deveRetentar(null)).toBe(true)
  })

  it('retenta em erro do servidor do cliente e em 429', () => {
    for (const status of [500, 502, 503, 504, 429]) {
      expect(deveRetentar(status), String(status)).toBe(true)
    }
  })

  it('não retenta quando a entrega foi aceita', () => {
    for (const status of [200, 201, 202, 204]) {
      expect(deveRetentar(status), String(status)).toBe(false)
    }
  })

  it('não retenta em erro do cliente — repetir não conserta URL ou rota errada', () => {
    for (const status of [400, 401, 403, 404, 410, 422]) {
      expect(deveRetentar(status), String(status)).toBe(false)
    }
  })

  it('retenta em 408, que é tempo esgotado e pode passar', () => {
    expect(deveRetentar(408)).toBe(true)
  })
})
