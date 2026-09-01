import { describe, expect, it } from 'vitest'
import { DESTINO_PADRAO, destinoSeguro } from './destino-seguro'

describe('destinoSeguro', () => {
  it('mantém um caminho interno com parâmetros', () => {
    expect(destinoSeguro('/envios/novo?quoteId=abc&servicoId=def')).toBe(
      '/envios/novo?quoteId=abc&servicoId=def',
    )
  })

  it('cai na home quando não há destino', () => {
    expect(destinoSeguro(null)).toBe(DESTINO_PADRAO)
    expect(destinoSeguro(undefined)).toBe(DESTINO_PADRAO)
    expect(destinoSeguro('')).toBe(DESTINO_PADRAO)
  })

  it('recusa endereço absoluto', () => {
    expect(destinoSeguro('https://sitedephishing.example/entrar')).toBe(DESTINO_PADRAO)
  })

  it('recusa protocolo relativo, que o navegador trata como externo', () => {
    expect(destinoSeguro('//sitedephishing.example')).toBe(DESTINO_PADRAO)
  })

  it('recusa barra invertida, normalizada para barra por alguns navegadores', () => {
    expect(destinoSeguro('/\\sitedephishing.example')).toBe(DESTINO_PADRAO)
  })
})
