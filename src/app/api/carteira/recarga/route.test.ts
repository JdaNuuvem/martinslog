import { NextRequest, NextResponse } from 'next/server'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { VALOR_MAXIMO_RECARGA_CENTAVOS, VALOR_MINIMO_RECARGA_CENTAVOS } from '@/lib/carteira-schema'
import { POST } from './route'

let contador = 0
const usuariosCriados: string[] = []

async function criarUsuarioDeTeste(): Promise<string> {
  contador += 1
  const sufixo = `${Date.now()}${contador}`
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: String(contador).padStart(11, '7'),
      nome: 'Usuário Teste Recarga',
      email: `recarga-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

async function criarSessionId(userId: string): Promise<string> {
  return criarSessao(userId, NextResponse.json({}))
}

const NBSP = String.fromCharCode(160)

// `toLocaleString('pt-BR', { style: 'currency', ... })` usa NBSP (U+00A0)
// entre "R$" e o valor — normaliza para espaço comum antes de comparar,
// para não depender de um caractere invisível no teste.
function semEspacoFino(texto: string): string {
  return texto.split(NBSP).join(' ')
}

function criarRequest(sessionId: string | null, body?: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return new NextRequest('http://localhost/api/carteira/recarga', {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
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

describe('POST /api/carteira/recarga — faixa de valor', () => {
  it(`rejeita ${VALOR_MINIMO_RECARGA_CENTAVOS - 1} centavos com a mensagem do valor mínimo`, async () => {
    const userId = await criarUsuarioDeTeste()
    const sessionId = await criarSessionId(userId)

    const resposta = await POST(criarRequest(sessionId, { valorCentavos: VALOR_MINIMO_RECARGA_CENTAVOS - 1 }))

    expect(resposta.status).toBe(400)
    const corpo = await resposta.json()
    const mensagem = semEspacoFino(corpo.mensagem)
    expect(mensagem).toContain('R$ 5,00')
    expect(mensagem.toLowerCase()).toContain('mínimo')
  })

  it(`aceita exatamente ${VALOR_MINIMO_RECARGA_CENTAVOS} centavos (o mínimo)`, async () => {
    const userId = await criarUsuarioDeTeste()
    const sessionId = await criarSessionId(userId)

    const resposta = await POST(criarRequest(sessionId, { valorCentavos: VALOR_MINIMO_RECARGA_CENTAVOS }))

    expect(resposta.status).toBe(201)
  })

  it(`rejeita ${VALOR_MAXIMO_RECARGA_CENTAVOS + 1} centavos com a mensagem do valor máximo`, async () => {
    const userId = await criarUsuarioDeTeste()
    const sessionId = await criarSessionId(userId)

    const resposta = await POST(criarRequest(sessionId, { valorCentavos: VALOR_MAXIMO_RECARGA_CENTAVOS + 1 }))

    expect(resposta.status).toBe(400)
    const corpo = await resposta.json()
    const mensagem = semEspacoFino(corpo.mensagem)
    expect(mensagem).toContain('R$ 5.000,00')
    expect(mensagem.toLowerCase()).toContain('máximo')
  })

  it(`aceita exatamente ${VALOR_MAXIMO_RECARGA_CENTAVOS} centavos (o máximo)`, async () => {
    const userId = await criarUsuarioDeTeste()
    const sessionId = await criarSessionId(userId)

    const resposta = await POST(criarRequest(sessionId, { valorCentavos: VALOR_MAXIMO_RECARGA_CENTAVOS }))

    expect(resposta.status).toBe(201)
  })

  it('os valores sugeridos da interface (R$ 20, R$ 50, R$ 100) estão dentro da faixa permitida', () => {
    const sugeridosCentavos = [2000, 5000, 10000]
    for (const valor of sugeridosCentavos) {
      expect(valor).toBeGreaterThanOrEqual(VALOR_MINIMO_RECARGA_CENTAVOS)
      expect(valor).toBeLessThanOrEqual(VALOR_MAXIMO_RECARGA_CENTAVOS)
    }
  })
})
