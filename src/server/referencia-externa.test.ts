import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { cadastrarWebhook } from './webhook-service'
import { obterInfoEnvio, type ContextoApi } from './api-publica-service'

/**
 * A referência do pedido da loja, do `/cart` até o rastreio.
 *
 * Existe por um motivo só: o comprador hoje recebe o código da loja no e-mail e
 * o nosso no rastreio, sem nada ligando os dois. Quem recebe não tem como saber
 * que é o mesmo pedido, e a dúvida vira contato no suporte de quem vendeu.
 *
 * O caminho inteiro é testado porque o valor é inútil se parar no meio: guardar
 * a referência e não devolvê-la no webhook obrigaria o integrador a uma consulta
 * extra justamente no evento que traz o código.
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

/** O mínimo que `obterInfoEnvio` precisa: dono do token e ambiente. */
function contextoDe(userId: string): ContextoApi {
  return { tokenId: 'token-de-teste', userId, ambiente: 'PRODUCAO', perfilId: null }
}

async function envioCom(referencia?: string | null) {
  const usuario = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(usuario.id)
  const cotacao = await criarCotacaoValida(usuario.id)
  const envio = await criarEnvio(usuario.id, {
    quoteId: cotacao.id,
    servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
    remetente,
    destinatario,
    produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    referenciaExterna: referencia,
  })
  return { usuario, envio }
}

describe('referência do pedido da loja', () => {
  it('volta no /order/info junto do código de rastreio', async () => {
    const { usuario, envio } = await envioCom('PED-MTIUGL5D-F157')
    await pagarEnvio(usuario.id, envio.id)

    const info = await obterInfoEnvio(contextoDe(usuario.id), envio.id)

    // Os dois códigos no mesmo lugar: é isso que permite o comprador ver um só.
    expect(info.external_id).toBe('PED-MTIUGL5D-F157')
    expect(info.tracking).toMatch(/^[A-Z]{2}\d{9}BR$/)
  })

  it('viaja no webhook que traz o código, sem consulta extra', async () => {
    const { usuario, envio } = await envioCom('PED-ABC123')
    await cadastrarWebhook(usuario.id, 'https://exemplo.com.br/webhook', ['order.generated'])
    await pagarEnvio(usuario.id, envio.id)

    const entrega = await prisma.webhookDelivery.findFirstOrThrow({
      where: { webhookApp: { userId: usuario.id }, evento: 'order.generated' },
    })
    const payload = entrega.payload as { data: { external_id: string | null; tracking: string } }

    /*
      O evento que traz o código é o único momento em que o integrador precisa
      saber de qual pedido dele se trata. Sem a referência aqui, ele teria que
      consultar /order/info só para descobrir isso.
    */
    expect(payload.data.external_id).toBe('PED-ABC123')
    expect(payload.data.tracking).toMatch(/^[A-Z]{2}\d{9}BR$/)
  })

  it('quem não manda referência continua funcionando', async () => {
    const { usuario, envio } = await envioCom(undefined)
    await pagarEnvio(usuario.id, envio.id)

    // Campo opcional: a integração que já existe não pode quebrar.
    const info = await obterInfoEnvio(contextoDe(usuario.id), envio.id)
    expect(info.external_id).toBeNull()
    expect(info.tracking).toBeTruthy()
  })

  it('duas caixas do mesmo pedido podem repetir a referência', async () => {
    /*
      Não há unicidade de propósito. O espaço de códigos é da loja, e um pedido
      dividido em dois volumes carrega a mesma referência nos dois. Uma trava
      aqui recusaria um envio legítimo dela.
    */
    const { usuario, envio } = await envioCom('PED-DUAS-CAIXAS')
    const cotacao = await criarCotacaoValida(usuario.id)
    const segundo = await criarEnvio(usuario.id, {
      quoteId: cotacao.id,
      servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
      remetente,
      destinatario,
      produtos: [{ nome: 'Produto 2', quantidade: 1, valorUnitarioCentavos: 5000 }],
      referenciaExterna: 'PED-DUAS-CAIXAS',
    })

    expect(segundo.id).not.toBe(envio.id)
    expect(
      await prisma.shipment.count({ where: { referenciaExterna: 'PED-DUAS-CAIXAS' } }),
    ).toBe(2)
  })
})
