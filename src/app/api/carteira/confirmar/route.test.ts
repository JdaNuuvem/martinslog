import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { criarRecarga } from '@/server/wallet-service'
import { POST } from './route'

let contador = 0
const usuariosCriados: string[] = []

async function criarUsuarioDeTeste(papel: 'CLIENTE' | 'ADMIN'): Promise<string> {
  contador += 1
  const sufixo = `${Date.now()}${contador}`
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: String(contador).padStart(11, '8'),
      nome: `Usuário Teste Confirmar ${papel}`,
      email: `confirmar-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

async function criarSessionId(userId: string): Promise<string> {
  return criarSessao(userId, NextResponse.json({}))
}

function criarRequest(sessionId: string | null, body?: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return new NextRequest('http://localhost/api/carteira/confirmar', {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function saldoDe(userId: string): Promise<number> {
  const wallet = await prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } })
  return wallet.saldoCentavos
}

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
  await prisma.paymentIntent.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('POST /api/carteira/confirmar', () => {
  it('devolve 403 e não altera o saldo quando quem chama é CLIENTE, não ADMIN', async () => {
    const clienteId = await criarUsuarioDeTeste('CLIENTE')
    const recarga = await criarRecarga(clienteId, 5000)
    const saldoAntes = await saldoDe(clienteId)

    const sessionId = await criarSessionId(clienteId)
    const resposta = await POST(criarRequest(sessionId, { paymentIntentId: recarga.paymentIntentId }))

    expect(resposta.status).toBe(403)
    expect(await saldoDe(clienteId)).toBe(saldoAntes)
  })

  it('devolve 401 e não altera o saldo quando não há sessão', async () => {
    const clienteId = await criarUsuarioDeTeste('CLIENTE')
    const recarga = await criarRecarga(clienteId, 5000)
    const saldoAntes = await saldoDe(clienteId)

    const resposta = await POST(criarRequest(null, { paymentIntentId: recarga.paymentIntentId }))

    expect(resposta.status).toBe(401)
    expect(await saldoDe(clienteId)).toBe(saldoAntes)
  })

  it('devolve 204 e credita o saldo do dono do PaymentIntent quando quem chama é ADMIN', async () => {
    const clienteId = await criarUsuarioDeTeste('CLIENTE')
    const adminId = await criarUsuarioDeTeste('ADMIN')
    const recarga = await criarRecarga(clienteId, 5000)

    const sessionId = await criarSessionId(adminId)
    const resposta = await POST(criarRequest(sessionId, { paymentIntentId: recarga.paymentIntentId }))

    expect(resposta.status).toBe(204)
    expect(await saldoDe(clienteId)).toBe(5000)
  })

  it('admin confirmando o intent de outro usuário credita a carteira do dono do intent, não a do admin', async () => {
    const donoId = await criarUsuarioDeTeste('CLIENTE')
    const adminId = await criarUsuarioDeTeste('ADMIN')
    const recarga = await criarRecarga(donoId, 7500)
    const saldoAdminAntes = await saldoDe(adminId)

    const sessionId = await criarSessionId(adminId)
    const resposta = await POST(criarRequest(sessionId, { paymentIntentId: recarga.paymentIntentId }))

    expect(resposta.status).toBe(204)
    expect(await saldoDe(donoId)).toBe(7500)
    expect(await saldoDe(adminId)).toBe(saldoAdminAntes)
  })

  it('ignora um userId embutido no corpo tentando redirecionar o crédito: o dinheiro vai para o dono do intent', async () => {
    const donoId = await criarUsuarioDeTeste('CLIENTE')
    const atacanteId = await criarUsuarioDeTeste('CLIENTE')
    const adminId = await criarUsuarioDeTeste('ADMIN')
    const recarga = await criarRecarga(donoId, 4200)
    const saldoAtacanteAntes = await saldoDe(atacanteId)

    const sessionId = await criarSessionId(adminId)
    const resposta = await POST(
      criarRequest(sessionId, { paymentIntentId: recarga.paymentIntentId, userId: atacanteId }),
    )

    expect(resposta.status).toBe(204)
    expect(await saldoDe(donoId)).toBe(4200)
    expect(await saldoDe(atacanteId)).toBe(saldoAtacanteAntes)
  })

  it('confirmações concorrentes do mesmo PaymentIntent (via HTTP) creditam a carteira uma única vez', async () => {
    const clienteId = await criarUsuarioDeTeste('CLIENTE')
    const adminId = await criarUsuarioDeTeste('ADMIN')
    const recarga = await criarRecarga(clienteId, 8000)
    const sessionId = await criarSessionId(adminId)

    const [resposta1, resposta2] = await Promise.all([
      POST(criarRequest(sessionId, { paymentIntentId: recarga.paymentIntentId })),
      POST(criarRequest(sessionId, { paymentIntentId: recarga.paymentIntentId })),
    ])

    expect([resposta1.status, resposta2.status]).toEqual([204, 204])
    expect(await saldoDe(clienteId)).toBe(8000)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: clienteId } })
    const creditos = await prisma.ledgerEntry.count({
      where: { walletId: wallet.id, tipo: 'CREDITO', refTipo: 'PAYMENT_INTENT', refId: recarga.paymentIntentId },
    })
    expect(creditos).toBe(1)
  })
})
