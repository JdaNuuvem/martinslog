import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { POST } from './route'
import { POST as POST_SESSOES } from '../sessoes/route'
import { POST as POST_EMAIL } from '../email-verificado/route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoAdmin = ''
let sessaoCliente = ''
let alvoId = ''

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE', indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `7${indice}${sufixo}`.padEnd(11, '2').slice(0, 11),
      nome: `Usuário rota papel ${papel}`,
      email: `rota-papel-${papel.toLowerCase()}-${indice}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return { userId: user.id, sessionId: await criarSessao(user.id, NextResponse.json({})) }
}

function requisicao(sessionId: string | null, body: unknown, url: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  return new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

beforeAll(async () => {
  const admin = await criarUsuario('ADMIN', 1)
  const cliente = await criarUsuario('CLIENTE', 2)
  const alvo = await criarUsuario('CLIENTE', 3)
  sessaoAdmin = admin.sessionId
  sessaoCliente = cliente.sessionId
  alvoId = alvo.userId
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entidadeId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('POST /api/admin/usuarios/[id]/papel', () => {
  it('devolve 404 para cliente comum e não altera nada no banco', async () => {
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: alvoId } })

    const resposta = await POST(
      requisicao(sessaoCliente, { papel: 'ADMIN' }, `http://localhost/api/admin/usuarios/${alvoId}/papel`),
      { params: Promise.resolve({ id: alvoId }) },
    )
    expect(resposta.status).toBe(404)

    const anonima = await POST(
      requisicao(null, { papel: 'ADMIN' }, `http://localhost/api/admin/usuarios/${alvoId}/papel`),
      { params: Promise.resolve({ id: alvoId }) },
    )
    expect(anonima.status).toBe(404)

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: alvoId } })
    expect(depois.papel).toBe(antes.papel)
  })

  it('admin promove o alvo a administrador com sucesso', async () => {
    const resposta = await POST(
      requisicao(sessaoAdmin, { papel: 'ADMIN' }, `http://localhost/api/admin/usuarios/${alvoId}/papel`),
      { params: Promise.resolve({ id: alvoId }) },
    )
    expect(resposta.status).toBe(200)

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: alvoId } })
    expect(usuario.papel).toBe('ADMIN')
  })
})

describe('POST /api/admin/usuarios/[id]/sessoes e /email-verificado', () => {
  it('devolvem 404 para cliente comum', async () => {
    const respostaSessoes = await POST_SESSOES(
      requisicao(sessaoCliente, {}, `http://localhost/api/admin/usuarios/${alvoId}/sessoes`),
      { params: Promise.resolve({ id: alvoId }) },
    )
    expect(respostaSessoes.status).toBe(404)

    const respostaEmail = await POST_EMAIL(
      requisicao(sessaoCliente, {}, `http://localhost/api/admin/usuarios/${alvoId}/email-verificado`),
      { params: Promise.resolve({ id: alvoId }) },
    )
    expect(respostaEmail.status).toBe(404)

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: alvoId } })
    expect(usuario.emailVerificadoEm).toBeNull()
  })
})
