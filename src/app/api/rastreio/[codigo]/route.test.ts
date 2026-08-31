import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/infra/db/client'
import { montarCodigoRastreio } from '@/domain/shipment/codigo-rastreio'
import { limparCotas } from '@/server/rate-limit'
import { GET } from './route'

const sufixo = String(Date.now()).slice(-6)
let userId = ''
let serviceId = ''
let codigoExistente = ''

function requisitar(codigo: string) {
  const request = new NextRequest(`http://localhost/api/rastreio/${encodeURIComponent(codigo)}`)
  return GET(request, { params: Promise.resolve({ codigo }) })
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: `ROTA-RASTREIO-${sufixo}` } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: `ROTA-RASTREIO-${sufixo}`,
      nome: 'Serviço de teste da rota de rastreio',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `81${sufixo}`.padEnd(11, '4').slice(0, 11),
      nome: 'Usuário Rota Rastreio',
      email: `rota-rastreio-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  userId = user.id

  codigoExistente = montarCodigoRastreio('EC', Number(sufixo) * 10 + 1)
  const envio = await prisma.shipment.create({
    data: {
      userId,
      serviceId,
      codigoRastreio: codigoExistente,
      status: 'GENERATED',
      remetente: { nome: 'Remetente Ana Prado', logradouro: 'Rua das Acácias', cidade: 'São Paulo', uf: 'SP' },
      destinatario: {
        nome: 'Destinatário Bruno Lima',
        logradouro: 'Travessa do Porto',
        cidade: 'Curitiba',
        uf: 'PR',
      },
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2500,
      descontoCentavos: 500,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
      simulacaoIniciadaEm: new Date('2020-01-01T09:00:00Z'),
    },
  })

  await prisma.trackingEvent.create({
    data: {
      shipmentId: envio.id,
      sequencia: 1,
      offsetMinutos: 0,
      codigo: 'POSTADO',
      status: 'POSTED',
      titulo: 'Objeto postado',
      descricao: 'Objeto postado',
      cidade: 'São Paulo',
      uf: 'SP',
      ocorridoEm: new Date('2020-01-01T10:00:00Z'),
    },
  })
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
})

beforeEach(() => {
  limparCotas()
})

describe('GET /api/rastreio/[codigo]', () => {
  it('devolve 200 sem sessão — a consulta é pública', async () => {
    const response = await requisitar(codigoExistente)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.rastreio.codigoRastreio).toBe(codigoExistente)
    expect(json.rastreio.eventos).toHaveLength(1)
  })

  it('não expõe nome nem logradouro na resposta pública', async () => {
    const response = await requisitar(codigoExistente)
    const corpo = JSON.stringify(await response.json())

    expect(corpo).not.toContain('Ana Prado')
    expect(corpo).not.toContain('Bruno Lima')
    expect(corpo).not.toContain('Acácias')
    expect(corpo).not.toContain('Travessa do Porto')
  })

  it('devolve 422 para código malformado', async () => {
    const response = await requisitar('ABC123')

    expect(response.status).toBe(422)
    expect((await response.json()).codigo).toBe('CODIGO_INVALIDO')
  })

  it('devolve 404 para código válido sem envio', async () => {
    const response = await requisitar(montarCodigoRastreio('EC', Number(sufixo) * 10 + 9))

    expect(response.status).toBe(404)
    expect((await response.json()).codigo).toBe('ENVIO_NAO_ENCONTRADO')
  })

  it('bloqueia com 429 e Retry-After depois do limite de consultas', async () => {
    for (let i = 0; i < 30; i += 1) {
      const permitida = await requisitar(codigoExistente)
      expect(permitida.status).toBe(200)
    }

    const bloqueada = await requisitar(codigoExistente)

    expect(bloqueada.status).toBe(429)
    expect((await bloqueada.json()).codigo).toBe('LIMITE_CONSULTAS_EXCEDIDO')
    expect(Number(bloqueada.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('cobra cota também das tentativas que falham — varredura não sai de graça', async () => {
    for (let i = 0; i < 30; i += 1) {
      await requisitar('ABC123')
    }

    const bloqueada = await requisitar(codigoExistente)

    expect(bloqueada.status).toBe(429)
  })
})
