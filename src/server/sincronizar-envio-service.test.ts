import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { ID_CONFIG_SIMULACAO } from './simulacao-config'
import { sincronizarEnvio } from './sincronizar-envio-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.trackingEvent.deleteMany({
    where: { shipmentId: { in: envios.map((e) => e.id) } },
  })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: wallets.map((w) => w.id) } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await definirFatorGlobal(1)
})

beforeEach(async () => {
  await definirFatorGlobal(1)
})

async function definirFatorGlobal(fatorVelocidade: number): Promise<void> {
  await prisma.simulacaoConfig.upsert({
    where: { id: ID_CONFIG_SIMULACAO },
    update: { fatorVelocidade },
    create: { id: ID_CONFIG_SIMULACAO, fatorVelocidade },
  })
}

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

const PRECO_CENTAVOS = 1416
const SALDO_INICIAL = 50_000

type EnvioEmitido = {
  userId: string
  shipmentId: string
  simulacaoIniciadaEm: Date
}

/**
 * Cria, paga e emite um envio no cenário informado. Devolve o instante em
 * que a simulação começou, que é a origem de todos os offsets — os testes
 * avançam o relógio a partir dele em vez de esperar tempo real.
 */
async function emitirNoCenario(
  cenario: 'ENTREGA_NORMAL' | 'EXTRAVIO' | 'DEVOLUCAO',
): Promise<EnvioEmitido> {
  const user = await criarUsuarioComSaldo(SALDO_INICIAL)
  usuariosCriados.push(user.id)
  const cotacao = await criarCotacaoValida(user.id, { precoCentavos: PRECO_CENTAVOS })

  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })

  await prisma.shipment.update({ where: { id: envio.id }, data: { cenario } })
  await pagarEnvio(user.id, envio.id)
  await emitirEtiqueta(envio.id)

  const emitido = await prisma.shipment.findUniqueOrThrow({ where: { id: envio.id } })

  return {
    userId: user.id,
    shipmentId: envio.id,
    simulacaoIniciadaEm: emitido.simulacaoIniciadaEm!,
  }
}

/** Instante em que o evento de um código já ocorreu, com um minuto de folga. */
async function depoisDoEvento(shipmentId: string, codigo: string): Promise<Date> {
  const evento = await prisma.trackingEvent.findFirstOrThrow({
    where: { shipmentId, codigo },
    orderBy: { sequencia: 'asc' },
  })
  return new Date(evento.ocorridoEm.getTime() + 60_000)
}

async function saldo(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
  return wallet.saldoCentavos
}

async function creditosDeEstorno(userId: string, shipmentId: string): Promise<number> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
  return prisma.ledgerEntry.count({
    where: { walletId: wallet.id, tipo: 'CREDITO', refTipo: 'SHIPMENT', refId: shipmentId },
  })
}

