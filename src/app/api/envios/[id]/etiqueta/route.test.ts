import { afterAll, describe, expect, it } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { POST } from './route'

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
  nome: 'Destinatário Teste',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

/**
 * Cria um usuário com sessão real gravada no banco e devolve o cookie que a
 * rota vai ler — o mesmo caminho de um navegador, sem simulacro de sessão.
 */
async function criarUsuarioAutenticado(): Promise<{ userId: string; cookie: string }> {
  const user = await criarUsuarioComSaldo(50_000)
  usuariosCriados.push(user.id)

  const resposta = new NextResponse()
  const sessaoId = await criarSessao(user.id, resposta)

  return { userId: user.id, cookie: `${SESSION_COOKIE}=${sessaoId}` }
}

async function criarEnvioDe(userId: string, pago: boolean): Promise<string> {
  const cotacao = await criarCotacaoValida(userId)
  const envio = await criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente,
    destinatario,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })

  if (pago) {
    // Sem passar por `pagarEnvio`: o pagamento hoje já emite a etiqueta
    // pelo gancho, e estes testes precisam do estado anterior à emissão.
    await prisma.shipment.update({
      where: { id: envio.id },
      data: { status: 'RELEASED', pagoEm: new Date() },
    })
  }

  return envio.id
}

function pedido(shipmentId: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/envios/${shipmentId}/etiqueta`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}

function contexto(shipmentId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: shipmentId }) }
}

describe('POST /api/envios/[id]/etiqueta', () => {
  it('emite a etiqueta do próprio envio e devolve 200 com o código', async () => {
    const { userId, cookie } = await criarUsuarioAutenticado()
    const shipmentId = await criarEnvioDe(userId, true)

    const resposta = await POST(pedido(shipmentId, cookie), contexto(shipmentId))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(200)
    expect(corpo.codigoRastreio).toMatch(/^[A-Z]{2}\d{9}BR$/)

    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
  })

  it('devolve 401 sem sessão e não emite nada', async () => {
    const { userId } = await criarUsuarioAutenticado()
    const shipmentId = await criarEnvioDe(userId, true)

    const resposta = await POST(pedido(shipmentId), contexto(shipmentId))

    expect(resposta.status).toBe(401)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.codigoRastreio).toBeNull()
  })

  it('devolve 404 — nunca 403 — para envio de outro usuário', async () => {
    const dono = await criarUsuarioAutenticado()
    const intruso = await criarUsuarioAutenticado()
    const shipmentId = await criarEnvioDe(dono.userId, true)

    const resposta = await POST(pedido(shipmentId, intruso.cookie), contexto(shipmentId))

    expect(resposta.status).toBe(404)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.codigoRastreio).toBeNull()
    expect(envio.status).toBe('RELEASED')
  })

  it('devolve 404 para envio inexistente', async () => {
    const { cookie } = await criarUsuarioAutenticado()

    const resposta = await POST(pedido('nao-existe', cookie), contexto('nao-existe'))

    expect(resposta.status).toBe(404)
  })

  it('devolve 409 para envio não pago', async () => {
    const { userId, cookie } = await criarUsuarioAutenticado()
    const shipmentId = await criarEnvioDe(userId, false)

    const resposta = await POST(pedido(shipmentId, cookie), contexto(shipmentId))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(409)
    expect(corpo.codigo).toBe('TRANSICAO_INVALIDA')
  })

  it('devolve 409 na segunda emissão, sem alterar o envio', async () => {
    const { userId, cookie } = await criarUsuarioAutenticado()
    const shipmentId = await criarEnvioDe(userId, true)

    const primeira = await POST(pedido(shipmentId, cookie), contexto(shipmentId))
    expect(primeira.status).toBe(200)
    const depoisDaPrimeira = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    })
    const eventos = await prisma.trackingEvent.count({ where: { shipmentId } })

    const segunda = await POST(pedido(shipmentId, cookie), contexto(shipmentId))

    expect(segunda.status).toBe(409)
    const depoisDaSegunda = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    })
    expect(depoisDaSegunda.codigoRastreio).toBe(depoisDaPrimeira.codigoRastreio)
    expect(await prisma.trackingEvent.count({ where: { shipmentId } })).toBe(eventos)
  })
})
