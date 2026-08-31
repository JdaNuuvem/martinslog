import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError, ValorInvalidoError } from '@/domain/errors'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { ID_CONFIG_SIMULACAO } from '@/server/simulacao-config'
import {
  definirFatorVelocidade,
  forcarProximoEvento,
  reiniciarLinhaDoTempo,
  trocarCenario,
} from './simulacao'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
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

/** Um ator administrativo qualquer — só o id importa para o AuditLog. */
async function criarAtor(): Promise<string> {
  const user = await criarUsuarioComSaldo(0)
  usuariosCriados.push(user.id)
  return user.id
}

async function emitirEnvio(): Promise<string> {
  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)
  const cotacao = await criarCotacaoValida(user.id)

  const envio = await criarEnvio(user.id, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })

  // `pagarEnvio` já emite a etiqueta pelo gancho posterior ao pagamento.
  await pagarEnvio(user.id, envio.id)

  return envio.id
}

async function eventos(shipmentId: string) {
  return prisma.trackingEvent.findMany({
    where: { shipmentId },
    orderBy: { sequencia: 'asc' },
  })
}

async function auditoriaDe(actorUserId: string, acao: string) {
  return prisma.auditLog.findFirst({
    where: { actorUserId, acao },
    orderBy: { criadoEm: 'desc' },
  })
}

describe('definirFatorVelocidade', () => {
  it('grava o novo fator e registra a auditoria com antes e depois', async () => {
    const ator = await criarAtor()

    await definirFatorVelocidade(ator, 288)

    const config = await prisma.simulacaoConfig.findUniqueOrThrow({
      where: { id: ID_CONFIG_SIMULACAO },
    })
    expect(config.fatorVelocidade).toBe(288)

    const log = await auditoriaDe(ator, 'SIMULACAO_FATOR_VELOCIDADE')
    expect(log).not.toBeNull()
    expect(log?.antes).toMatchObject({ fatorVelocidade: 1 })
    expect(log?.depois).toMatchObject({ fatorVelocidade: 288 })
  })

  it.each([0, -1, 1.5, Number.NaN])('recusa fator inválido: %s', async (fator) => {
    const ator = await criarAtor()
    // Captura o valor corrente em vez de presumir 1: `SimulacaoConfig` é uma
    // linha única global e os arquivos de teste rodam em paralelo contra o
    // mesmo banco. O que se afirma é que a chamada inválida não mudou nada.
    const antes = await prisma.simulacaoConfig.findUniqueOrThrow({
      where: { id: ID_CONFIG_SIMULACAO },
    })

    await expect(definirFatorVelocidade(ator, fator)).rejects.toBeInstanceOf(ValorInvalidoError)

    const depois = await prisma.simulacaoConfig.findUniqueOrThrow({
      where: { id: ID_CONFIG_SIMULACAO },
    })
    expect(depois.fatorVelocidade).toBe(antes.fatorVelocidade)
  })

  it('não altera a linha do tempo de envio já em curso', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()
    const antes = await eventos(shipmentId)

    await definirFatorVelocidade(ator, 288)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.fatorSimulacao).toBe(1)
    expect(await eventos(shipmentId)).toEqual(antes)
  })
})

describe('trocarCenario', () => {
  it('preserva os eventos já ocorridos e substitui apenas os futuros', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    const antes = await eventos(shipmentId)
    const passados = antes.filter((e) => e.ocorridoEm.getTime() <= Date.now())
    expect(passados.length).toBeGreaterThan(0)

    await trocarCenario(ator, shipmentId, 'EXTRAVIO')

    const depois = await eventos(shipmentId)

    // Os eventos que o cliente já viu sobrevivem com o mesmo id: reescrever
    // passado que ele já leu seria mentir para ele.
    for (const passado of passados) {
      const sobrevivente = depois.find((e) => e.id === passado.id)
      expect(sobrevivente).toBeDefined()
      expect(sobrevivente?.ocorridoEm.getTime()).toBe(passado.ocorridoEm.getTime())
    }

    // O futuro agora é do novo cenário e nenhum evento futuro do antigo ficou.
    expect(depois.some((e) => e.codigo === 'EXTRAVIADO')).toBe(true)
    expect(depois.some((e) => e.codigo === 'ENTREGUE')).toBe(false)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.cenario).toBe('EXTRAVIO')
  })

  it('mantém sequência sem buraco nem repetição e datas crescentes', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    await trocarCenario(ator, shipmentId, 'DEVOLUCAO')

    const depois = await eventos(shipmentId)
    expect(depois.map((e) => e.sequencia)).toEqual(
      Array.from({ length: depois.length }, (_, i) => i + 1),
    )
    depois.slice(1).forEach((atual, indice) => {
      const anterior = depois[indice] as (typeof depois)[number]
      expect(atual.ocorridoEm.getTime()).toBeGreaterThan(anterior.ocorridoEm.getTime())
    })
  })

  it('registra a auditoria com o cenário antes e depois', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    await trocarCenario(ator, shipmentId, 'ATRASO')

    const log = await auditoriaDe(ator, 'SIMULACAO_TROCAR_CENARIO')
    expect(log?.entidadeId).toBe(shipmentId)
    expect(log?.antes).toMatchObject({ cenario: 'ENTREGA_NORMAL' })
    expect(log?.depois).toMatchObject({ cenario: 'ATRASO' })
  })

  it('lança EnvioNaoEncontradoError para envio inexistente', async () => {
    const ator = await criarAtor()

    await expect(trocarCenario(ator, 'nao-existe', 'ATRASO')).rejects.toBeInstanceOf(
      EnvioNaoEncontradoError,
    )
  })
})

