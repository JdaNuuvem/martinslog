import { describe, expect, it } from 'vitest'
import { dentroDoSilencio, pediuParaParar, proximaJanela } from './silencio'

/**
 * A janela de silêncio e o pedido de parada.
 *
 * Os dois erram de formas silenciosas: uma janela mal calculada manda
 * mensagem às três da manhã sem ninguém perceber até a denúncia, e um
 * "pare" mal detectado ou silencia quem queria receber, ou ignora quem
 * pediu para sair.
 */

describe('janela de silêncio', () => {
  /**
   * O caso que quebra a comparação ingênua: a janela normal (22h–8h)
   * atravessa a meia-noite, e `hora >= inicio && hora < fim` nunca é
   * verdadeiro para ela.
   */
  it('reconhece a madrugada numa janela que vira o dia', () => {
    expect(dentroDoSilencio(23, 22, 8)).toBe(true)
    expect(dentroDoSilencio(3, 22, 8)).toBe(true)
    expect(dentroDoSilencio(7, 22, 8)).toBe(true)
  })

  it('libera o horário comercial na mesma janela', () => {
    expect(dentroDoSilencio(8, 22, 8)).toBe(false)
    expect(dentroDoSilencio(14, 22, 8)).toBe(false)
    expect(dentroDoSilencio(21, 22, 8)).toBe(false)
  })

  it('funciona também numa janela dentro do mesmo dia', () => {
    // Alguém que queira silêncio no almoço.
    expect(dentroDoSilencio(12, 12, 14)).toBe(true)
    expect(dentroDoSilencio(13, 12, 14)).toBe(true)
    expect(dentroDoSilencio(14, 12, 14)).toBe(false)
    expect(dentroDoSilencio(9, 12, 14)).toBe(false)
  })

  /** Início igual ao fim é janela de tamanho zero, não janela de 24h. */
  it('não silencia o dia inteiro quando início e fim coincidem', () => {
    expect(dentroDoSilencio(3, 22, 22)).toBe(false)
    expect(dentroDoSilencio(22, 22, 22)).toBe(false)
  })

  /**
   * O reagendamento no passado seria pior que não reagendar: a fila trataria
   * como "pode agora" e mandaria a mensagem de madrugada mesmo assim.
   */
  it('reagenda sempre para o futuro', () => {
    const madrugada = new Date('2026-09-11T05:00:00.000Z')
    const proxima = proximaJanela(madrugada, 8)
    expect(proxima.getTime()).toBeGreaterThan(madrugada.getTime())

    const noite = new Date('2026-09-11T23:30:00.000Z')
    expect(proximaJanela(noite, 8).getTime()).toBeGreaterThan(noite.getTime())
  })
})

describe('pedido de parada', () => {
  it('reconhece as formas comuns, com e sem acento', () => {
    for (const texto of ['PARE', 'pare', 'Parar', 'sair', 'STOP', 'cancelar', 'não quero mais']) {
      expect(pediuParaParar(texto), texto).toBe(true)
    }
  })

  it('aceita pontuação no fim', () => {
    expect(pediuParaParar('pare!')).toBe(true)
    expect(pediuParaParar('sair.')).toBe(true)
  })

  /**
   * O falso positivo que mais custaria: silenciar quem estava AGRADECENDO o
   * aviso. "Não pare de me avisar" contém "pare".
   */
  it('não confunde quem quer continuar recebendo', () => {
    expect(pediuParaParar('nao pare de me avisar por favor')).toBe(false)
    expect(pediuParaParar('obrigado, pode parar de se preocupar, chegou tudo certo')).toBe(false)
  })

  it('ignora conversa longa que só menciona a palavra', () => {
    expect(
      pediuParaParar(
        'oi, o pedido chegou mas veio com defeito, preciso cancelar a compra e pedir outro',
      ),
    ).toBe(false)
  })

  it('reconhece o comando com complemento curto', () => {
    expect(pediuParaParar('pare de mandar')).toBe(true)
  })
})
