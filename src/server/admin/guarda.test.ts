import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { exigirAdmin, respostaNaoEncontrado } from './guarda'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []

let sessaoAdmin = ''
let sessaoCliente = ''
let adminId = ''

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE', indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `9${indice}${sufixo}`.padEnd(11, '5').slice(0, 11),
      nome: `Usuário ${papel}`,
      email: `admin-guarda-${papel.toLowerCase()}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  const sessionId = await criarSessao(user.id, NextResponse.json({}))
  return { userId: user.id, sessionId }
}

function requisicao(sessionId: string | null): NextRequest {
  const headers = new Headers()
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  return new NextRequest('http://localhost/api/admin/envios', { headers })
}

beforeAll(async () => {
  const admin = await criarUsuario('ADMIN', 1)
  const cliente = await criarUsuario('CLIENTE', 2)
  sessaoAdmin = admin.sessionId
  adminId = admin.userId
  sessaoCliente = cliente.sessionId
})

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('exigirAdmin', () => {
  it('deixa passar quem tem papel ADMIN, devolvendo a sessão', async () => {
    const resultado = await exigirAdmin(requisicao(sessaoAdmin))

    expect(resultado.autorizado).toBe(true)
    if (resultado.autorizado) {
      expect(resultado.sessao.userId).toBe(adminId)
      expect(resultado.sessao.papel).toBe('ADMIN')
    }
  })

  it('barra usuário CLIENTE autenticado', async () => {
    const resultado = await exigirAdmin(requisicao(sessaoCliente))

    expect(resultado.autorizado).toBe(false)
  })

  it('barra requisição sem sessão', async () => {
    const resultado = await exigirAdmin(requisicao(null))

    expect(resultado.autorizado).toBe(false)
  })

  it('barra cookie de sessão inexistente', async () => {
    const resultado = await exigirAdmin(requisicao('sessao-que-nunca-existiu'))

    expect(resultado.autorizado).toBe(false)
  })

  it('responde 404 — e não 403 — para quem não é admin', async () => {
    // 403 confirmaria que a área existe. Para quem não é admin, a área
    // administrativa simplesmente não existe.
    const cliente = await exigirAdmin(requisicao(sessaoCliente))
    const anonimo = await exigirAdmin(requisicao(null))

    expect(cliente.autorizado).toBe(false)
    expect(anonimo.autorizado).toBe(false)
    if (!cliente.autorizado && !anonimo.autorizado) {
      expect(cliente.resposta.status).toBe(404)
      expect(anonimo.resposta.status).toBe(404)
    }
  })

  it('dá a mesma resposta para cliente autenticado e para anônimo', async () => {
    // Corpos diferentes ("faça login" vs "sem permissão") revelariam a
    // existência da área a quem sondar as duas situações.
    const cliente = await exigirAdmin(requisicao(sessaoCliente))
    const anonimo = await exigirAdmin(requisicao(null))

    if (!cliente.autorizado && !anonimo.autorizado) {
      expect(await cliente.resposta.json()).toEqual(await anonimo.resposta.json())
    }
  })
})

describe('respostaNaoEncontrado', () => {
  it('não vaza nada sobre autenticação na mensagem', async () => {
    const corpo = JSON.stringify(await respostaNaoEncontrado().json())

    for (const termo of ['admin', 'permiss', 'autentic', 'sessão', 'login']) {
      expect(corpo.toLowerCase()).not.toContain(termo.toLowerCase())
    }
  })
})
