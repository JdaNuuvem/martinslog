import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, encerrarSessao, lerSessao, SESSION_COOKIE } from './sessao'

async function criarUsuarioDeTeste(sufixo: string) {
  return prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `1234567890${sufixo}`.slice(0, 11),
      nome: 'Usuário Teste Sessão',
      email: `sessao-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
}

function requestComCookie(sessionId?: string): NextRequest {
  const headers = new Headers()
  if (sessionId) {
    headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  }
  return new NextRequest('http://localhost/qualquer', { headers })
}

const usuariosCriados: string[] = []

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('criarSessao / lerSessao / encerrarSessao', () => {
  it('cria sessão no banco com expiração de 30 dias e grava cookie httpOnly na resposta', async () => {
    const usuario = await criarUsuarioDeTeste('1')
    usuariosCriados.push(usuario.id)

    const antes = Date.now()
    const resposta = NextResponse.json({})
    const sessionId = await criarSessao(usuario.id, resposta)
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(10)

    const cookie = resposta.cookies.get(SESSION_COOKIE)
    expect(cookie?.value).toBe(sessionId)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')

    const registrada = await prisma.session.findUnique({ where: { id: sessionId } })
    expect(registrada).not.toBeNull()
    expect(registrada!.userId).toBe(usuario.id)

    const diasRestantes = (registrada!.expiraEm.getTime() - antes) / (24 * 60 * 60 * 1000)
    expect(diasRestantes).toBeGreaterThan(29.9)
    expect(diasRestantes).toBeLessThan(30.1)
  })

  it('lerSessao devolve userId e papel quando a sessão é válida', async () => {
    const usuario = await criarUsuarioDeTeste('2')
    usuariosCriados.push(usuario.id)

    const sessionId = await criarSessao(usuario.id, NextResponse.json({}))
    const sessao = await lerSessao(requestComCookie(sessionId))

    expect(sessao).toEqual({ userId: usuario.id, papel: 'CLIENTE' })
  })

  it('lerSessao devolve null quando não há cookie', async () => {
    const sessao = await lerSessao(requestComCookie())
    expect(sessao).toBeNull()
  })

  it('lerSessao devolve null quando o cookie aponta para uma sessão inexistente', async () => {
    const sessao = await lerSessao(requestComCookie('sessao-forjada-que-nao-existe'))
    expect(sessao).toBeNull()
  })

  it('lerSessao devolve null quando a sessão está expirada no banco, mesmo com o cookie presente', async () => {
    const usuario = await criarUsuarioDeTeste('3')
    usuariosCriados.push(usuario.id)

    const sessionId = await criarSessao(usuario.id, NextResponse.json({}))
    // Adultera a sessão diretamente no banco para simular expiração.
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiraEm: new Date(Date.now() - 1000) },
    })

    const sessao = await lerSessao(requestComCookie(sessionId))
    expect(sessao).toBeNull()
  })

  it('encerrarSessao remove o registro do banco e apaga o cookie da resposta', async () => {
    const usuario = await criarUsuarioDeTeste('4')
    usuariosCriados.push(usuario.id)

    const sessionId = await criarSessao(usuario.id, NextResponse.json({}))
    const resposta = NextResponse.json({})
    await encerrarSessao(requestComCookie(sessionId), resposta)

    expect(resposta.cookies.get(SESSION_COOKIE)?.value).toBe('')
    const registrada = await prisma.session.findUnique({ where: { id: sessionId } })
    expect(registrada).toBeNull()
  })
})
