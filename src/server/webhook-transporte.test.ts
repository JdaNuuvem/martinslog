import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { cadastrarWebhook } from './webhook-service'
import { sincronizarEnvio } from './sincronizar-envio-service'

/**
 * Prova que o transporte inteiro é notificado, e não só o começo dele.
 *
 * O defeito que este arquivo existe para impedir era invisível: `POSTED` e
 * `DELIVERED` acontecem sozinhos, quando o relógio da simulação alcança o
 * evento, e não passam por nenhum serviço que enfileirasse webhook. Quem
 * integrava recebia o código de rastreio em `order.generated` e nunca mais
 * ouvia falar do pedido — o rastreio do comprador congelava em "etiqueta
 * emitida" até a entrega.
 *
 * Nada no log acusava, porque não havia entrega falhando: não havia entrega
 * alguma. Só um teste que percorre a linha do tempo inteira encontra isso.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.webhookDelivery.deleteMany({
    where: { webhookApp: { userId: { in: usuariosCriados } } },
  })
  await prisma.webhookApp.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: envios.map((e) => e.id) } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

const remetente: EnderecoEnvio = {
  nome: 'Remetente Teste',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Destinatário Teste',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

async function eventosEnfileirados(userId: string): Promise<string[]> {
  const entregas = await prisma.webhookDelivery.findMany({
    where: { webhookApp: { userId } },
    select: { evento: true },
    orderBy: { criadoEm: 'asc' },
  })
  return entregas.map((e) => e.evento)
}

describe('webhooks do transporte', () => {
  it('notifica a jornada inteira, do carrinho à entrega', async () => {
    const usuario = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(usuario.id)

    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', [
      'order.created',
      'order.released',
      'order.generated',
      'order.posted',
      'order.delivered',
    ])

    const cotacao = await criarCotacaoValida(usuario.id)
    const envio = await criarEnvio(usuario.id, {
      quoteId: cotacao.id,
      servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
      remetente,
      destinatario,
      produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    })

    await pagarEnvio(usuario.id, envio.id)

    // Até aqui, tudo já funcionava.
    expect(await eventosEnfileirados(usuario.id)).toEqual([
      'order.created',
      'order.released',
      'order.generated',
    ])

    /*
      Avança o relógio muito além do prazo. A timeline inteira já está gravada
      e datada desde a emissão; sincronizar é o que faz o status alcançá-la.
    */
    const daquiUmMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const status = await sincronizarEnvio(envio.id, daquiUmMes)

    expect(status).toBe('DELIVERED')

    const eventos = await eventosEnfileirados(usuario.id)

    // O coração do teste: sem a correção, a lista parava em order.generated.
    expect(eventos).toContain('order.posted')
    expect(eventos).toContain('order.delivered')

    // E na ordem certa — a máquina de estados não permite pular POSTED.
    expect(eventos.indexOf('order.posted')).toBeLessThan(eventos.indexOf('order.delivered'))
  })

  it('congela no payload o código de rastreio que existia no momento do evento', async () => {
    const usuario = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(usuario.id)

    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', ['order.delivered'])

    const cotacao = await criarCotacaoValida(usuario.id)
    const envio = await criarEnvio(usuario.id, {
      quoteId: cotacao.id,
      servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
      remetente,
      destinatario,
      produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    })
    await pagarEnvio(usuario.id, envio.id)
    await sincronizarEnvio(envio.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    const entrega = await prisma.webhookDelivery.findFirst({
      where: { webhookApp: { userId: usuario.id }, evento: 'order.delivered' },
    })

    expect(entrega).not.toBeNull()

    const payload = entrega!.payload as {
      event: string
      data: { status: string; tracking: string | null; tracking_url: string | null }
    }

    expect(payload.event).toBe('order.delivered')
    expect(payload.data.status).toBe('DELIVERED')

    /*
      O comprador só tem valor no evento se o código vier junto. Um
      `order.delivered` com `tracking: null` obrigaria o integrador a uma
      consulta extra para saber de qual encomenda se trata.
    */
    expect(payload.data.tracking).toMatch(/^[A-Z]{2}\d{9}BR$/)
    expect(payload.data.tracking_url).toBe(`/r/${payload.data.tracking}`)
  })

  it('não enfileira nada para quem não cadastrou webhook', async () => {
    const usuario = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(usuario.id)

    const cotacao = await criarCotacaoValida(usuario.id)
    const envio = await criarEnvio(usuario.id, {
      quoteId: cotacao.id,
      servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
      remetente,
      destinatario,
      produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    })
    await pagarEnvio(usuario.id, envio.id)
    await sincronizarEnvio(envio.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    // A sincronização passou a gravar dentro de uma transação. Se ela
    // enfileirasse para destino inexistente, o custo apareceria em toda
    // conta sem integração — que são a maioria.
    expect(await eventosEnfileirados(usuario.id)).toEqual([])
  })
})

