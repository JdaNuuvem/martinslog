import { describe, expect, it } from 'vitest'
import {
  TEXTOS_PADRAO_WHATSAPP,
  catalogoPronto,
  conferirRegrasDaMeta,
  eventosSemTextoPronto,
  paraCadastro,
} from './whatsapp-textos'
import { montarParametros } from './eventos'

/**
 * O que estes testes protegem é o erro mais caro do canal: a mensagem sai
 * aprovada, entregue, cobrada — e com os valores trocados de lugar.
 *
 * Ele não aparece em nenhum log. A Meta não valida sentido, só quantidade: se o
 * template espera três textos e mandamos três, ela entrega. O comprador recebe
 * "Olá, EC000000014BR" e o lojista descobre pelo cliente reclamando.
 */

describe('textos prontos do WhatsApp', () => {
  it('todos passam nas regras de cadastro da Meta', () => {
    for (const cadastro of catalogoPronto()) {
      expect(conferirRegrasDaMeta(cadastro), `template ${cadastro.nome}`).toEqual([])
    }
  })

  it('a numeração segue a ordem de aparição no texto', () => {
    const cadastro = paraCadastro(
      TEXTOS_PADRAO_WHATSAPP.find((t) => t.evento === 'PEDIDO_PENDENTE')!,
    )

    // O texto diz cliente, depois valor, depois loja, depois o link.
    expect(cadastro.variaveis).toEqual(['cliente', 'valor', 'loja', 'link_checkout'])
    expect(cadastro.corpo).toContain('Oi, {{1}}!')
    expect(cadastro.corpo).toContain('de {{2}} na {{3}}')
    expect(cadastro.corpo).toContain('{{4}}')
    // Nenhum nome pode sobreviver à tradução.
    expect(cadastro.corpo).not.toContain('{{cliente}}')
  })

  it('o disparo preenche na mesma ordem que foi cadastrada', () => {
    /*
      O teste que fecha o círculo. `variaveis` é o que gravamos no banco e
      `montarParametros` é o que o disparo usa — se os dois lados não lessem a
      mesma fonte, é aqui que a troca apareceria.
    */
    const cadastro = paraCadastro(TEXTOS_PADRAO_WHATSAPP.find((t) => t.evento === 'ENTREGUE')!)

    const parametros = montarParametros(cadastro.variaveis, {
      cliente: 'Maria',
      loja: 'Tiktok shop',
      codigo_rastreio: 'EC000000014BR',
      link_rastreio: 'https://app.martinslog.net/r/EC000000014BR',
    })

    let montado = cadastro.corpo
    parametros.forEach((p, i) => {
      montado = montado.split(`{{${i + 1}}}`).join(p.valor)
    })

    expect(montado).toBe(
      'Olá, Maria! Seu pedido da Tiktok shop foi entregue. ' +
        'Código EC000000014BR, comprovante em https://app.martinslog.net/r/EC000000014BR. Obrigado pela compra!',
    )
  })

  it('a prévia mostra a mensagem inteira, sem sobra de variável', () => {
    for (const cadastro of catalogoPronto()) {
      expect(cadastro.previa, cadastro.nome).not.toMatch(/\{\{/)
      expect(cadastro.previa.length, cadastro.nome).toBeGreaterThan(40)
    }
  })

  it('recusa texto que usa variável que o evento não oferece', () => {
    /*
      `codigo_rastreio` não existe em PEDIDO_PAGO: naquele instante a etiqueta
      ainda não foi emitida. Sem esta checagem, o template seria aprovado e a
      mensagem chegaria com um vazio no lugar do código.
    */
    expect(() =>
      paraCadastro({
        evento: 'PEDIDO_PAGO',
        nome: 'errado',
        corpo: 'Oi {{cliente}}, seu código é {{codigo_rastreio}} e chega logo.',
      }),
    ).toThrow(/codigo_rastreio/)
  })

  it('pega as recusas da Meta antes de mandar', () => {
    const comecaComVariavel = paraCadastro({
      evento: 'PEDIDO_PAGO',
      nome: 'Pedido Pago',
      corpo: '{{cliente}}, seu pagamento de {{valor}} entrou na {{loja}} agora.',
    })

    const regras = conferirRegrasDaMeta(comecaComVariavel).map((r) => r.regra)
    expect(regras).toContain('comeco')
    // Maiúsculas e espaço no nome também são recusa.
    expect(regras).toContain('nome')
  })

  it('a categoria vem do evento, não do texto', () => {
    const pendente = catalogoPronto().find((c) => c.evento.codigo === 'PEDIDO_PENDENTE')!
    const pago = catalogoPronto().find((c) => c.evento.codigo === 'PEDIDO_PAGO')!

    /*
      Convencer alguém a terminar a compra é promoção. Cadastrar como utilidade
      para pagar menos é o caminho mais rápido para a conta ser penalizada.
    */
    expect(pendente.categoria).toBe('MARKETING')
    expect(pago.categoria).toBe('UTILITY')
  })

  it('todo evento do catálogo tem texto pronto', () => {
    // Um evento sem texto aparece na tela como opção que não leva a nada.
    expect(eventosSemTextoPronto()).toEqual([])
  })

  it('nome de template não se repete', () => {
    const nomes = TEXTOS_PADRAO_WHATSAPP.map((t) => t.nome)
    expect(new Set(nomes).size).toBe(nomes.length)
  })
})
