import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { emitirEtiqueta } from './emitir-etiqueta-service'
import { gerarSegredo } from './webhook-service'

/**
 * Liga a emissão ao webhook: `order.generated` precisa ser enfileirado com o
 * código de rastreio já preenchido, e sem nenhuma requisição de rede dentro
 * da transação de emissão.
 */

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let userId = ''
let serviceId = ''

async function criarEnvioLiberado() {
  return prisma.shipment.create({
    data: {
      userId,
      serviceId,
      status: 'RELEASED',
      remetente: { nome: 'Remetente', cidade: 'São Paulo', uf: 'SP' },
      destinatario: { nome: 'Ana Julia', cidade: 'Curitiba', uf: 'PR' },
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2500,
      descontoCentavos: 500,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
    },
  })
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: `WH-EMISSAO-${sufixo}` } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: `WH-EMISSAO-${sufixo}`,
      nome: 'Serviço da ligação emissão-webhook',
      prazoBase: 2,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `77${sufixo}`.padEnd(11, '5').slice(0, 11),
      nome: 'Usuário emissão webhook',
      email: `wh-emissao-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  userId = user.id
  usuariosCriados.push(user.id)
})

afterAll(async () => {
  await prisma.webhookDelivery.deleteMany({ where: { webhookApp: { userId } } })
  await prisma.webhookApp.deleteMany({ where: { userId } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('emitirEtiqueta dispara order.generated', () => {
  it('enfileira a entrega com o código de rastreio já preenchido', async () => {
    await prisma.webhookApp.create({
      data: {
        userId,
        url: 'https://exemplo.com.br/hook',
        eventos: ['order.generated'],
        segredo: gerarSegredo(),
      },
    })
    const envio = await criarEnvioLiberado()

    const { codigoRastreio } = await emitirEtiqueta(envio.id)

    const entrega = await prisma.webhookDelivery.findFirst({
      where: { evento: 'order.generated', webhookApp: { userId } },
    })
    const payload = entrega?.payload as { data: { tracking: string | null } }

    // O evento sairia inútil com tracking nulo: é o campo que o cliente
    // espera justamente neste evento.
    expect(payload.data.tracking).toBe(codigoRastreio)
  })

  it('não faz requisição de rede dentro da transação de emissão', async () => {
    await prisma.webhookApp.create({
      data: {
        userId,
        url: 'https://exemplo.com.br/hook',
        eventos: ['order.generated'],
        segredo: gerarSegredo(),
      },
    })
    const envio = await criarEnvioLiberado()
    const espiao = vi.spyOn(globalThis, 'fetch')

    await emitirEtiqueta(envio.id)

    expect(espiao).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('emite normalmente para quem não tem webhook cadastrado', async () => {
    await prisma.webhookApp.deleteMany({ where: { userId } })
    const envio = await criarEnvioLiberado()

    const { codigoRastreio } = await emitirEtiqueta(envio.id)

    expect(codigoRastreio).toMatch(/^[A-Z]{2}\d{9}BR$/)
    expect(await prisma.webhookDelivery.count({ where: { webhookApp: { userId } } })).toBe(0)
  })
})
