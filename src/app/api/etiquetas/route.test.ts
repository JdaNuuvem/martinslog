import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { emitirEtiqueta } from '@/server/emitir-etiqueta-service'
import { GET } from './route'
import { POST as CANCELAR } from './[id]/cancelar/route'

const usuariosCriados: string[] = []

afterAll(async () => {
  const envios = await prisma.shipment.findMany({
    where: { userId: { in: usuariosCriados } },
    select: { id: true },
  })
  const carteiras = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })

  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.trackingEvent.deleteMany({
    where: { shipmentId: { in: envios.map((e) => e.id) } },
  })
  await prisma.ledgerEntry.deleteMany({
    where: { walletId: { in: carteiras.map((c) => c.id) } },
  })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
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
  nome: 'Bruno Lima',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

async function criarClienteAutenticado(): Promise<{ userId: string; cookie: string }> {
  const user = await criarUsuarioComSaldo(100_000)
  usuariosCriados.push(user.id)
  const sessaoId = await criarSessao(user.id, NextResponse.json({}))
  return { userId: user.id, cookie: `${SESSION_COOKIE}=${sessaoId}` }
}

async function emitirEnvioDe(userId: string): Promise<string> {
  const cotacao = await criarCotacaoValida(userId)
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
  await prisma.shipment.update({
    where: { id: envio.id },
    data: { status: 'RELEASED', pagoEm: new Date() },
  })
  await emitirEtiqueta(envio.id)
  return envio.id
}

function pedidoLista(cookie?: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/etiquetas${query}`, {
    headers: cookie ? { cookie } : {},
  })
}

function pedidoCancelar(shipmentId: string, cookie?: string) {
  return CANCELAR(
    new NextRequest(`http://localhost/api/etiquetas/${shipmentId}/cancelar`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ id: shipmentId }) },
  )
}

describe('GET /api/etiquetas', () => {
  it('devolve as etiquetas do usuário logado', async () => {
    const { userId, cookie } = await criarClienteAutenticado()
    const shipmentId = await emitirEnvioDe(userId)

    const resposta = await GET(pedidoLista(cookie))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(200)
    expect(corpo.etiquetas.map((e: { id: string }) => e.id)).toEqual([shipmentId])
    expect(corpo.contagem.todos).toBe(1)
  })

  it('devolve 401 sem sessão', async () => {
    const resposta = await GET(pedidoLista())

    expect(resposta.status).toBe(401)
  })

  it('não vaza envio de outro usuário', async () => {
    const dono = await criarClienteAutenticado()
    const intruso = await criarClienteAutenticado()
    await emitirEnvioDe(dono.userId)

    const resposta = await GET(pedidoLista(intruso.cookie))
    const corpo = await resposta.json()

    expect(corpo.etiquetas).toHaveLength(0)
  })

  it('aba inválida cai em todos em vez de quebrar', async () => {
    const { userId, cookie } = await criarClienteAutenticado()
    await emitirEnvioDe(userId)

    const resposta = await GET(pedidoLista(cookie, '?aba=inventada'))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(200)
    expect(corpo.etiquetas).toHaveLength(1)
  })
})

describe('POST /api/etiquetas/[id]/cancelar', () => {
  it('cancela o envio do próprio usuário', async () => {
    const { userId, cookie } = await criarClienteAutenticado()
    const shipmentId = await emitirEnvioDe(userId)

    const resposta = await pedidoCancelar(shipmentId, cookie)

    expect(resposta.status).toBe(200)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('CANCELLED')
  })

  it('devolve 401 sem sessão e não cancela', async () => {
    const { userId } = await criarClienteAutenticado()
    const shipmentId = await emitirEnvioDe(userId)

    const resposta = await pedidoCancelar(shipmentId)

    expect(resposta.status).toBe(401)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
  })

  it('devolve 404 — não 403 — para envio de outro usuário', async () => {
    const dono = await criarClienteAutenticado()
    const intruso = await criarClienteAutenticado()
    const shipmentId = await emitirEnvioDe(dono.userId)

    const resposta = await pedidoCancelar(shipmentId, intruso.cookie)

    expect(resposta.status).toBe(404)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
  })

  it('devolve 409 ao cancelar envio já postado', async () => {
    const { userId, cookie } = await criarClienteAutenticado()
    const shipmentId = await emitirEnvioDe(userId)
    await prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'POSTED' } })

    const resposta = await pedidoCancelar(shipmentId, cookie)

    expect(resposta.status).toBe(409)
  })

  it('não credita a carteira ao cancelar', async () => {
    const { userId, cookie } = await criarClienteAutenticado()
    const shipmentId = await emitirEnvioDe(userId)
    const antes = await prisma.wallet.findUniqueOrThrow({ where: { userId } })

    await pedidoCancelar(shipmentId, cookie)

    const depois = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    expect(depois.saldoCentavos).toBe(antes.saldoCentavos)
  })
})
