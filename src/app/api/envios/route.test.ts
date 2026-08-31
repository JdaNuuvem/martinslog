import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarUsuarioComSaldo, criarCotacaoValida } from '@/test/factories'
import { GET, PATCH, POST } from './route'

const usuariosCriados: string[] = []

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.quote.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function criarUsuarioDeTeste(saldoCentavos: number) {
  const user = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(user.id)
  return user
}

async function criarSessionId(userId: string): Promise<string> {
  return criarSessao(userId, NextResponse.json({}))
}

// CEPs iguais aos que `criarCotacaoValida` grava em `cepOrigem`/`cepDestino`
// (ver src/test/factories.ts) — o servidor recusa o envio se remetente ou
// destinatário não baterem com os CEPs que geraram o preço da cotação.
const remetenteValido = {
  nome: 'Fulano de Tal',
  documento: '52998224725',
  cep: '01310-100',
  logradouro: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
}

const destinatarioValido = {
  nome: 'Ciclano de Tal',
  documento: '52998224725',
  cep: '20040-020',
  logradouro: 'Av. Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

function corpoValido(quoteId: string, extra?: Record<string, unknown>) {
  return {
    quoteId,
    servicoId: 'eco',
    remetente: remetenteValido,
    destinatario: destinatarioValido,
    produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 3000 }],
    ...extra,
  }
}

function criarRequest(
  metodo: 'GET' | 'POST' | 'PATCH',
  sessionId: string | null,
  body?: unknown,
  url = 'http://localhost/api/envios',
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return new NextRequest(url, {
    method: metodo,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/envios', () => {
  it('cria e paga o envio, ignorando qualquer preço enviado no corpo', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const sessionId = await criarSessionId(user.id)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })

    const resposta = await POST(
      criarRequest('POST', sessionId, corpoValido(cotacao.id, { precoCobradoCentavos: 1 })),
    )

    expect(resposta.status).toBe(201)
    const corpo = (await resposta.json()) as { id: string; status: string }
    expect(corpo.status).toBe('RELEASED')

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: corpo.id } })
    expect(salvo.precoCobradoCentavos).toBe(1416)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(2000 - 1416)
  })

  it('devolve 402 e mantém o envio PENDING quando o saldo é insuficiente', async () => {
    const user = await criarUsuarioDeTeste(100)
    const sessionId = await criarSessionId(user.id)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })

    const resposta = await POST(criarRequest('POST', sessionId, corpoValido(cotacao.id)))

    expect(resposta.status).toBe(402)
    const corpo = (await resposta.json()) as { shipmentId: string; codigo: string }
    expect(corpo.codigo).toBe('SALDO_INSUFICIENTE')

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: corpo.shipmentId } })
    expect(salvo.status).toBe('PENDING')
  })

  it('devolve 422 e não cria envio quando o destinatário está numa rota diferente da cotada', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const sessionId = await criarSessionId(user.id)
    // Cotação padrão da fábrica é São Paulo → Rio de Janeiro.
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1250 })

    const resposta = await POST(
      criarRequest(
        'POST',
        sessionId,
        corpoValido(cotacao.id, {
          destinatario: { ...destinatarioValido, cep: '69000-000' }, // Manaus
        }),
      ),
    )

    expect(resposta.status).toBe(422)
    const corpo = (await resposta.json()) as { codigo: string }
    expect(corpo.codigo).toBe('COTACAO_NAO_CORRESPONDE')

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.saldoCentavos).toBe(2000)

    const totalEnvios = await prisma.shipment.count({ where: { userId: user.id } })
    expect(totalEnvios).toBe(0)
  })

  it('devolve 422 quando a cotação já expirou', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const sessionId = await criarSessionId(user.id)
    const cotacao = await criarCotacaoValida(user.id, { expirada: true })

    const resposta = await POST(criarRequest('POST', sessionId, corpoValido(cotacao.id)))

    expect(resposta.status).toBe(422)
    const corpo = (await resposta.json()) as { codigo: string }
    expect(corpo.codigo).toBe('COTACAO_EXPIRADA')
  })

  it('devolve 404 quando o quoteId pertence a outro usuário', async () => {
    const dono = await criarUsuarioDeTeste(2000)
    const outro = await criarUsuarioDeTeste(2000)
    const sessionOutro = await criarSessionId(outro.id)
    const cotacao = await criarCotacaoValida(dono.id)

    const resposta = await POST(criarRequest('POST', sessionOutro, corpoValido(cotacao.id)))

    expect(resposta.status).toBe(404)
  })

  it('devolve 401 sem sessão', async () => {
    const resposta = await POST(criarRequest('POST', null, corpoValido('qualquer')))
    expect(resposta.status).toBe(401)
  })
})

describe('PATCH /api/envios (retry de pagamento)', () => {
  it('paga um envio PENDING depois que o cliente recarrega', async () => {
    const user = await criarUsuarioDeTeste(100)
    const sessionId = await criarSessionId(user.id)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })

    const criacao = await POST(criarRequest('POST', sessionId, corpoValido(cotacao.id)))
    const { shipmentId } = (await criacao.json()) as { shipmentId: string }

    await prisma.wallet.update({ where: { userId: user.id }, data: { saldoCentavos: 2000 } })

    const pagamento = await PATCH(criarRequest('PATCH', sessionId, { shipmentId }))
    expect(pagamento.status).toBe(204)

    const salvo = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })
    expect(salvo.status).toBe('RELEASED')
  })
})

describe('GET /api/envios (prévia)', () => {
  it('devolve o preço da opção escolhida sem criar nada', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const sessionId = await criarSessionId(user.id)
    const cotacao = await criarCotacaoValida(user.id, { precoCentavos: 1416 })

    const resposta = await GET(
      criarRequest(
        'GET',
        sessionId,
        undefined,
        `http://localhost/api/envios?quoteId=${cotacao.id}&servicoId=eco`,
      ),
    )

    expect(resposta.status).toBe(200)
    const corpo = (await resposta.json()) as { previa: { precoCobradoCentavos: number } }
    expect(corpo.previa.precoCobradoCentavos).toBe(1416)

    const total = await prisma.shipment.count({ where: { userId: user.id } })
    expect(total).toBe(0)
  })
})
