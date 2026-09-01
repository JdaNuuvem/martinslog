import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'

/**
 * Isenção de cobrança: emitir etiqueta sem saldo e sem lançamento.
 *
 * As duas metades importam igualmente. A primeira é óbvia — a conta isenta
 * consegue emitir com carteira zerada. A segunda é a que protege o
 * financeiro: ela não pode ganhar crédito de mentira, porque um lançamento
 * inventado vira receita que ninguém pagou em todo relatório que somar o
 * extrato.
 *
 * O terceiro caso é o mais importante de todos: provar que a isenção não
 * vazou para as contas comuns. Uma regra de exceção que se aplica a todo
 * mundo é a plataforma inteira trabalhando de graça, e nada no sistema
 * acusaria — os envios sairiam normalmente.
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

async function envioPagoPor(userId: string) {
  const cotacao = await criarCotacaoValida(userId)
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
    remetente,
    destinatario,
    produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
  })
  await pagarEnvio(userId, envio.id)
  return envio
}

async function lancamentosDe(userId: string): Promise<number> {
  return prisma.ledgerEntry.count({
    where: { wallet: { userId }, tipo: 'DEBITO' },
  })
}

describe('isenção de cobrança', () => {
  it('emite etiqueta com carteira zerada e sem lançar no livro-caixa', async () => {
    const usuario = await criarUsuarioComSaldo(0)
    usuariosCriados.push(usuario.id)
    await prisma.user.update({ where: { id: usuario.id }, data: { isentoCobranca: true } })

    const envio = await envioPagoPor(usuario.id)

    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(['RELEASED', 'GENERATED']).toContain(depois.status)
    expect(depois.pagoEm).not.toBeNull()

    // A metade que protege o financeiro: nenhum lançamento inventado.
    expect(await lancamentosDe(usuario.id)).toBe(0)

    const carteira = await prisma.wallet.findUnique({ where: { userId: usuario.id } })
    expect(carteira?.saldoCentavos ?? 0).toBe(0)
  })

  it('a conta comum continua sendo debitada', async () => {
    const usuario = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(usuario.id)

    await envioPagoPor(usuario.id)

    expect(await lancamentosDe(usuario.id)).toBe(1)

    const carteira = await prisma.wallet.findUniqueOrThrow({ where: { userId: usuario.id } })
    expect(carteira.saldoCentavos).toBeLessThan(50_000)
  })

  it('a conta comum sem saldo continua sendo recusada', async () => {
    const usuario = await criarUsuarioComSaldo(0)
    usuariosCriados.push(usuario.id)

    const cotacao = await criarCotacaoValida(usuario.id)
    const envio = await criarEnvio(usuario.id, {
      quoteId: cotacao.id,
      servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
      remetente,
      destinatario,
      produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
    })

    /*
      É este caso que prova que a isenção não vazou. Sem ele, o teste passaria
      igual se `isentoCobranca` fosse ignorado e todo mundo emitisse de graça.
    */
    await expect(pagarEnvio(usuario.id, envio.id)).rejects.toThrow()
    expect(await lancamentosDe(usuario.id)).toBe(0)

    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })
    expect(depois.status).toBe('PENDING')
  })

  it('a isenção não afrouxa a recusa de envio sandbox pelo caminho real', async () => {
    const usuario = await criarUsuarioComSaldo(0)
    usuariosCriados.push(usuario.id)
    await prisma.user.update({ where: { id: usuario.id }, data: { isentoCobranca: true } })

    const cotacao = await criarCotacaoValida(usuario.id)
    const envio = await criarEnvio(usuario.id, {
      quoteId: cotacao.id,
      servicoId: (cotacao.opcoes as { servicoId: string }[])[0]!.servicoId,
      remetente,
      destinatario,
      produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 9790 }],
      sandbox: true,
    })

    await expect(pagarEnvio(usuario.id, envio.id)).rejects.toThrow()
  })
})
