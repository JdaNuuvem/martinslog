import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { gerarSegredo } from '@/server/webhook-service'
import { POST } from './route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoAdmin = ''
let sessaoCliente = ''
let clienteId = ''

async function criarUsuarioComSessao(papel: 'ADMIN' | 'CLIENTE', indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `8${indice}${sufixo}`.padEnd(11, '3').slice(0, 11),
      nome: `Usuário disparo ${papel}`,
      email: `disparo-${papel.toLowerCase()}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return { userId: user.id, sessionId: await criarSessao(user.id, NextResponse.json({})) }
}

function requisitar(sessionId: string | null, authorization?: string) {
  const headers = new Headers()
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  if (authorization) headers.set('authorization', authorization)
  return POST(
    new NextRequest('http://localhost/api/admin/webhooks/disparar', { method: 'POST', headers }),
  )
}

beforeAll(async () => {
  const admin = await criarUsuarioComSessao('ADMIN', 1)
  const cliente = await criarUsuarioComSessao('CLIENTE', 2)
  sessaoAdmin = admin.sessionId
  sessaoCliente = cliente.sessionId
  clienteId = cliente.userId
})

afterAll(async () => {
  await prisma.webhookDelivery.deleteMany({
    where: { webhookApp: { userId: { in: usuariosCriados } } },
  })
  await prisma.webhookApp.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('POST /api/admin/webhooks/disparar', () => {
  it('devolve 404 para usuário CLIENTE — não confirma que a rota existe', async () => {
    const cliente = await requisitar(sessaoCliente)
    const anonimo = await requisitar(null)

    expect(cliente.status).toBe(404)
    expect(anonimo.status).toBe(404)
    expect(await cliente.json()).toEqual(await anonimo.json())
  })

  it('não processa a fila quando quem chama não é admin', async () => {
    const app = await prisma.webhookApp.create({
      data: {
        userId: clienteId,
        url: 'https://disparo.exemplo.com.br/hook',
        eventos: ['order.created'],
        segredo: gerarSegredo(),
      },
    })
    const entrega = await prisma.webhookDelivery.create({
      data: {
        webhookAppId: app.id,
        evento: 'order.created',
        payload: { event: 'order.created', data: {} },
        proximaTentativaEm: new Date(),
      },
    })
    const espiao = vi.spyOn(globalThis, 'fetch')

    await requisitar(sessaoCliente)

    expect(espiao).not.toHaveBeenCalled()
    const intacta = await prisma.webhookDelivery.findUnique({ where: { id: entrega.id } })
    expect(intacta?.tentativas).toBe(0)
    vi.restoreAllMocks()
  })

  it('recusa token de cron quando WEBHOOK_CRON_TOKEN não está configurado', async () => {
    // O ambiente de teste não define a variável: a via do agendador fica
    // fechada e a rota responde como para qualquer não-administrador.
    const resposta = await requisitar(null, `Bearer ${'a'.repeat(48)}`)

    expect(resposta.status).toBe(404)
  })

  it('processa a fila para um administrador e devolve o resumo', async () => {
    // A fila é global e outros arquivos de teste enfileiram entregas com URL
    // fictícia: sem este mock, o disparo tentaria resolver e alcançar hosts
    // de verdade, e o teste passaria a depender de rede e de tempo.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const resposta = await requisitar(sessaoAdmin)

    expect(resposta.status).toBe(200)
    const { resultado } = await resposta.json()
    expect(resultado).toEqual({
      entregues: expect.any(Number),
      falhas: expect.any(Number),
      desistidas: expect.any(Number),
      restantes: expect.any(Number),
    })
    vi.restoreAllMocks()
  })
})
