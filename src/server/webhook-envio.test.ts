import { afterAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { SaldoInsuficienteError } from '@/domain/errors'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EntradaEnvio } from './shipment-service'
import { gerarSegredo } from './webhook-service'

/**
 * Liga a criação e o pagamento ao webhook: `order.created` e `order.released`
 * precisam ser enfileirados dentro das mesmas transações, sem I/O de rede e
 * sem sobreviver a um rollback.
 */

const usuariosCriados: string[] = []

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.webhookDelivery.deleteMany({
    where: { webhookApp: { userId: { in: usuariosCriados } } },
  })
  await prisma.webhookApp.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.trackingEvent.deleteMany({
    where: { shipment: { userId: { in: usuariosCriados } } },
  })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

function entradaEnvio(quoteId: string): EntradaEnvio {
  return {
    quoteId,
    servicoId: 'eco',
    remetente: {
      nome: 'Remetente Teste',
      documento: '52998224725',
      cep: '01310-100',
      logradouro: 'Av. Paulista',
      numero: '1000',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
    },
    destinatario: {
      nome: 'Destinatário Teste',
      documento: '52998224725',
      cep: '20040-020',
      logradouro: 'Av. Rio Branco',
      numero: '100',
      bairro: 'Centro',
      cidade: 'Rio de Janeiro',
      uf: 'RJ',
    },
    produtos: [{ nome: 'Camiseta', quantidade: 2, valorUnitarioCentavos: 5000 }],
  }
}

async function criarUsuarioComWebhook(saldoCentavos: number, eventos: string[]) {
  const user = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(user.id)
  await prisma.webhookApp.create({
    data: { userId: user.id, url: 'https://exemplo.com.br/hook', eventos, segredo: gerarSegredo() },
  })
  return user
}

async function entregasDe(userId: string, evento: string) {
  return prisma.webhookDelivery.findMany({ where: { evento, webhookApp: { userId } } })
}

describe('criarEnvio dispara order.created', () => {
  it('enfileira a entrega na criação do envio', async () => {
    const user = await criarUsuarioComWebhook(5000, ['order.created'])
    const cotacao = await criarCotacaoValida(user.id)

    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    const entregas = await entregasDe(user.id, 'order.created')
    const payload = entregas[0]?.payload as { data: { id: string; status: string } }

    expect(entregas).toHaveLength(1)
    expect(payload.data.id).toBe(envio.id)
    expect(payload.data.status).toBe('PENDING')
  })

  it('não faz requisição de rede durante a criação', async () => {
    const user = await criarUsuarioComWebhook(5000, ['order.created'])
    const cotacao = await criarCotacaoValida(user.id)
    const espiao = vi.spyOn(globalThis, 'fetch')

    await criarEnvio(user.id, entradaEnvio(cotacao.id))

    expect(espiao).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('pagarEnvio dispara order.released', () => {
  it('enfileira a entrega quando o pagamento é confirmado', async () => {
    const user = await criarUsuarioComWebhook(50000, ['order.released'])
    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await pagarEnvio(user.id, envio.id)

    const entregas = await entregasDe(user.id, 'order.released')
    expect(entregas).toHaveLength(1)
  })

  it('não enfileira nada quando o pagamento falha por saldo insuficiente', async () => {
    // A garantia que importa: rollback do débito leva a notificação junto,
    // e o cliente nunca é avisado de um pagamento que não aconteceu.
    const user = await criarUsuarioComWebhook(1, ['order.released'])
    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))

    await expect(pagarEnvio(user.id, envio.id)).rejects.toBeInstanceOf(SaldoInsuficienteError)

    expect(await entregasDe(user.id, 'order.released')).toHaveLength(0)
  })

  it('quem não tem webhook cadastrado cria e paga normalmente', async () => {
    const user = await criarUsuarioComSaldo(50000)
    usuariosCriados.push(user.id)
    const cotacao = await criarCotacaoValida(user.id)

    const envio = await criarEnvio(user.id, entradaEnvio(cotacao.id))
    await pagarEnvio(user.id, envio.id)

    const pago = await prisma.shipment.findUnique({ where: { id: envio.id } })
    expect(pago?.pagoEm).not.toBeNull()
    expect(await prisma.webhookDelivery.count({ where: { webhookApp: { userId: user.id } } })).toBe(
      0,
    )
  })
})
