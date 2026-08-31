import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { GET } from './route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoDono = ''
let sessaoOutro = ''
let serviceId = ''

async function criarUsuarioComSessao(rotulo: string, indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `9${indice}${sufixo}`.padEnd(11, '1').slice(0, 11),
      nome: `Usuário rota meus envios ${rotulo}`,
      email: `rota-meus-envios-${rotulo}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return { userId: user.id, sessionId: await criarSessao(user.id, NextResponse.json({})) }
}

function requisitar(sessionId: string | null, filtro?: string) {
  const headers = new Headers()
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)
  const url = filtro
    ? `http://localhost/api/envios/meus?filtro=${filtro}`
    : 'http://localhost/api/envios/meus'

  return GET(new NextRequest(url, { headers }))
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: `ROTA-MEUS-${sufixo}` } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: `ROTA-MEUS-${sufixo}`,
      nome: 'Serviço da rota de listagem',
      prazoBase: 2,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  const dono = await criarUsuarioComSessao('dono', 1)
  const outro = await criarUsuarioComSessao('outro', 2)
  sessaoDono = dono.sessionId
  sessaoOutro = outro.sessionId

  await prisma.shipment.create({
    data: {
      userId: dono.userId,
      serviceId,
      status: 'POSTED',
      codigoRastreio: null,
      remetente: { nome: 'Remetente', cidade: 'São Paulo', uf: 'SP' },
      destinatario: {
        nome: 'Ana Julia',
        documento: '11122233344',
        logradouro: 'Rua Secreta, 42',
        cidade: 'Curitiba',
        uf: 'PR',
      },
      precoBalcaoCentavos: 3000,
      precoCobradoCentavos: 2500,
      descontoCentavos: 500,
      opcionais: {},
      valorDeclaradoCentavos: 0,
      produtos: [],
    },
  })
})

afterAll(async () => {
  await prisma.shipment.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('GET /api/envios/meus', () => {
  it('exige sessão', async () => {
    expect((await requisitar(null)).status).toBe(401)
  })

  it('devolve os envios do usuário com as contagens das abas', async () => {
    const resposta = await requisitar(sessaoDono)

    expect(resposta.status).toBe(200)
    const corpo = await resposta.json()
    expect(corpo.envios).toHaveLength(1)
    expect(corpo.envios[0].destinatarioNome).toBe('Ana Julia')
    expect(corpo.contagem).toEqual({ todos: 1, pendentes: 1, entregues: 0 })
  })

  it('não devolve envio de outro usuário', async () => {
    const corpo = await (await requisitar(sessaoOutro)).json()

    expect(corpo.envios).toEqual([])
  })

  it('filtro inválido cai em todos, sem quebrar a tela', async () => {
    const resposta = await requisitar(sessaoDono, 'inventado')

    expect(resposta.status).toBe(200)
    expect((await resposta.json()).envios).toHaveLength(1)
  })

  it('respeita o filtro de entregues', async () => {
    const corpo = await (await requisitar(sessaoDono, 'entregues')).json()

    expect(corpo.envios).toEqual([])
    expect(corpo.contagem.todos).toBe(1)
  })

  it('não expõe documento nem logradouro do destinatário', async () => {
    const cru = JSON.stringify(await (await requisitar(sessaoDono)).json())

    expect(cru).not.toContain('11122233344')
    expect(cru).not.toContain('Rua Secreta')
  })
})
