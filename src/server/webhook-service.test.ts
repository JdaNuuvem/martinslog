import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ArquivoInvalidoError } from '@/domain/errors'
import { verificarAssinatura } from '@/domain/webhook/assinatura'
import { MAXIMO_TENTATIVAS } from '@/domain/webhook/retentativa'
import {
  cadastrarWebhook,
  dispararPendentes as dispararComResolvedor,
  enfileirarEvento,
  gerarSegredo,
  type ResolvedorDns,
} from './webhook-service'

/** Resolve todo host para um IP público: isola o teste do DNS real. */
const RESOLVE_PUBLICO: ResolvedorDns = async () => ['203.0.113.10']

function dispararPendentes(agora = new Date(), resolver: ResolvedorDns = RESOLVE_PUBLICO) {
  return dispararComResolvedor(agora, 50, resolver)
}

const sufixo = String(Date.now()).slice(-6)
let userId = ''
let outroUserId = ''
let serviceId = ''
let shipmentId = ''

async function criarUsuario(rotulo: string, indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `2${indice}${sufixo}`.padEnd(11, '8').slice(0, 11),
      nome: `Usuário webhook ${rotulo}`,
      email: `webhook-${rotulo}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  return user.id
}

/**
 * Todas as consultas de verificação são escopadas aos usuários deste
 * arquivo: os arquivos de teste rodam em paralelo contra o mesmo banco, e
 * uma consulta sem filtro pegaria entrega criada por outro arquivo.
 */
const DESTE_ARQUIVO = () => ({ webhookApp: { userId: { in: [userId, outroUserId] } } })

function primeiraEntrega() {
  return prisma.webhookDelivery.findFirst({ where: DESTE_ARQUIVO() })
}

async function criarApp(url = 'https://exemplo.com.br/hook', eventos = ['order.created']) {
  return prisma.webhookApp.create({
    data: { userId, url, eventos, segredo: gerarSegredo() },
  })
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: `WEBHOOK-${sufixo}` } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: `WEBHOOK-${sufixo}`,
      nome: 'Serviço de teste de webhook',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  userId = await criarUsuario('dono', 1)
  outroUserId = await criarUsuario('outro', 2)

  const envio = await prisma.shipment.create({
    data: {
      userId,
      serviceId,
      status: 'PENDING',
      remetente: { cidade: 'São Paulo', uf: 'SP' },
      destinatario: { cidade: 'Curitiba', uf: 'PR' },
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2500,
      descontoCentavos: 500,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
    },
  })
  shipmentId = envio.id
})

afterEach(async () => {
  vi.restoreAllMocks()
  await prisma.webhookDelivery.deleteMany({
    where: { webhookApp: { userId: { in: [userId, outroUserId] } } },
  })
  await prisma.webhookApp.deleteMany({ where: { userId: { in: [userId, outroUserId] } } })
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: [userId, outroUserId] } } })
  await prisma.user.deleteMany({ where: { id: { in: [userId, outroUserId] } } })
})

describe('cadastrarWebhook', () => {
  it('gera segredo próprio e devolve só na criação', async () => {
    const criado = await cadastrarWebhook(userId, 'https://exemplo.com.br/hook', ['order.created'])

    expect(criado.segredo).toMatch(/^[0-9a-f]{64}$/)

    const guardado = await prisma.webhookApp.findUnique({ where: { id: criado.id } })
    expect(guardado?.segredo).toBe(criado.segredo)
  })

  it('gera segredos distintos a cada cadastro', async () => {
    const a = await cadastrarWebhook(userId, 'https://a.exemplo.com.br/h', ['order.created'])
    const b = await cadastrarWebhook(userId, 'https://b.exemplo.com.br/h', ['order.created'])

    expect(a.segredo).not.toBe(b.segredo)
  })

  it('recusa destino interno — SSRF barrado já no cadastro', async () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://localhost/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://10.1.2.3/hook',
      'http://exemplo.com.br/hook',
    ]) {
      await expect(cadastrarWebhook(userId, url, ['order.created'])).rejects.toBeInstanceOf(
        ArquivoInvalidoError,
      )
    }

    expect(await prisma.webhookApp.count({ where: { userId } })).toBe(0)
  })

  it('recusa evento desconhecido e lista vazia', async () => {
    await expect(
      cadastrarWebhook(userId, 'https://exemplo.com.br/h', ['order.inventado']),
    ).rejects.toThrow(/order.inventado/)
    await expect(cadastrarWebhook(userId, 'https://exemplo.com.br/h', [])).rejects.toBeInstanceOf(
      ArquivoInvalidoError,
    )
  })
})

describe('enfileirarEvento', () => {
  it('enfileira uma entrega por webhook inscrito no evento', async () => {
    await criarApp('https://um.exemplo.com.br/h', ['order.created', 'order.released'])
    await criarApp('https://dois.exemplo.com.br/h', ['order.created'])
    await criarApp('https://tres.exemplo.com.br/h', ['order.delivered'])

    const enfileiradas = await enfileirarEvento(shipmentId, 'order.created')

    expect(enfileiradas).toBe(2)
    expect(
      await prisma.webhookDelivery.count({
        where: { evento: 'order.created', ...DESTE_ARQUIVO() },
      }),
    ).toBe(2)
  })

  it('ignora webhook desativado', async () => {
    const app = await criarApp()
    await prisma.webhookApp.update({ where: { id: app.id }, data: { ativo: false } })

    expect(await enfileirarEvento(shipmentId, 'order.created')).toBe(0)
  })

  it('não notifica webhook de outro usuário', async () => {
    await prisma.webhookApp.create({
      data: {
        userId: outroUserId,
        url: 'https://intruso.exemplo.com.br/h',
        eventos: ['order.created'],
        segredo: gerarSegredo(),
      },
    })

    expect(await enfileirarEvento(shipmentId, 'order.created')).toBe(0)
  })

  it('congela o payload no instante do evento', async () => {
    await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')

    const entrega = await primeiraEntrega()
    const payload = entrega?.payload as {
      data: { status: string; tracking: string | null; tracking_url: string | null }
    }

    expect(payload.data.status).toBe('PENDING')
    // Antes de `order.generated` o envio não tem código: o contrato promete nulo.
    expect(payload.data.tracking).toBeNull()
    expect(payload.data.tracking_url).toBeNull()
  })

  it('não faz I/O de rede — enfileirar não chama fetch', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch')
    await criarApp()

    await enfileirarEvento(shipmentId, 'order.created')

    expect(espiao).not.toHaveBeenCalled()
  })

  it('envio inexistente não enfileira nada', async () => {
    await criarApp()

    expect(await enfileirarEvento('id-que-nao-existe', 'order.created')).toBe(0)
  })
})

describe('dispararPendentes', () => {
  it('entrega e assina de forma verificável pelo cliente', async () => {
    const app = await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')

    let corpoRecebido = ''
    let assinaturaRecebida = ''
    let timestampRecebido = ''

    // A fila é global e outros arquivos de teste rodam em paralelo contra o
    // mesmo banco: guarda-se a chamada desta entrega pela URL, e afirma-se o
    // efeito sobre ela, nunca a contagem total do disparo.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('exemplo.com.br/hook')) {
        const cabecalhos = new Headers(init?.headers)
        corpoRecebido = String(init?.body)
        assinaturaRecebida = cabecalhos.get('x-frete-signature') ?? ''
        timestampRecebido = cabecalhos.get('x-frete-timestamp') ?? ''
      }
      return new Response('ok', { status: 200 })
    })

    await dispararPendentes()

    expect(corpoRecebido).not.toBe('')
    expect(
      verificarAssinatura(app.segredo, corpoRecebido, assinaturaRecebida, timestampRecebido),
    ).toBe(true)

    const entrega = await primeiraEntrega()
    expect(entrega?.entregueEm).not.toBeNull()
    expect(entrega?.proximaTentativaEm).toBeNull()
  })

  it('reagenda em erro do servidor do cliente, sem desistir', async () => {
    await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('erro', { status: 500 }))

    const resultado = await dispararPendentes()

    expect(resultado.falhas).toBe(1)
    const entrega = await primeiraEntrega()
    expect(entrega?.tentativas).toBe(1)
    expect(entrega?.statusHttp).toBe(500)
    expect(entrega?.proximaTentativaEm).not.toBeNull()
    expect(entrega?.entregueEm).toBeNull()
  })

  it('desiste em erro do cliente — repetir não conserta URL errada', async () => {
    await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nao existe', { status: 404 }))

    const resultado = await dispararPendentes()

    expect(resultado.desistidas).toBe(1)
    expect((await primeiraEntrega())?.proximaTentativaEm).toBeNull()
  })

  it('uma entrega falha não impede as outras de sair', async () => {
    await criarApp('https://quebrado.exemplo.com.br/h', ['order.created'])
    await criarApp('https://saudavel.exemplo.com.br/h', ['order.created'])
    await enfileirarEvento(shipmentId, 'order.created')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('quebrado')) throw new Error('conexão recusada')
      return new Response('ok', { status: 200 })
    })

    const resultado = await dispararPendentes()

    expect(resultado.entregues).toBe(1)
    expect(resultado.falhas).toBe(1)
  })

  it('registra o erro de rede sem status HTTP e retenta', async () => {
    await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('tempo esgotado'))

    await dispararPendentes()

    const entrega = await primeiraEntrega()
    expect(entrega?.statusHttp).toBeNull()
    expect(entrega?.erro).toContain('tempo esgotado')
    expect(entrega?.proximaTentativaEm).not.toBeNull()
  })

  it('não entrega antes da hora agendada', async () => {
    await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')
    await prisma.webhookDelivery.updateMany({
      where: DESTE_ARQUIVO(),
      data: { proximaTentativaEm: new Date(Date.now() + 60 * 60 * 1000) },
    })
    const espiao = vi.spyOn(globalThis, 'fetch')

    const resultado = await dispararPendentes()

    expect(espiao).not.toHaveBeenCalled()
    expect(resultado).toEqual({ entregues: 0, falhas: 0, desistidas: 0 })
  })

  it('para de tentar depois do limite de tentativas', async () => {
    await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')
    await prisma.webhookDelivery.updateMany({
      where: DESTE_ARQUIVO(),
      data: { tentativas: MAXIMO_TENTATIVAS, proximaTentativaEm: new Date() },
    })
    const espiao = vi.spyOn(globalThis, 'fetch')

    await dispararPendentes()

    expect(espiao).not.toHaveBeenCalled()
  })

  it('não entrega para webhook desativado depois do enfileiramento', async () => {
    const app = await criarApp()
    await enfileirarEvento(shipmentId, 'order.created')
    await prisma.webhookApp.update({ where: { id: app.id }, data: { ativo: false } })

    // A fila é global e outros arquivos rodam em paralelo: afirma-se o
    // efeito sobre esta entrega, não a ausência total de `fetch` nem a
    // contagem do disparo.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    await dispararPendentes()

    const entrega = await primeiraEntrega()
    expect(entrega?.entregueEm).toBeNull()
    expect(entrega?.proximaTentativaEm).toBeNull()
    expect(entrega?.erro).toMatch(/desativado/i)
  })

  it('recusa destino cuja URL resolve para rede interna, sem chamar fetch', async () => {
    // O cadastro barra IP literal, mas um domínio pode passar a apontar para
    // dentro depois. A checagem roda de novo a cada tentativa.
    await prisma.webhookApp.create({
      data: {
        userId,
        url: 'https://interno.exemplo.com.br/h',
        eventos: ['order.created'],
        segredo: gerarSegredo(),
      },
    })
    await enfileirarEvento(shipmentId, 'order.created')

    const resolveParaLoopback: ResolvedorDns = async () => ['127.0.0.1']
    const espiao = vi.spyOn(globalThis, 'fetch')

    const resultado = await dispararPendentes(new Date(), resolveParaLoopback)

    expect(espiao).not.toHaveBeenCalled()
    expect(resultado.desistidas).toBe(1)
    expect((await primeiraEntrega())?.erro).toMatch(/interna/i)
  })
})
