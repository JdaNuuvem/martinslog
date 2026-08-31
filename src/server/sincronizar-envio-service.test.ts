import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from './shipment-service'
import { ID_CONFIG_SIMULACAO } from './simulacao-config'
import {
  sincronizarEnvio,
  sincronizarEnviosPendentesDoUsuario,
} from './sincronizar-envio-service'

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
  // `pagarEnvio` já emite a etiqueta pelo gancho posterior ao pagamento,
  // então a linha do tempo nasce aqui — não é preciso emitir à mão.
  await pagarEnvio(user.id, envio.id)

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

async function creditosDoEnvio(userId: string, shipmentId: string): Promise<number> {
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
    expect(await creditosDoEnvio(userId, shipmentId)).toBe(0)
  })

  it('EXTRAVIADO leva a LOST sem mover um centavo', async () => {
    const { userId, shipmentId } = await emitirNoCenario('EXTRAVIO')
    const agora = await depoisDoEvento(shipmentId, 'EXTRAVIADO')
    const saldoAntes = await saldo(userId)

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('LOST')
    // Por decisão do produto em 31/08/2026, extravio não estorna. Este teste
    // é a trava contra a regra voltar por descuido: se alguém reintroduzir um
    // crédito aqui, ele falha.
    expect(await saldo(userId)).toBe(saldoAntes)
    expect(await creditosDoEnvio(userId, shipmentId)).toBe(0)

    await sincronizarEnvio(shipmentId, agora)
    expect(await saldo(userId)).toBe(saldoAntes)
  })

  it('DEVOLVIDO não credita a carteira', async () => {
    const { userId, shipmentId } = await emitirNoCenario('DEVOLUCAO')
    const agora = await depoisDoEvento(shipmentId, 'DEVOLVIDO')
    const saldoAntes = await saldo(userId)

    const status = await sincronizarEnvio(shipmentId, agora)

    expect(status).toBe('DELIVERED')
    expect(await saldo(userId)).toBe(saldoAntes)
    expect(await creditosDoEnvio(userId, shipmentId)).toBe(0)
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

  it('duas sincronizações simultâneas não deixam o envio fora de LOST', async () => {
    const { userId, shipmentId } = await emitirNoCenario('EXTRAVIO')
    const agora = await depoisDoEvento(shipmentId, 'EXTRAVIADO')
    const saldoAntes = await saldo(userId)

    const resultados = await Promise.allSettled([
      sincronizarEnvio(shipmentId, agora),
      sincronizarEnvio(shipmentId, agora),
    ])

    // Uma das duas pode perder a corrida do `update` condicionado ao status
    // esperado; o que não se admite é o envio ficar fora de LOST.
    expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(await saldo(userId)).toBe(saldoAntes)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('LOST')
  })

  it('lança EnvioNaoEncontradoError para envio inexistente', async () => {
    await expect(sincronizarEnvio('nao-existe')).rejects.toBeInstanceOf(EnvioNaoEncontradoError)
  })

  it('com fator 1440, um evento de offset de um dia vence em um minuto de relógio', async () => {
    await definirFatorGlobal(1440)
    const { shipmentId, simulacaoIniciadaEm } = await emitirNoCenario('ENTREGA_NORMAL')

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    const postado = await prisma.trackingEvent.findFirstOrThrow({
      where: { shipmentId, codigo: 'POSTADO' },
    })

    // O fator vem do envio, não da constante: `SimulacaoConfig` é global e
    // outro arquivo de teste rodando em paralelo pode tê-lo trocado entre o
    // ajuste acima e a emissão. A propriedade que importa é que as datas
    // seguem o fator que o envio copiou.
    const minutosReais =
      (postado.ocorridoEm.getTime() - simulacaoIniciadaEm.getTime()) / 60_000
    expect(minutosReais).toBeCloseTo(postado.offsetMinutos / envio.fatorSimulacao, 3)

    // Avançar o relógio até logo depois da postagem faz o status andar.
    const status = await sincronizarEnvio(
      shipmentId,
      new Date(postado.ocorridoEm.getTime() + 1000),
    )
    expect(status).toBe('POSTED')
  })
})

describe('sincronizarEnviosPendentesDoUsuario', () => {
  it('sincroniza os envios vencidos do usuário sem mover dinheiro', async () => {
    const { userId, shipmentId } = await emitirNoCenario('EXTRAVIO')
    const agora = await depoisDoEvento(shipmentId, 'EXTRAVIADO')
    const saldoAntes = await saldo(userId)

    const sincronizados = await sincronizarEnviosPendentesDoUsuario(userId, agora)

    expect(sincronizados).toBe(1)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('LOST')
    expect(await saldo(userId)).toBe(saldoAntes)
    expect(await creditosDoEnvio(userId, shipmentId)).toBe(0)
  })

  it('não faz trabalho quando nenhum envio tem evento vencido', async () => {
    const { userId, simulacaoIniciadaEm } = await emitirNoCenario('ENTREGA_NORMAL')

    // No instante da emissão só o primeiro evento venceu, e ele já
    // corresponde ao status atual: não há o que sincronizar.
    expect(await sincronizarEnviosPendentesDoUsuario(userId, simulacaoIniciadaEm)).toBe(0)
  })

  it('ignora envio já terminal numa segunda passada', async () => {
    const { userId, shipmentId } = await emitirNoCenario('EXTRAVIO')
    const agora = await depoisDoEvento(shipmentId, 'EXTRAVIADO')

    await sincronizarEnviosPendentesDoUsuario(userId, agora)

    // O envio já está em LOST, então nem entra na seleção.
    expect(await sincronizarEnviosPendentesDoUsuario(userId, agora)).toBe(0)
    expect(await creditosDoEnvio(userId, shipmentId)).toBe(0)
  })

  it('não toca em envio de outro usuário', async () => {
    const alheio = await emitirNoCenario('EXTRAVIO')
    const proprio = await emitirNoCenario('ENTREGA_NORMAL')
    const agora = await depoisDoEvento(alheio.shipmentId, 'EXTRAVIADO')

    await sincronizarEnviosPendentesDoUsuario(proprio.userId, agora)

    const envioAlheio = await prisma.shipment.findUniqueOrThrow({
      where: { id: alheio.shipmentId },
    })
    expect(envioAlheio.status).toBe('GENERATED')
  })
})