describe('sincronizarEnvio', () => {
  it('não move o status quando nenhum evento novo venceu', async () => {
    const { shipmentId, simulacaoIniciadaEm } = await emitirNoCenario('ENTREGA_NORMAL')

    const status = await sincronizarEnvio(shipmentId, simulacaoIniciadaEm)

    expect(status).toBe('GENERATED')
  })

  it('avança GENERATED → POSTED quando a postagem vence', async () => {
    const { shipmentId } = await emitirNoCenario('ENTREGA_NORMAL')
    const agora = await depoisDoEvento(shipmentId, 'POSTADO')

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('POSTED')
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('POSTED')
    expect(envio.postadoEm).not.toBeNull()
  })

  it('atravessa os estados intermediários de uma vez até DELIVERED', async () => {
    const { shipmentId } = await emitirNoCenario('ENTREGA_NORMAL')
    const agora = await depoisDoEvento(shipmentId, 'ENTREGUE')

    // GENERATED → DELIVERED não é transição válida direta: a sincronização
    // tem de passar por POSTED, mesmo quando o salto de relógio cobre a
    // timeline inteira.
    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('DELIVERED')
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('DELIVERED')
    expect(envio.postadoEm).not.toBeNull()
    expect(envio.entregueEm).not.toBeNull()
  })

  it('é idempotente: sincronizar duas vezes não muda nada nem duplica lançamento', async () => {
    const { userId, shipmentId } = await emitirNoCenario('ENTREGA_NORMAL')
    const agora = await depoisDoEvento(shipmentId, 'ENTREGUE')

    await sincronizarEnvio(shipmentId, agora)
    const primeiro = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('DELIVERED')
    const segundo = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(segundo.entregueEm?.getTime()).toBe(primeiro.entregueEm?.getTime())
    expect(await creditosDeEstorno(userId, shipmentId)).toBe(0)
  })

  it('EXTRAVIADO leva a LOST e credita a carteira exatamente uma vez', async () => {
    const { userId, shipmentId } = await emitirNoCenario('EXTRAVIO')
    const agora = await depoisDoEvento(shipmentId, 'EXTRAVIADO')
    const saldoAntes = await saldo(userId)

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('LOST')
    expect(await saldo(userId)).toBe(saldoAntes + PRECO_CENTAVOS)
    expect(await creditosDeEstorno(userId, shipmentId)).toBe(1)

    // Segunda sincronização: nem crédito novo, nem saldo alterado.
    await sincronizarEnvio(shipmentId, agora)
    expect(await saldo(userId)).toBe(saldoAntes + PRECO_CENTAVOS)
    expect(await creditosDeEstorno(userId, shipmentId)).toBe(1)
  })

  it('DEVOLVIDO não credita a carteira', async () => {
    const { userId, shipmentId } = await emitirNoCenario('DEVOLUCAO')
    const agora = await depoisDoEvento(shipmentId, 'DEVOLVIDO')
    const saldoAntes = await saldo(userId)

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('DELIVERED')
    expect(await saldo(userId)).toBe(saldoAntes)
    expect(await creditosDeEstorno(userId, shipmentId)).toBe(0)
  })

  it('envio cancelado não avança, nem com o relógio muito à frente', async () => {
    const { shipmentId } = await emitirNoCenario('ENTREGA_NORMAL')
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: 'CANCELLED', canceladoEm: new Date() },
    })
    const agora = await depoisDoEvento(shipmentId, 'ENTREGUE')

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('CANCELLED')
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('CANCELLED')
    expect(envio.entregueEm).toBeNull()
  })

  it('duas sincronizações simultâneas não duplicam o estorno do extravio', async () => {
    const { userId, shipmentId } = await emitirNoCenario('EXTRAVIO')
    const agora = await depoisDoEvento(shipmentId, 'EXTRAVIADO')
    const saldoAntes = await saldo(userId)

    const resultados = await Promise.allSettled([
      sincronizarEnvio(shipmentId, agora),
      sincronizarEnvio(shipmentId, agora),
    ])

    // Uma das duas pode perder a corrida e falhar; o que não se admite é
    // creditar duas vezes ou deixar o envio fora de LOST.
    expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(await creditosDeEstorno(userId, shipmentId)).toBe(1)
    expect(await saldo(userId)).toBe(saldoAntes + PRECO_CENTAVOS)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('LOST')
  })

  it('lança EnvioNaoEncontradoError para envio inexistente', async () => {
    await expect(sincronizarEnvio('nao-existe')).rejects.toBeInstanceOf(EnvioNaoEncontradoError)
  })

  it('com fator 1440, um evento de offset de um dia vence em um minuto de relógio', async () => {
    await definirFatorGlobal(1440)
    const { shipmentId, simulacaoIniciadaEm } = await emitirNoCenario('ENTREGA_NORMAL')

    const postado = await prisma.trackingEvent.findFirstOrThrow({
      where: { shipmentId, codigo: 'POSTADO' },
    })
    const minutosReais =
      (postado.ocorridoEm.getTime() - simulacaoIniciadaEm.getTime()) / 60_000
    expect(minutosReais).toBeCloseTo(postado.offsetMinutos / 1440, 3)

    // Um minuto de relógio real depois do início já cobre um dia simulado.
    const status = await sincronizarEnvio(
      shipmentId,
      new Date(simulacaoIniciadaEm.getTime() + 60_000),
    )
    expect(status).toBe('POSTED')
  })
})
