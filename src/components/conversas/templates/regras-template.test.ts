import { describe, expect, it } from 'vitest'
import {
  moverTemplate,
  normalizarAtalho,
  previaComExemplos,
  validarTemplate,
  variaveisDesconhecidas,
} from './regras-template'

describe('regras de template', () => {
  it('prévia troca variáveis conhecidas e preserva as desconhecidas', () => {
    expect(previaComExemplos('Oi {{cliente}}, código {{ codigo_rastreio }} {{outra}}')).toBe(
      'Oi Maria, código ML123456789BR {{outra}}',
    )
  })

  it('aponta variável escrita errado', () => {
    expect(variaveisDesconhecidas('{{cliente}} {{codigo-rastreio}} {{codigo-rastreio}}')).toEqual([
      'codigo-rastreio',
    ])
  })

  it('atalho perde a barra e vira minúsculo; vazio vira null', () => {
    expect(normalizarAtalho(' /Rastreio ')).toBe('rastreio')
    expect(normalizarAtalho('  ')).toBeNull()
  })

  it('valida título, atalho com espaço, atalho repetido e texto', () => {
    expect(validarTemplate({ titulo: '', atalho: 'meu atalho', texto: '' }, [])).toEqual({
      titulo: expect.any(String),
      atalho: expect.stringContaining('sem espaços'),
      texto: expect.any(String),
    })
    expect(validarTemplate({ titulo: 'A', atalho: '/rastreio', texto: 'oi' }, ['rastreio']).atalho).toContain(
      'Já existe',
    )
    expect(validarTemplate({ titulo: 'A', atalho: '', texto: 'oi {{cliente}}' }, [])).toEqual({})
  })

  it('mover renumera a lista inteira, mesmo com ordem repetida', () => {
    const lista = [
      { id: 'a', ordem: 0 },
      { id: 'b', ordem: 0 },
      { id: 'c', ordem: 1 },
    ]
    expect(moverTemplate(lista, 'c', -1)).toEqual([
      { id: 'a', ordem: 0 },
      { id: 'c', ordem: 1 },
      { id: 'b', ordem: 2 },
    ])
    expect(moverTemplate(lista, 'a', -1).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})
