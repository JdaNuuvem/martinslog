import { describe, expect, it } from 'vitest'
import { decidir, ipDoPedido, type Dependencias } from './bloqueio'

/**
 * O bloqueio por país tem uma regra e sete exceções. A regra é fácil; as
 * exceções são onde ele quebra a operação.
 *
 * As verificações de IP entram por parâmetro para que estes testes exercitem a
 * ORDEM das decisões sem depender da lista de faixas. A ordem é o que dá
 * errado: uma exceção avaliada depois do bloqueio é uma exceção que não existe.
 */

const deps: Dependencias = {
  ehBrasileiro: (ip) => ip.startsWith('179.') || ip.startsWith('189.'),
  ehPrivado: (ip) => ip.startsWith('10.') || ip === '127.0.0.1',
}

const DE_FORA = '178.128.146.121'
const DO_BRASIL = '179.199.137.189'

function pedido(caminho: string, ip: string | null, navegador: string | null = 'Mozilla/5.0') {
  return { caminho, ip, navegador }
}

describe('a regra', () => {
  it('brasileiro passa, estrangeiro não', () => {
    expect(decidir(pedido('/etiquetas', DO_BRASIL), deps)).toBe('passa')
    expect(decidir(pedido('/etiquetas', DE_FORA), deps)).toBe('bloqueia')
  })
})

describe('as exceções que protegem a operação', () => {
  it('a API nunca é bloqueada — o integrador está em Nova Jersey', () => {
    /*
      O caso mais caro. O servidor que fatura as lojas roda nos Estados Unidos.
      Bloqueá-lo pararia toda cotação, carrinho e checkout no mesmo instante, e
      a causa seria invisível: nada quebra, só para de responder.
    */
    expect(decidir(pedido('/api/v0/calculator', DE_FORA), deps)).toBe('passa')
    expect(decidir(pedido('/api/v0/cart', DE_FORA), deps)).toBe('passa')
    expect(decidir(pedido('/api/whatsapp', DE_FORA), deps)).toBe('passa')
  })

  it('o rastreio do comprador passa de qualquer lugar', () => {
    // Ele pode estar viajando. Negar o rastreio de uma compra paga é punir
    // quem já pagou.
    expect(decidir(pedido('/r/EC000003639BR', DE_FORA), deps)).toBe('passa')
    expect(decidir(pedido('/rastrear', DE_FORA), deps)).toBe('passa')
  })

  it('robô de busca passa, senão o site sai do Google', () => {
    const google = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    expect(decidir(pedido('/', DE_FORA, google), deps)).toBe('passa')

    // O que gera a prévia do link quando alguém compartilha no WhatsApp.
    expect(decidir(pedido('/', DE_FORA, 'WhatsApp/2.23'), deps)).toBe('passa')
  })

  it('sem IP, PASSA — falhar fechando derrubaria o Brasil inteiro', () => {
    /*
      A decisão mais contraintuitiva e a mais importante. Um proxy mal
      configurado faria o IP chegar nulo, e bloquear nesse caso fecharia o site
      para todos, com o log dizendo apenas "bloqueado por país".

      Isto reduz tráfego indesejado; não protege segredo. O que protege é senha.
    */
    expect(decidir(pedido('/etiquetas', null), deps)).toBe('passa')
  })

  it('rede interna passa — é por ela que a verificação de saúde chega', () => {
    expect(decidir(pedido('/', '127.0.0.1'), deps)).toBe('passa')
    expect(decidir(pedido('/', '10.0.1.5'), deps)).toBe('passa')
  })

  it('arquivo estático e a própria página de aviso passam', () => {
    // Sem isto, a página de "só atendemos o Brasil" carregaria sem estilo — e
    // pediria a si mesma em laço.
    expect(decidir(pedido('/_next/static/css/app.css', DE_FORA), deps)).toBe('passa')
    expect(decidir(pedido('/fora-do-brasil', DE_FORA), deps)).toBe('passa')
    expect(decidir(pedido('/robots.txt', DE_FORA), deps)).toBe('passa')
  })

  it('a exceção de caminho não é enganada por maiúscula', () => {
    expect(decidir(pedido('/API/v0/cart', DE_FORA), deps)).toBe('passa')
  })
})

describe('o IP do visitante', () => {
  function cabecalhos(mapa: Record<string, string>) {
    return { get: (n: string) => mapa[n] ?? null }
  }

  it('pega o primeiro da cadeia, que é o cliente', () => {
    // `x-forwarded-for` acumula os proxies pelos quais passou. O último seria
    // o nosso próprio proxy — e trataríamos todo visitante como local.
    expect(ipDoPedido(cabecalhos({ 'x-forwarded-for': '179.1.2.3, 10.0.0.1, 10.0.0.2' }))).toBe(
      '179.1.2.3',
    )
  })

  it('aceita as outras formas que o proxy usa', () => {
    expect(ipDoPedido(cabecalhos({ 'x-real-ip': '179.1.2.3' }))).toBe('179.1.2.3')
    expect(ipDoPedido(cabecalhos({ 'cf-connecting-ip': '179.1.2.3' }))).toBe('179.1.2.3')
  })

  it('devolve nulo quando não há cabeçalho, em vez de inventar', () => {
    expect(ipDoPedido(cabecalhos({}))).toBeNull()
    expect(ipDoPedido(cabecalhos({ 'x-forwarded-for': '' }))).toBeNull()
  })
})