describe('forcarProximoEvento', () => {
  it('antecipa o próximo evento pendente para agora e o marca como forçado', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    const antes = await eventos(shipmentId)
    const proximo = antes.find((e) => e.ocorridoEm.getTime() > Date.now())
    expect(proximo).toBeDefined()

    await forcarProximoEvento(ator, shipmentId)

    const forcado = await prisma.trackingEvent.findUniqueOrThrow({
      where: { id: proximo!.id },
    })
    expect(forcado.forcado).toBe(true)
    expect(forcado.ocorridoEm.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('desloca os eventos seguintes pelo mesmo intervalo, sem embaralhar a ordem', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    const antes = await eventos(shipmentId)
    const proximo = antes.find((e) => e.ocorridoEm.getTime() > Date.now())!
    const seguintes = antes.filter((e) => e.sequencia > proximo.sequencia)
    expect(seguintes.length).toBeGreaterThan(0)

    await forcarProximoEvento(ator, shipmentId)

    const depois = await eventos(shipmentId)
    const forcado = depois.find((e) => e.id === proximo.id)!
    const deslocamento = proximo.ocorridoEm.getTime() - forcado.ocorridoEm.getTime()

    for (const seguinte of seguintes) {
      const atual = depois.find((e) => e.id === seguinte.id)!
      expect(atual.ocorridoEm.getTime()).toBe(seguinte.ocorridoEm.getTime() - deslocamento)
    }

    depois.slice(1).forEach((atual, indice) => {
      const anterior = depois[indice] as (typeof depois)[number]
      expect(atual.ocorridoEm.getTime()).toBeGreaterThanOrEqual(anterior.ocorridoEm.getTime())
    })
  })

  it('avança o status do envio junto', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    await forcarProximoEvento(ator, shipmentId)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('POSTED')
  })

  it('registra auditoria e recusa quando não há evento pendente', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    const total = (await eventos(shipmentId)).length
    for (let i = 1; i < total; i += 1) {
      await forcarProximoEvento(ator, shipmentId)
    }

    expect(await auditoriaDe(ator, 'SIMULACAO_FORCAR_EVENTO')).not.toBeNull()
    await expect(forcarProximoEvento(ator, shipmentId)).rejects.toBeInstanceOf(ValorInvalidoError)
  })
})

describe('reiniciarLinhaDoTempo', () => {
  it('apaga os eventos, regenera a partir de agora e volta o envio para GENERATED', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    const antes = await eventos(shipmentId)
    await forcarProximoEvento(ator, shipmentId)

    const inicio = Date.now()
    await reiniciarLinhaDoTempo(ator, shipmentId)

    const depois = await eventos(shipmentId)
    expect(depois.length).toBe(antes.length)
    // Nenhum evento antigo sobreviveu.
    expect(depois.every((e) => !antes.some((a) => a.id === e.id))).toBe(true)
    expect(depois.every((e) => !e.forcado)).toBe(true)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
    expect(envio.simulacaoIniciadaEm!.getTime()).toBeGreaterThanOrEqual(inicio - 1000)
    expect(envio.postadoEm).toBeNull()
  })

  it('preserva o código de rastreio: o cliente não perde o número que já tem', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()
    const antes = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })

    await reiniciarLinhaDoTempo(ator, shipmentId)

    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(depois.codigoRastreio).toBe(antes.codigoRastreio)
  })

  it('registra a auditoria do reinício', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    await reiniciarLinhaDoTempo(ator, shipmentId)

    const log = await auditoriaDe(ator, 'SIMULACAO_REINICIAR_TIMELINE')
    expect(log?.entidadeId).toBe(shipmentId)
    expect(log?.antes).toMatchObject({ status: 'GENERATED' })
  })

  it('recusa envio que nunca foi emitido', async () => {
    const ator = await criarAtor()
    const user = await criarUsuarioComSaldo(50_000)
    usuariosCriados.push(user.id)
    const cotacao = await criarCotacaoValida(user.id)
    const envio = await criarEnvio(user.id, {
      quoteId: cotacao.id,
      servicoId: 'eco',
      remetente,
      destinatario,
      produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
    })

    await expect(reiniciarLinhaDoTempo(ator, envio.id)).rejects.toBeInstanceOf(ValorInvalidoError)
  })
})

describe('forcarProximoEvento com código de evento da conta', () => {
  it('antecipa o evento e preserva o status quando o código é desconhecido', async () => {
    const ator = await criarAtor()
    const shipmentId = await emitirEnvio()

    const ultimo = await prisma.trackingEvent.findFirstOrThrow({
      where: { shipmentId },
      orderBy: { sequencia: 'desc' },
    })
    await prisma.trackingEvent.deleteMany({
      where: { shipmentId, sequencia: { gt: 1 } },
    })
    const customizado = await prisma.trackingEvent.create({
      data: {
        shipmentId,
        sequencia: 2,
        offsetMinutos: ultimo.offsetMinutos + 1,
        codigo: 'CONFERIDO_NO_CD',
        status: 'CONFERIDO_NO_CD',
        titulo: 'Objeto conferido no centro de distribuição',
        descricao: 'Conferência interna da conta',
        cidade: 'Rio de Janeiro',
        uf: 'RJ',
        ocorridoEm: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    const antes = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })

    // A ação principal é antecipar o evento. Não saber traduzir o código não
    // pode impedir isso, nem fazer o painel gravar status inválido.
    await forcarProximoEvento(ator, shipmentId)

    const forcado = await prisma.trackingEvent.findUniqueOrThrow({
      where: { id: customizado.id },
    })
    expect(forcado.forcado).toBe(true)
    expect(forcado.ocorridoEm.getTime()).toBeLessThanOrEqual(Date.now())

    const depois = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(depois.status).toBe(antes.status)
  })
})
