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
    expect(await resposta.json()).toEqual({ saldoCentavos: 16_500, isento: false })
  })

  it('devolve zero para carteira ainda sem lançamento, sem quebrar', async () => {
    const sessionId = await usuarioComSessao(0)

    const resposta = await GET(requisicao(sessionId))
    expect(await resposta.json()).toEqual({ saldoCentavos: 0, isento: false })
  })

  it('não devolve saldo sem sessão', async () => {
    const resposta = await GET(requisicao(null))
    expect(resposta.status).toBe(401)
  })

  it('não devolve o extrato: a topbar só precisa do número e da isenção', async () => {
    const sessionId = await usuarioComSessao(500)

    const corpo = (await (await GET(requisicao(sessionId))).json()) as Record<string, unknown>
    // Dois campos, não vinte lançamentos: `isento` entrou porque sem ele a
    // interface mostraria "saldo insuficiente" para quem nunca é cobrado.
    expect(Object.keys(corpo).sort()).toEqual(['isento', 'saldoCentavos'])
  })

  it('administrador vem marcado como isento: ele não paga etiqueta', async () => {
    /*
      A conta que administra a plataforma não é cliente dela. Sem esta marca, a
      topbar mostraria "R$ 0,00" e a revisão do envio ofereceria recarga — um
      bloqueio que o servidor não faz, porque `pagarEnvio` isenta o ADMIN.
    */
    const user = await criarUsuarioComSaldo(0)
    usuariosCriados.push(user.id)
    await prisma.user.update({ where: { id: user.id }, data: { papel: 'ADMIN' } })
    const sessionId = await criarSessao(user.id, NextResponse.json({}))

    const corpo = (await (await GET(requisicao(sessionId))).json()) as Record<string, unknown>
    expect(corpo.isento).toBe(true)
  })
})
