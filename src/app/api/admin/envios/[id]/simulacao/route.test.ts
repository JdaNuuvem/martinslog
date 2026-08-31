import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { criarEnvio, pagarEnvio, type EnderecoEnvio } from '@/server/shipment-service'
import { POST } from './route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoAdmin = ''
let sessaoCliente = ''

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

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE', indice: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `7${indice}${sufixo}`.padEnd(11, '9').slice(0, 11),
      nome: `Usuário ${papel} rota simulação envio`,
      email: `rota-sim-envio-${papel.toLowerCase()}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return criarSessao(user.id, NextResponse.json({}))
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

beforeAll(async () => {
  sessaoAdmin = await criarUsuario('ADMIN', 1)
  sessaoCliente = await criarUsuario('CLIENTE', 2)
})

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
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

function requisitar(
  sessionId: string | null,
  shipmentId: string,
  corpo: unknown,
): Promise<NextResponse> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return POST(
    new NextRequest(`http://localhost/api/admin/envios/${shipmentId}/simulacao`, {
      method: 'POST',
      headers,
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id: shipmentId }) },
  )
}

describe('POST /api/admin/envios/[id]/simulacao', () => {
  it('admin troca o cenário do envio', async () => {
    const shipmentId = await emitirEnvio()

    const resposta = await requisitar(sessaoAdmin, shipmentId, {
      acao: 'TROCAR_CENARIO',
      cenario: 'EXTRAVIO',
    })

    expect(resposta.status).toBe(200)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.cenario).toBe('EXTRAVIO')
  })

  it('admin força o próximo evento', async () => {
    const shipmentId = await emitirEnvio()

    const resposta = await requisitar(sessaoAdmin, shipmentId, { acao: 'FORCAR_EVENTO' })

    expect(resposta.status).toBe(200)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('POSTED')
  })

  it('admin reinicia a linha do tempo', async () => {
    const shipmentId = await emitirEnvio()
    await requisitar(sessaoAdmin, shipmentId, { acao: 'FORCAR_EVENTO' })

    const resposta = await requisitar(sessaoAdmin, shipmentId, { acao: 'REINICIAR' })

    expect(resposta.status).toBe(200)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
  })

  it('cliente autenticado recebe 404 e o envio não muda', async () => {
    const shipmentId = await emitirEnvio()

    const resposta = await requisitar(sessaoCliente, shipmentId, {
      acao: 'TROCAR_CENARIO',
      cenario: 'EXTRAVIO',
    })

    expect(resposta.status).toBe(404)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.cenario).toBe('ENTREGA_NORMAL')
  })

  it('anônimo recebe 404 e o envio não muda', async () => {
    const shipmentId = await emitirEnvio()

    const resposta = await requisitar(null, shipmentId, { acao: 'FORCAR_EVENTO' })

    expect(resposta.status).toBe(404)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.status).toBe('GENERATED')
  })

  it('troca de cenário sem informar o cenário recebe 400', async () => {
    const shipmentId = await emitirEnvio()

    const resposta = await requisitar(sessaoAdmin, shipmentId, { acao: 'TROCAR_CENARIO' })

    expect(resposta.status).toBe(400)
    const envio = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(envio.cenario).toBe('ENTREGA_NORMAL')
  })

  it('ação desconhecida recebe 400', async () => {
    const shipmentId = await emitirEnvio()

    const resposta = await requisitar(sessaoAdmin, shipmentId, { acao: 'EXPLODIR' })

    expect(resposta.status).toBe(400)
  })

  it('envio inexistente recebe 404', async () => {
    const resposta = await requisitar(sessaoAdmin, 'nao-existe', { acao: 'FORCAR_EVENTO' })

    expect(resposta.status).toBe(404)
  })
})
