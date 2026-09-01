import { afterAll, describe, expect, it } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarUsuarioComSaldo } from '@/test/factories'
import { POST as CRIAR_ENVIO } from '@/app/api/envios/route'
import { GET, POST } from './route'

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

function criarRequest(body: unknown, sessionId?: string | null): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return new NextRequest('http://localhost/api/cotacao', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  })
}

const corpoValido = {
  cepOrigem: '01001-000',
  cepDestino: '20040-002',
  pesoG: 300,
  alturaCm: 4,
  larguraCm: 12,
  comprimentoCm: 18,
}

describe('POST /api/cotacao', () => {
  it('devolve 200 com opções para um pedido válido', async () => {
    const response = await POST(criarRequest(corpoValido))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.opcoes)).toBe(true)
    expect(json.opcoes.length).toBeGreaterThan(0)
    expect(typeof json.quoteId).toBe('string')
  })

  it('define o cookie de sessão anônima na resposta', async () => {
    const response = await POST(criarRequest(corpoValido))
    const cookie = response.cookies.get('anon_session_id')
    expect(cookie?.value).toBeTruthy()
  })

  it('devolve 422 com CEP_INVALIDO quando o CEP é inválido', async () => {
    const response = await POST(criarRequest({ ...corpoValido, cepOrigem: 'abc' }))
    expect(response.status).toBe(422)
    const json = await response.json()
    expect(json.codigo).toBe('CEP_INVALIDO')
  })

  it('devolve 400 quando o corpo é malformado', async () => {
    const response = await POST(criarRequest({ cepOrigem: '01001-000' }))
    expect(response.status).toBe(400)
  })

  it('devolve 400 quando o corpo não é JSON válido', async () => {
    const response = await POST(criarRequest('não é json'))
    expect(response.status).toBe(400)
  })
})

describe('POST /api/cotacao — cliente autenticado', () => {
  const remetenteValido = {
    nome: 'Fulano de Tal',
    documento: '52998224725',
    cep: '01001-000',
    logradouro: 'Praça da Sé',
    numero: '1',
    bairro: 'Sé',
    cidade: 'São Paulo',
    uf: 'SP',
  }

  const destinatarioValido = {
    nome: 'Ciclano de Tal',
    documento: '52998224725',
    cep: '20040-002',
    logradouro: 'Av. Rio Branco',
    numero: '1',
    bairro: 'Centro',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
  }

  it('grava a cotação com userId preenchido e anonSessionId nulo', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const sessionId = await criarSessionId(user.id)

    const response = await POST(criarRequest(corpoValido, sessionId))
    expect(response.status).toBe(200)
    const json = await response.json()

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: json.quoteId } })
    expect(quote.userId).toBe(user.id)
    expect(quote.anonSessionId).toBeNull()

    const cookie = response.cookies.get('anon_session_id')
    expect(cookie?.value).toBeFalsy()
  })

  it('permite criar o envio em seguida com a cotação gerada logado (regressão do 404)', async () => {
    const user = await criarUsuarioDeTeste(2000)
    const sessionId = await criarSessionId(user.id)

    const cotacaoResponse = await POST(criarRequest(corpoValido, sessionId))
    expect(cotacaoResponse.status).toBe(200)
    const cotacaoJson = await cotacaoResponse.json()

    const envioResponse = await CRIAR_ENVIO(
      new NextRequest('http://localhost/api/envios', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${sessionId}`,
        }),
        body: JSON.stringify({
          quoteId: cotacaoJson.quoteId,
          servicoId: cotacaoJson.opcoes[0].servicoId,
          remetente: remetenteValido,
          destinatario: destinatarioValido,
          produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 3000 }],
        }),
      }),
    )

    expect(envioResponse.status).toBe(201)
  })

  it('sem sessão, continua funcionando como antes com anonSessionId preenchido', async () => {
    const response = await POST(criarRequest(corpoValido))
    expect(response.status).toBe(200)
    const json = await response.json()

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: json.quoteId } })
    expect(quote.userId).toBeNull()
    expect(quote.anonSessionId).toBeTruthy()
  })

  it('cliente A não consegue criar envio com cotação de B', async () => {
    const dono = await criarUsuarioDeTeste(2000)
    const outro = await criarUsuarioDeTeste(2000)
    const sessionDono = await criarSessionId(dono.id)
    const sessionOutro = await criarSessionId(outro.id)

    const cotacaoResponse = await POST(criarRequest(corpoValido, sessionDono))
    const cotacaoJson = await cotacaoResponse.json()

    const envioResponse = await CRIAR_ENVIO(
      new NextRequest('http://localhost/api/envios', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${sessionOutro}`,
        }),
        body: JSON.stringify({
          quoteId: cotacaoJson.quoteId,
          servicoId: cotacaoJson.opcoes[0].servicoId,
          remetente: remetenteValido,
          destinatario: destinatarioValido,
          produtos: [{ nome: 'Camiseta', quantidade: 1, valorUnitarioCentavos: 3000 }],
        }),
      }),
    )

    expect(envioResponse.status).toBe(404)
  })
})

describe('GET /api/cotacao', () => {
  function criarRequestGet(quoteId: string | null, sessionId?: string | null): NextRequest {
    const url = quoteId
      ? `http://localhost/api/cotacao?quoteId=${encodeURIComponent(quoteId)}`
      : 'http://localhost/api/cotacao'
    const headers = new Headers()
    if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
    return new NextRequest(url, { method: 'GET', headers })
  }

  it('devolve rota, medidas e opções da própria cotação', async () => {
    const user = await criarUsuarioDeTeste(50_000)
    const sessionId = await criarSessionId(user.id)

    const criada = await POST(criarRequest(corpoValido, sessionId))
    const { quoteId } = await criada.json()

    const response = await GET(criarRequestGet(quoteId, sessionId))
    expect(response.status).toBe(200)

    const { cotacao } = await response.json()
    expect(cotacao.cepOrigem).toBe(corpoValido.cepOrigem)
    expect(cotacao.cepDestino).toBe(corpoValido.cepDestino)
    expect(cotacao.pesoG).toBe(corpoValido.pesoG)
    expect(cotacao.alturaCm).toBe(corpoValido.alturaCm)
    expect(cotacao.opcoes.length).toBeGreaterThan(0)
  })

  it('não entrega a cotação de outro usuário — responde como inexistente', async () => {
    const dono = await criarUsuarioDeTeste(50_000)
    const bisbilhoteiro = await criarUsuarioDeTeste(50_000)

    const criada = await POST(criarRequest(corpoValido, await criarSessionId(dono.id)))
    const { quoteId } = await criada.json()

    const response = await GET(criarRequestGet(quoteId, await criarSessionId(bisbilhoteiro.id)))
    expect(response.status).toBe(404)
    expect((await response.json()).codigo).toBe('COTACAO_NAO_ENCONTRADA')
  })

  it('exige o quoteId', async () => {
    const response = await GET(criarRequestGet(null))
    expect(response.status).toBe(400)
  })
})
