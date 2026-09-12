import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cifrarCampo, decifrarCampo } from './campo'

const SEGREDO_DE_TESTE = 'segredo-de-teste-da-cifra-de-campo-com-mais-de-32-caracteres'
let anterior: string | undefined

beforeEach(() => {
  anterior = process.env.SECRET_ENCRYPTION_KEY
  process.env.SECRET_ENCRYPTION_KEY = SEGREDO_DE_TESTE
})

afterEach(() => {
  /*
    Restaura com `delete` quando não havia valor.

    Atribuir `undefined` a uma variável de `process.env` NÃO a apaga: o Node
    converte para o texto "undefined". Numa máquina sem o segredo configurado,
    todo arquivo de teste rodado depois deste encontraria a chave valendo
    "undefined" — nove caracteres, abaixo do mínimo — e falharia com um erro
    que não aponta para cá.
  */
  if (anterior === undefined) delete process.env.SECRET_ENCRYPTION_KEY
  else process.env.SECRET_ENCRYPTION_KEY = anterior
})

describe('cifrarCampo / decifrarCampo', () => {
  it('devolve o valor original', () => {
    expect(decifrarCampo(cifrarCampo('52998224725'))).toBe('52998224725')
  })

  it('cifrar o mesmo valor duas vezes dá resultados diferentes', () => {
    // IV aleatório por valor: sem ele, dois CPFs iguais teriam o mesmo texto
    // cifrado, e quem lê o banco saberia quem compartilha documento com quem.
    expect(cifrarCampo('52998224725')).not.toBe(cifrarCampo('52998224725'))
  })

  it('recusa valor adulterado em vez de devolver lixo', () => {
    const cifrado = cifrarCampo('52998224725')
    const partes = cifrado.split(':')
    const conteudo = partes[3]!
    const trocado = (conteudo[0] === 'a' ? 'b' : 'a') + conteudo.slice(1)
    const adulterado = [partes[0], partes[1], partes[2], trocado].join(':')

    expect(() => decifrarCampo(adulterado)).toThrow()
  })

  it('recusa etiqueta de autenticação encurtada', () => {
    /*
      GCM aceita, por padrão, etiquetas mais curtas que 16 bytes, e cada byte a
      menos facilita forjar um valor. Sem exigir o tamanho, quem altera o banco
      pode truncar a etiqueta e ter a adulteração aceita com muito menos
      tentativas.
    */
    const partes = cifrarCampo('52998224725').split(':')
    const curta = [partes[0], partes[1], partes[2]!.slice(0, 8), partes[3]].join(':')

    expect(() => decifrarCampo(curta)).toThrow()
  })

  it('recusa formato desconhecido', () => {
    expect(() => decifrarCampo('isto:nao:e:valido')).toThrow()
    expect(() => decifrarCampo('')).toThrow()
  })

  it('lança sem segredo configurado, sem cair para valor padrão', () => {
    delete process.env.SECRET_ENCRYPTION_KEY
    expect(() => cifrarCampo('52998224725')).toThrow()
  })

  it('decifrar em massa não bloqueia o servidor', () => {
    /*
      A razão desta tarefa existir. O `decifrar` de `segredo.ts` custa ~59 ms
      por chamada, bloqueando o event loop: mil chamadas passariam de um
      minuto. O teto aqui é folgado de propósito — prova que a chave não é
      derivada a cada valor, sem virar teste que falha por máquina lenta.
    */
    const cifrados = Array.from({ length: 1000 }, () => cifrarCampo('52998224725'))

    const inicio = performance.now()
    for (const c of cifrados) decifrarCampo(c)
    const duracaoMs = performance.now() - inicio

    expect(duracaoMs).toBeLessThan(2000)
  })
})
