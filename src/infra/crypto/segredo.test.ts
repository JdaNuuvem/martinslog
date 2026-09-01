import { beforeAll, describe, expect, it } from 'vitest'
import { cifrar, decifrar, dicaDaChave } from './segredo'

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY = 'chave-de-teste-com-mais-de-32-caracteres'
})

describe('cifrar e decifrar', () => {
  it('devolve o texto original', () => {
    const segredo = 're_umaChaveDeApiQualquer_1234567890'
    expect(decifrar(cifrar(segredo))).toBe(segredo)
  })

  it('produz saídas diferentes para o mesmo texto', () => {
    // Sal e IV aleatórios por chamada: duas contas com a mesma chave não
    // podem ter o mesmo valor no banco, senão dá para inferir a igualdade
    // sem decifrar nada.
    const segredo = 're_mesmaChave'
    expect(cifrar(segredo)).not.toBe(cifrar(segredo))
  })

  it('recusa valor adulterado em vez de devolver lixo', () => {
    const cifrado = cifrar('re_original')
    const partes = cifrado.split(':')
    const conteudoTrocado = partes[3]!.replace(/^../, '00')
    const adulterado = [partes[0], partes[1], partes[2], conteudoTrocado].join(':')

    expect(() => decifrar(adulterado)).toThrow()
  })

  it('recusa formato inválido', () => {
    expect(() => decifrar('sem-separadores')).toThrow(/Formato/)
  })

  it('falha alto quando a chave mestra não está configurada', () => {
    const anterior = process.env.SECRET_ENCRYPTION_KEY
    process.env.SECRET_ENCRYPTION_KEY = ''

    // Sem chave mestra, cifrar seria teatro: melhor não gravar nada.
    expect(() => cifrar('re_qualquer')).toThrow(/SECRET_ENCRYPTION_KEY/)

    process.env.SECRET_ENCRYPTION_KEY = anterior
  })

  it('falha quando a chave mestra é curta demais', () => {
    const anterior = process.env.SECRET_ENCRYPTION_KEY
    process.env.SECRET_ENCRYPTION_KEY = 'curta'

    expect(() => cifrar('re_qualquer')).toThrow(/32/)

    process.env.SECRET_ENCRYPTION_KEY = anterior
  })
})

describe('dicaDaChave', () => {
  it('mostra o suficiente para reconhecer, e nada além', () => {
    const dica = dicaDaChave('re_abcdefghijklmnop_9876')

    expect(dica).toBe('re_a••••9876')
    expect(dica).not.toContain('efghijklmnop')
  })

  it('não vaza nada de uma chave curta', () => {
    expect(dicaDaChave('re_123')).toBe('••••')
  })
})
