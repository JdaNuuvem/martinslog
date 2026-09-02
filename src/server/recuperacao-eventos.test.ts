import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { cadastrarWebhook } from './webhook-service'
import {
  listarEntregasWebhook,
  obterHistorico,
  type ContextoApi,
} from './api-publica-service'
import { sincronizarEnvio } from './sincronizar-envio-service'

/**
 * As duas redes de recuperação que o integrador pediu, e o motivo de cada uma.
 *
 * Sem elas, quem fica fora do ar além das seis tentativas só reconstrói o que
 * perdeu varrendo pedido a pedido — e essa varredura divide a mesma cota das
 * chamadas que fecham venda. A recuperação de um evento perdido passa a
 * competir com a operação que dá dinheiro.
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
  nome: 'Loja Teste',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatario: EnderecoEnvio = {
  nome: 'Maria',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

function contextoDe(userId: string): ContextoApi {
  return { tokenId: 'token-de-teste', userId, ambiente: 'PRODUCAO', perfilId: null }
}

async function envioPago(referencia?: string) {
  const usuario = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(usuario.id)
  const cotacao = await criarCotacaoValida(usuario.id)
  const envio = await criarEnvio(usuario.id, {
    quoteId: cotacao.id,
    servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
    remetente,
    destinatario,
    produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    referenciaExterna: referencia ?? null,
  })
  await pagarEnvio(usuario.id, envio.id)
  return { usuario, envio }
}

describe('histórico do envio', () => {
  it('devolve só o que já aconteceu, não a timeline inteira', async () => {
    const { usuario, envio } = await envioPago('PED-HIST')

    /*
      A timeline nasce inteira e datada na emissão. Se a rota devolvesse tudo,
      o comprador leria hoje que o pedido foi entregue na semana que vem.
    */
    const agora = await obterHistorico(contextoDe(usuario.id), envio.id)
    const daquiUmMes = await obterHistorico(
      contextoDe(usuario.id),
      envio.id,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    )

    expect(agora.steps.length).toBeGreaterThan(0)
    expect(daquiUmMes.steps.length).toBeGreaterThan(agora.steps.length)
    expect(agora.steps.every((p) => new Date(p.occurred_at) <= new Date())).toBe(true)
  })

  it('traz os dois códigos, para casar com o pedido da loja', async () => {
    const { usuario, envio } = await envioPago('PED-DOIS-CODIGOS')
    const historico = await obterHistorico(contextoDe(usuario.id), envio.id)

    expect(historico.external_id).toBe('PED-DOIS-CODIGOS')
    expect(historico.tracking).toMatch(/^[A-Z]{2}\d{9}BR$/)
  })

  it('envio de outra conta não é acessível', async () => {
    const { envio } = await envioPago()
    const { usuario: intruso } = await envioPago()

    await expect(obterHistorico(contextoDe(intruso.id), envio.id)).rejects.toThrow()
  })

  it('os passos vêm em ordem cronológica', async () => {
    const { usuario, envio } = await envioPago()
    const h = await obterHistorico(
      contextoDe(usuario.id),
      envio.id,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    )
    const datas = h.steps.map((p) => new Date(p.occurred_at).getTime())
    expect([...datas].sort((a, b) => a - b)).toEqual(datas)
  })
})

describe('entregas de webhook', () => {
  it('lista o que foi tentado, com o payload inteiro para reprocessar', async () => {
    const { usuario, envio } = await envioPago('PED-ENTREGAS')
    /*
      Eventos que ainda VÃO acontecer. O webhook nasce depois do pagamento,
      então `order.created` e companhia já passaram — cadastrá-los aqui daria
      uma lista vazia e um teste que não prova nada.
    */
    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', [
      'order.posted',
      'order.delivered',
    ])
    await sincronizarEnvio(envio.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    const entregas = await listarEntregasWebhook(contextoDe(usuario.id), {})
    expect(entregas.length).toBeGreaterThan(0)

    const uma = entregas[0]!
    expect(uma.event_id).toBeTruthy()
    expect(uma.payload).toBeTruthy()
    // Sem o payload inteiro, listar não permite reprocessar: só contar.
    expect((uma.payload as { event: string }).event).toBe(uma.event)
  })

  it('o event_id do payload é o mesmo da entrega', async () => {
    const { usuario, envio } = await envioPago()
    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', ['order.delivered'])
    await sincronizarEnvio(envio.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    const entregas = await listarEntregasWebhook(contextoDe(usuario.id), {})
    const entrega = entregas.find((e) => e.event === 'order.delivered')

    expect(entrega).toBeTruthy()
    /*
      É o que permite deduplicar sem inventar chave. `sent_at` muda a cada
      retentativa e não serve; envio + tipo de evento funciona hoje e passa a
      descartar entrega legítima no dia em que o mesmo evento repetir.
    */
    expect((entrega!.payload as { event_id: string }).event_id).toBe(entrega!.event_id)
  })

  it('não mostra entrega de outra conta', async () => {
    const { usuario, envio } = await envioPago()
    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', ['order.delivered'])
    await sincronizarEnvio(envio.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    const { usuario: outro } = await envioPago()
    expect(await listarEntregasWebhook(contextoDe(outro.id), {})).toHaveLength(0)
  })

  it('filtra por envio, para recuperar um pedido específico', async () => {
    const { usuario, envio } = await envioPago()
    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', ['order.delivered'])
    await sincronizarEnvio(envio.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    const doEnvio = await listarEntregasWebhook(contextoDe(usuario.id), { shipmentId: envio.id })
    expect(doEnvio.length).toBeGreaterThan(0)

    const deOutro = await listarEntregasWebhook(contextoDe(usuario.id), {
      shipmentId: 'envio-que-nao-existe',
    })
    expect(deOutro).toHaveLength(0)
  })
})
