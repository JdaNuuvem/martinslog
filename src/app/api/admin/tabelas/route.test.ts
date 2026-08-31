import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { POST } from './route'

const sufixo = String(Date.now()).slice(-6)
const SERVICO = `ROTA-IMPORT-${sufixo}`
const usuariosCriados: string[] = []
let serviceId = ''
let sessaoAdmin = ''
let sessaoCliente = ''

const CABECALHO =
  'servico;cep_origem_ini;cep_origem_fim;cep_destino_ini;cep_destino_fim;peso_min_g;peso_max_g;preco_balcao;preco_venda;prazo_dias'
const LINHA_VALIDA = `${SERVICO};01000000;19999999;20000000;28999999;0;1000;24,90;14,16;3`

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE', indice: number) {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `3${indice}${sufixo}`.padEnd(11, '7').slice(0, 11),
      nome: `Usuário ${papel} rota tabelas`,
      email: `rota-tabelas-${papel.toLowerCase()}-${sufixo}-${Date.now()}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return criarSessao(user.id, NextResponse.json({}))
}

function requisitar(sessionId: string | null, csv: string | null): Promise<NextResponse> {
  const headers = new Headers()
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  const corpo = new FormData()
  if (csv !== null) {
    corpo.set('arquivo', new File([csv], 'tabela.csv', { type: 'text/csv' }))
  }

  return POST(
    new NextRequest('http://localhost/api/admin/tabelas', {
      method: 'POST',
      headers,
      body: corpo,
    }),
  )
}

beforeAll(async () => {
  const carrier = await prisma.carrier.upsert({
    where: { slug: 'transportadora-propria' },
    update: {},
    create: { nome: 'Transportadora Própria', slug: 'transportadora-propria', ativo: true },
  })
  const service = await prisma.service.upsert({
    where: { carrierId_codigo: { carrierId: carrier.id, codigo: SERVICO } },
    update: {},
    create: {
      carrierId: carrier.id,
      codigo: SERVICO,
      nome: 'Serviço da rota de importação',
      prazoBase: 3,
      limitePesoG: 30000,
      limiteDimensoes: { alturaCm: 100, larguraCm: 100, comprimentoCm: 100 },
    },
  })
  serviceId = service.id

  sessaoAdmin = await criarUsuario('ADMIN', 1)
  sessaoCliente = await criarUsuario('CLIENTE', 2)
})

afterAll(async () => {
  await prisma.priceRule.deleteMany({ where: { serviceId } })
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('POST /api/admin/tabelas', () => {
  it('importa a tabela para um administrador', async () => {
    const resposta = await requisitar(sessaoAdmin, `${CABECALHO}\n${LINHA_VALIDA}`)

    expect(resposta.status).toBe(200)
    expect((await resposta.json()).resultado.importadas).toBe(1)

    const regras = await prisma.priceRule.findMany({ where: { serviceId } })
    expect(regras).toHaveLength(1)
  })

  it('devolve 404 para usuário CLIENTE — chamada direta à API, sem passar pela interface', async () => {
    const resposta = await requisitar(sessaoCliente, `${CABECALHO}\n${LINHA_VALIDA}`)

    expect(resposta.status).toBe(404)
  })

  it('devolve 404 para requisição sem sessão', async () => {
    const resposta = await requisitar(null, `${CABECALHO}\n${LINHA_VALIDA}`)

    expect(resposta.status).toBe(404)
  })

  it('dá a mesma resposta para cliente e para anônimo — não confirma que a rota existe', async () => {
    const cliente = await requisitar(sessaoCliente, `${CABECALHO}\n${LINHA_VALIDA}`)
    const anonimo = await requisitar(null, `${CABECALHO}\n${LINHA_VALIDA}`)

    expect(await cliente.json()).toEqual(await anonimo.json())
  })

  it('não importa nada quando quem chama não é admin', async () => {
    await prisma.priceRule.deleteMany({ where: { serviceId } })

    await requisitar(sessaoCliente, `${CABECALHO}\n${LINHA_VALIDA}`)

    const regras = await prisma.priceRule.findMany({ where: { serviceId } })
    expect(regras).toHaveLength(0)
  })

  it('devolve 422 com o número da linha quando o arquivo tem defeito', async () => {
    const csv = [CABECALHO, LINHA_VALIDA, LINHA_VALIDA.replace(';3', ';zero')].join('\n')

    const resposta = await requisitar(sessaoAdmin, csv)

    expect(resposta.status).toBe(422)
    const corpo = await resposta.json()
    expect(corpo.codigo).toBe('ARQUIVO_INVALIDO')
    expect(corpo.mensagem).toMatch(/linha 3/i)
  })

  it('devolve 422 quando nenhum arquivo é enviado', async () => {
    const resposta = await requisitar(sessaoAdmin, null)

    expect(resposta.status).toBe(422)
    expect((await resposta.json()).codigo).toBe('ARQUIVO_INVALIDO')
  })
})
