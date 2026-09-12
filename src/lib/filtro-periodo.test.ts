import { describe, expect, it } from 'vitest'
import { dataDoParametro } from './filtro-periodo'

describe('dataDoParametro', () => {
  it('lê o início do dia no fuso de Brasília', () => {
    expect(dataDoParametro('2026-09-30')?.toISOString()).toBe('2026-09-30T03:00:00.000Z')
  })

  it('com fimDoDia, inclui o próprio dia inteiro', () => {
    expect(dataDoParametro('2026-09-30', true)?.toISOString()).toBe('2026-10-01T02:59:59.999Z')
  })

  it('ignora valor ausente, fora do formato ou impossível', () => {
    expect(dataDoParametro(null)).toBeUndefined()
    expect(dataDoParametro('')).toBeUndefined()
    expect(dataDoParametro('30/09/2026')).toBeUndefined()
    expect(dataDoParametro('2026-13-45')).toBeUndefined()
  })
})
