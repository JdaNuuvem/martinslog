import { NextRequest, NextResponse } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { gerarSegredo } from '@/server/webhook-service'
import { GET, POST } from './route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoDono = ''
let donoId = ''
let sessaoOutro = ''

async function criarUsuario(rotulo: string, indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `1${indice}${sufixo}`.padEnd(11, '9').slice(0, 11),
      nome: `Usuário rota webhook ${rotulo}`,
      email: `rota-webhook-${rotulo}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return { userId: user.id, sessionId: await criarSessao(user.id, NextResponse.json({})) }
}

function requisitar(sessionId: string | null, corpo?: unknown) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  const request = new NextRequest('http://localhost/api/v0/webhook', {
    method: corpo === undefined ? 'GET' : 'POST',
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })

  return corpo === undefined ? GET(request) : POST(request)
}

beforeAll(async () => {
  const dono = await criarUsuario('dono', 1)
  const outro = await criarUsuario('outro', 2)
  donoId = dono.userId
  sessaoDono = dono.sessionId
  sessaoOutro = outro.sessionId
})

afterEach(async () => {
  await prisma.webhookApp.deleteMany({ where: { userId: { in: usuariosCriados } } })
})

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('POST /api/v0/webhook', () => {
  it('exige sessão', async () => {
    const resposta = await requisitar(null, {
      url: 'https://exemplo.com.br/h',
      eventos: ['order.created'],
    })

    expect(resposta.status).toBe(401)
  })

  it('cadastra e devolve o segredo uma única vez', async () => {
    const resposta = await requisitar(sessaoDono, {
      url: 'https://exemplo.com.br/h',
      eventos: ['order.created'],
    })

    expect(resposta.status).toBe(201)
    expect((await resposta.json()).webhook.segredo).toMatch(/^[0-9a-f]{64}$/)
  })

  it('recusa destino em rede interna com 422', async () => {
    for (const url of ['https://127.0.0.1/h', 'https://169.254.169.254/h', 'http://exemplo.com/h']) {
      const resposta = await requisitar(sessaoDono, { url, eventos: ['order.created'] })
      expect(resposta.status, url).toBe(422)
    }
  })

  it('recusa evento desconhecido com 422', async () => {
    const resposta = await requisitar(sessaoDono, {
      url: 'https://exemplo.com.br/h',
      eventos: ['order.inventado'],
    })

    expect(resposta.status).toBe(422)
  })

  it('recusa corpo que não é JSON válido', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE}=${sessaoDono}`,
    })
    const resposta = await POST(
      new NextRequest('http://localhost/api/v0/webhook', {
        method: 'POST',
        headers,
        body: 'isto não é json',
      }),
    )

    expect(resposta.status).toBe(422)
  })
})

describe('GET /api/v0/webhook', () => {
  it('nunca devolve o segredo na listagem', async () => {
    await prisma.webhookApp.create({
      data: {
        userId: donoId,
        url: 'https://exemplo.com.br/h',
        eventos: ['order.created'],
        segredo: gerarSegredo(),
      },
    })

    const resposta = await requisitar(sessaoDono)
    const cru = JSON.stringify(await resposta.json())

    expect(resposta.status).toBe(200)
    expect(cru).not.toContain('segredo')
  })

  it('não lista webhook de outro usuário', async () => {
    await prisma.webhookApp.create({
      data: {
        userId: donoId,
        url: 'https://exemplo.com.br/h',
        eventos: ['order.created'],
        segredo: gerarSegredo(),
      },
    })

    const resposta = await requisitar(sessaoOutro)

    expect((await resposta.json()).webhooks).toEqual([])
  })

  it('exige sessão', async () => {
    expect((await requisitar(null)).status).toBe(401)
  })
})
