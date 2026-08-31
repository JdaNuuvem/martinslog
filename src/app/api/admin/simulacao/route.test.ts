import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { ID_CONFIG_SIMULACAO } from '@/server/simulacao-config'
import { POST } from './route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoAdmin = ''
let sessaoCliente = ''

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE', indice: number): Promise<string> {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `5${indice}${sufixo}`.padEnd(11, '3').slice(0, 11),
      nome: `Usuário ${papel} rota simulação`,
      email: `rota-simulacao-${papel.toLowerCase()}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return criarSessao(user.id, NextResponse.json({}))
}

beforeAll(async () => {
  sessaoAdmin = await criarUsuario('ADMIN', 1)
  sessaoCliente = await criarUsuario('CLIENTE', 2)
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await definirFatorGlobal(1)
})

beforeEach(async () => {
  await definirFatorGlobal(1)
})

async function definirFatorGlobal(fatorVelocidade: number): Promise<void> {
  await prisma.simulacaoConfig.upsert({
    where: { id: ID_CONFIG_SIMULACAO },
    update: { fatorVelocidade },
    create: { id: ID_CONFIG_SIMULACAO, fatorVelocidade },
  })
}

function requisitar(sessionId: string | null, corpo: unknown): Promise<NextResponse> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return POST(
    new NextRequest('http://localhost/api/admin/simulacao', {
      method: 'POST',
      headers,
      body: JSON.stringify(corpo),
    }),
  )
}

async function fatorAtual(): Promise<number> {
  const config = await prisma.simulacaoConfig.findUniqueOrThrow({
    where: { id: ID_CONFIG_SIMULACAO },
  })
  return config.fatorVelocidade
}

describe('POST /api/admin/simulacao', () => {
  it('admin define o fator de velocidade e recebe 200', async () => {
    const resposta = await requisitar(sessaoAdmin, { fatorVelocidade: 288 })

    expect(resposta.status).toBe(200)
    expect(await fatorAtual()).toBe(288)
  })

  it('cliente autenticado recebe 404, nunca 403, e o fator não muda', async () => {
    const resposta = await requisitar(sessaoCliente, { fatorVelocidade: 288 })

    expect(resposta.status).toBe(404)
    expect(await fatorAtual()).toBe(1)
  })

  it('anônimo recebe 404 e o fator não muda', async () => {
    const resposta = await requisitar(null, { fatorVelocidade: 288 })

    expect(resposta.status).toBe(404)
    expect(await fatorAtual()).toBe(1)
  })

  it('corpo inválido recebe 400 e o fator não muda', async () => {
    for (const corpo of [
      { fatorVelocidade: 0 },
      { fatorVelocidade: -5 },
      { fatorVelocidade: 1.5 },
      { fatorVelocidade: 20_000 },
      { fatorVelocidade: 'rápido' },
      {},
    ]) {
      const resposta = await requisitar(sessaoAdmin, corpo)
      expect(resposta.status).toBe(400)
    }

    expect(await fatorAtual()).toBe(1)
  })

  it('grava auditoria da mudança', async () => {
    await requisitar(sessaoAdmin, { fatorVelocidade: 24 })

    const log = await prisma.auditLog.findFirst({
      where: { acao: 'SIMULACAO_FATOR_VELOCIDADE', actorUserId: { in: usuariosCriados } },
      orderBy: { criadoEm: 'desc' },
    })
    expect(log?.depois).toMatchObject({ fatorVelocidade: 24 })
  })
})
