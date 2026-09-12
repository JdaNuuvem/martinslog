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

  it('recusa dia que não existe no mês, em vez de rolar para o mês seguinte', () => {
    expect(dataDoParametro('2026-02-30')).toBeUndefined()
    expect(dataDoParametro('2026-04-31')).toBeUndefined()
    expect(dataDoParametro('2026-02-29')).toBeUndefined()
  })

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(dataDoParametro('2028-02-29')?.toISOString()).toBe('2028-02-29T03:00:00.000Z')
  })
})
