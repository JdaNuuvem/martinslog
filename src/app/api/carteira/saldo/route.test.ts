import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarUsuarioComSaldo } from '@/test/factories'
import { GET } from './route'

const usuariosCriados: string[] = []

async function usuarioComSessao(saldoCentavos: number): Promise<string> {
  const user = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(user.id)
  return criarSessao(user.id, NextResponse.json({}))
}

function requisicao(sessionId: string | null): NextRequest {
  const headers = new Headers()
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  return new NextRequest('http://localhost/api/carteira/saldo', { headers })
}

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('GET /api/carteira/saldo', () => {
  it('devolve o saldo real da carteira do usuário', async () => {
    const sessionId = await usuarioComSessao(16_500)

    const resposta = await GET(requisicao(sessionId))
    expect(resposta.status).toBe(200)
    expect(await resposta.json()).toEqual({ saldoCentavos: 16_500 })
  })

  it('devolve zero para carteira ainda sem lançamento, sem quebrar', async () => {
    const sessionId = await usuarioComSessao(0)

    const resposta = await GET(requisicao(sessionId))
    expect(await resposta.json()).toEqual({ saldoCentavos: 0 })
  })

  it('não devolve saldo sem sessão', async () => {
    const resposta = await GET(requisicao(null))
    expect(resposta.status).toBe(401)
  })

  it('não devolve o extrato: a topbar só precisa do número', async () => {
    const sessionId = await usuarioComSessao(500)

    const corpo = (await (await GET(requisicao(sessionId))).json()) as Record<string, unknown>
    expect(Object.keys(corpo)).toEqual(['saldoCentavos'])
  })
})
