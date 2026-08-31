import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnvioNaoEncontradoError } from '@/domain/errors'
import { validarCodigoRastreio } from '@/domain/shipment/codigo-rastreio'
import { atribuirCodigoRastreio, gerarCodigoRastreio } from './codigo-rastreio-service'

let contador = 0
const usuariosCriados: string[] = []
const carriersCriados: string[] = []

async function criarUsuario(): Promise<string> {
  contador += 1
  const sufixo = `${Date.now()}${contador}`
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `${contador}`.padStart(11, '7'),
      nome: 'Usuário Teste Rastreio',
      email: `rastreio-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

async function criarServico(codigo: string): Promise<string> {
  contador += 1
  const carrier = await prisma.carrier.create({
    data: { nome: 'Transportadora Teste', slug: `teste-${Date.now()}${contador}` },
  })
  carriersCriados.push(carrier.id)

  const service = await prisma.service.create({
    data: {
      carrierId: carrier.id,
      codigo,
      nome: 'Serviço Teste',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: {},
    },
  })
  return service.id
}

async function criarEnvio(userId: string, serviceId: string): Promise<string> {
  const envio = await prisma.shipment.create({
    data: {
      userId,
      serviceId,
      status: 'RELEASED',
      remetente: {},
      destinatario: {},
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2000,
      descontoCentavos: 1000,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
    },
  })
  return envio.id
}

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await prisma.service.deleteMany({ where: { carrierId: { in: carriersCriados } } })
  await prisma.carrier.deleteMany({ where: { id: { in: carriersCriados } } })
})

describe('gerarCodigoRastreio', () => {
  it('gera um código válido com o prefixo derivado do serviço', async () => {
    const codigo = await gerarCodigoRastreio('ECONOMICO')

    expect(codigo.startsWith('EC')).toBe(true)
    expect(validarCodigoRastreio(codigo)).toBe(true)
  })

  it('nunca repete um código, mesmo sob dezenas de chamadas simultâneas', async () => {
    const codigos = await Promise.all(
      Array.from({ length: 50 }, () => gerarCodigoRastreio('ECONOMICO')),
    )

    expect(new Set(codigos).size).toBe(50)
  })
})

describe('atribuirCodigoRastreio', () => {
  it('grava um código válido no envio e devolve o mesmo código', async () => {
    const userId = await criarUsuario()
    const serviceId = await criarServico('EXPRESSO')
    const shipmentId = await criarEnvio(userId, serviceId)

    const codigo = await atribuirCodigoRastreio(prisma, shipmentId)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.codigoRastreio).toBe(codigo)
    expect(codigo.startsWith('EX')).toBe(true)
    expect(validarCodigoRastreio(codigo)).toBe(true)
  })

  it('é idempotente: chamar de novo devolve o código já gravado, sem consumir outro', async () => {
    const userId = await criarUsuario()
    const serviceId = await criarServico('ECONOMICO')
    const shipmentId = await criarEnvio(userId, serviceId)

    const primeiro = await atribuirCodigoRastreio(prisma, shipmentId)
    const segundo = await atribuirCodigoRastreio(prisma, shipmentId)

    expect(segundo).toBe(primeiro)
  })

  it('atribui códigos distintos a envios distintos', async () => {
    const userId = await criarUsuario()
    const serviceId = await criarServico('ECONOMICO')
    const envios = await Promise.all([
      criarEnvio(userId, serviceId),
      criarEnvio(userId, serviceId),
      criarEnvio(userId, serviceId),
    ])

    const codigos = await Promise.all(envios.map((id) => atribuirCodigoRastreio(prisma, id)))

    expect(new Set(codigos).size).toBe(3)
  })

  it('recusa envio inexistente com EnvioNaoEncontradoError', async () => {
    await expect(atribuirCodigoRastreio(prisma, 'envio-que-nao-existe')).rejects.toThrow(
      EnvioNaoEncontradoError,
    )
  })

  it('participa da transação de quem chama: rollback não deixa código gravado', async () => {
    const userId = await criarUsuario()
    const serviceId = await criarServico('ECONOMICO')
    const shipmentId = await criarEnvio(userId, serviceId)

    await expect(
      prisma.$transaction(async (tx) => {
        await atribuirCodigoRastreio(tx, shipmentId)
        throw new Error('falha proposital depois de atribuir o código')
      }),
    ).rejects.toThrow('falha proposital')

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.codigoRastreio).toBeNull()
  })
})
