import { randomUUID } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import type { PapelUser } from '@prisma/client'
import { prisma } from '@/infra/db/client'

/**
 * A leitura/escrita de sessão usa os cookies do `NextRequest`/`NextResponse`
 * (o mesmo mecanismo já usado por `/api/cotacao` para a `AnonSession`), em
 * vez de `next/headers` — isso evita ter dois mecanismos de cookie
 * divergentes e mantém as funções testáveis fora do runtime completo do
 * Next (que só disponibiliza `cookies()` de `next/headers` dentro de uma
 * requisição real do App Router).
 */
export const SESSION_COOKIE = 'session_id'
const SESSAO_DIAS = 30
const SESSAO_MS = SESSAO_DIAS * 24 * 60 * 60 * 1000

/**
 * Cria uma sessão autenticada: grava um registro `Session` com expiração de
 * 30 dias e escreve o cookie de sessão (httpOnly, SameSite=Lax, Secure em
 * produção) na resposta informada. O identificador vem de
 * `crypto.randomUUID()` — nunca de contador ou `Math.random()`. Nenhum
 * papel (`PapelUser`) é guardado no cookie: um cookie adulterado não pode
 * virar um papel diferente, porque `lerSessao` sempre confere o papel no
 * banco.
 */
export async function criarSessao(userId: string, response: NextResponse): Promise<string> {
  const id = randomUUID()
  const expiraEm = new Date(Date.now() + SESSAO_MS)

  await prisma.session.create({ data: { id, userId, expiraEm } })

  response.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSAO_MS / 1000,
  })

  return id
}

/**
 * Lê a sessão atual a partir do cookie da requisição. Nunca confia apenas
 * no cookie: a cada leitura, valida no banco que a sessão existe e não
 * expirou. Um cookie roubado ou adulterado (id inexistente, ou sessão já
 * expirada) não autentica.
 */
export async function lerSessao(
  request: NextRequest,
): Promise<{ userId: string; papel: PapelUser } | null> {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value
  if (!sessionId) {
    return null
  }

  const sessao = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: { papel: true } } },
  })

  if (!sessao || sessao.expiraEm.getTime() <= Date.now()) {
    return null
  }

  return { userId: sessao.userId, papel: sessao.user.papel }
}

/**
 * Encerra a sessão atual: remove o registro no banco e apaga o cookie da
 * resposta informada.
 */
export async function encerrarSessao(request: NextRequest, response: NextResponse): Promise<void> {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value

  if (sessionId) {
    await prisma.session.deleteMany({ where: { id: sessionId } })
  }

  response.cookies.delete(SESSION_COOKIE)
}
