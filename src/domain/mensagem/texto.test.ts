import { describe, expect, it } from 'vitest'
import { compor, custoDoTexto, TEXTOS_PADRAO_SMS } from './texto'

/**
 * Composição e custo do texto de SMS.
 *
 * O custo é metade do assunto: em SMS, cada 160 caracteres é um crédito, e com
 * acento o limite cai para 70. Um texto que passa do limite não falha — ele
 * simplesmente custa o dobro, em silêncio, para sempre.
 */

const valoresTipicos = {
  loja: 'Best Buy Tech',
  cliente: 'Maria',
  link_rastreio: 'https://app.martinslog.net/r/EC000000014BR',
}

describe('compor', () => {
  it('troca as variáveis por nome', () => {
    expect(compor('{{loja}}: oi {{cliente}}', valoresTipicos)).toBe('Best Buy Tech: oi Maria')
  })

  it('aceita espaço dentro das chaves e ignora caixa', () => {
    expect(compor('{{ LOJA }}', valoresTipicos)).toBe('Best Buy Tech')
  })

  it('variável desconhecida vira vazio, e não some o texto todo', () => {
    expect(compor('oi {{inexistente}} tudo bem', {})).toBe('oi tudo bem')
  })

  it('não deixa pontuação pendurada quando a variável do fim vem vazia', () => {
    /*
      É o caso da etiqueta que falhou: sem código de rastreio, o texto sairia
      como "...do seu pedido:" — uma frase que promete e não entrega, e que o
      comprador lê como mensagem quebrada.
    */
    const texto = compor('Loja: segue o link do seu pedido: {{link_rastreio}}', {})
    expect(texto).toBe('Loja: segue o link do seu pedido')
    expect(texto).not.toMatch(/:\s*$/)
  })
})

describe('custoDoTexto', () => {
  it('160 caracteres sem acento é um crédito', () => {
    expect(custoDoTexto('a'.repeat(160))).toMatchObject({ partes: 1, temAcento: false })
    expect(custoDoTexto('a'.repeat(161)).partes).toBe(2)
  })

  it('um acento derruba o limite para 70', () => {
    const custo = custoDoTexto('á'.repeat(71))
    expect(custo.temAcento).toBe(true)
    expect(custo.partes).toBe(2)
  })

  it('o mesmo texto custa o dobro só por causa da acentuação', () => {
    const semAcento = custoDoTexto('a'.repeat(100))
    const comAcento = custoDoTexto('a'.repeat(99) + 'ã')
    expect(semAcento.partes).toBe(1)
    expect(comAcento.partes).toBe(2)
  })
})

describe('os textos padrão cabem em um SMS', () => {
  /*
    Trava o custo. Um texto que passe de 160 caracteres com valores reais dobra
    a conta de toda venda, e nada no sistema acusaria — a mensagem sai
    normalmente, só cobrada duas vezes.
  */
  const valores = {
    ...valoresTipicos,
    // Nome de loja acima da média, para o teste não passar por sorte.
    loja: 'Best Buy Tech Eletronicos',
    codigo_rastreio: 'EC000000014BR',
  }

  for (const [evento, modelo] of Object.entries(TEXTOS_PADRAO_SMS)) {
    it(`${evento} cabe em um crédito`, () => {
      const texto = compor(modelo, valores)
      const custo = custoDoTexto(texto)

      expect(texto).not.toContain('{{')
      expect(custo.temAcento, `"${texto}" tem acento e cai para 70 caracteres`).toBe(false)
      expect(custo.partes, `"${texto}" tem ${custo.caracteres} caracteres`).toBe(1)
    })
  }

  it('o aviso de pagamento leva o link de rastreio', () => {
    const texto = compor(TEXTOS_PADRAO_SMS.PEDIDO_PAGO!, valores)
    expect(texto).toContain('pagamento confirmado')
    expect(texto).toContain('https://app.martinslog.net/r/EC000000014BR')
  })
})
