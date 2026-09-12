import { NextRequest, NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE } from '@/server/auth/sessao'
import { registrarLead } from '@/server/lead-service'
import { POR_PAGINA } from '@/lib/leads-schema'
import { GET } from './route'

const sufixo = String(Date.now()).slice(-6)
const usuariosCriados: string[] = []
let sessaoAdmin = ''
let sessaoCliente = ''
let adminId = ''

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE', indice: number): Promise<{ id: string; sessao: string }> {
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: `8${indice}${sufixo}`.padEnd(11, '9').slice(0, 11),
      nome: `Usuário ${papel} rota exportação leads`,
      email: `rota-exportar-leads-${papel.toLowerCase()}-${sufixo}-${Date.now()}${indice}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  const sessao = await criarSessao(user.id, NextResponse.json({}))
  return { id: user.id, sessao }
}

beforeAll(async () => {
  const admin = await criarUsuario('ADMIN', 1)
  sessaoAdmin = admin.sessao
  adminId = admin.id
  sessaoCliente = (await criarUsuario('CLIENTE', 2)).sessao
})

beforeEach(async () => {
  await prisma.lead.deleteMany({})
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
  await prisma.lead.deleteMany({})
})

function requisitar(sessionId: string | null, query: string): Promise<NextResponse> {
  const headers = new Headers()
  if (sessionId) headers.set('cookie', `${SESSION_COOKIE}=${sessionId}`)

  return GET(new NextRequest(`http://localhost/api/admin/leads/exportar${query}`, { headers }))
}

/** Telefone brasileiro de 11 dígitos, distinto por índice. */
function telefoneDistinto(indice: number): string {
  return `119${String(indice).padStart(8, '0')}`
}

describe('GET /api/admin/leads/exportar', () => {
  it('devolve 404 para quem não é admin', async () => {
    const requisicao = new NextRequest('http://localhost/api/admin/leads/exportar')

    expect((await GET(requisicao)).status).toBe(404)
  })

  it('devolve 404 para cliente autenticado', async () => {
    const resposta = await requisitar(sessaoCliente, '')

    expect(resposta.status).toBe(404)
  })

  it('exportação padrão traz o CPF mascarado, sem o número completo em lugar nenhum', async () => {
    const cpf = '52998224725'
    await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date(),
      nome: 'Comprador CPF Mascarado',
      email: 'cpf-mascarado@teste.com',
      telefone: telefoneDistinto(1),
      cpf,
    })

    const resposta = await requisitar(sessaoAdmin, '')
    expect(resposta.status).toBe(200)

    const corpo = await resposta.text()
    expect(corpo).not.toContain(cpf)
    expect(corpo).toContain('***.')
  })

  it('exportação com cpfCompleto=true grava AuditLog com ação LEADS_EXPORTADOS', async () => {
    const cpf = '52998224725'
    await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date(),
      nome: 'Comprador CPF Completo',
      email: 'cpf-completo@teste.com',
      telefone: telefoneDistinto(2),
      cpf,
    })

    const resposta = await requisitar(sessaoAdmin, '?cpfCompleto=true')
    expect(resposta.status).toBe(200)

    const corpo = await resposta.text()
    expect(corpo).toContain(cpf)

    const registro = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, acao: 'LEADS_EXPORTADOS' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(registro).not.toBeNull()
    expect(registro?.entidade).toBe('Lead')
  })

  it('CPF cifrado ilegível vira célula "ilegível" e é contado na auditoria', async () => {
    const leadId = await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date(),
      nome: 'Comprador CPF Ilegível',
      telefone: telefoneDistinto(5001),
      cpf: '52998224725',
    })
    await prisma.lead.update({ where: { id: leadId! }, data: { cpfCifrado: 'c1:00:00:00' } })

    const resposta = await requisitar(sessaoAdmin, '?cpfCompleto=true')
    expect(resposta.status).toBe(200)
    expect(await resposta.text()).toContain('ilegível')

    const registro = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, acao: 'LEADS_EXPORTADOS' },
      orderBy: { criadoEm: 'desc' },
    })
    expect((registro?.depois as { cpfsIlegiveis: number }).cpfsIlegiveis).toBe(1)
  })

  it('traz TODAS as linhas do filtro, não só a primeira página', async () => {
    const quantidade = POR_PAGINA + 5

    for (let i = 0; i < quantidade; i++) {
      await registrarLead({
        tipo: 'PEDIDO_PAGO',
        ocorridoEm: new Date(),
        nome: `Comprador Página ${i}`,
        telefone: telefoneDistinto(1000 + i),
      })
    }

    const resposta = await requisitar(sessaoAdmin, '')
    expect(resposta.status).toBe(200)

    const corpo = await resposta.text()
    const linhas = corpo.split('\n').filter((linha) => linha.length > 0)
    // -1 pelo cabeçalho.
    expect(linhas.length - 1).toBe(quantidade)
  })

  it('respeita o filtro de origem', async () => {
    await registrarLead({
      tipo: 'CONVERSA',
      ocorridoEm: new Date(),
      nome: 'Lead de Conversa',
      telefone: telefoneDistinto(2001),
    })
    await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date(),
      nome: 'Lead de Pedido',
      telefone: telefoneDistinto(2002),
    })

    const resposta = await requisitar(sessaoAdmin, '?origem=CONVERSA')
    expect(resposta.status).toBe(200)

    const corpo = await resposta.text()
    expect(corpo).toContain('Lead de Conversa')
    expect(corpo).not.toContain('Lead de Pedido')
  })

  it('a auditoria não guarda o termo buscado', async () => {
    const cpf = '52998224725'
    await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date(),
      nome: 'Comprador Buscado por CPF',
      telefone: telefoneDistinto(4001),
      cpf,
    })

    const resposta = await requisitar(sessaoAdmin, `?busca=${cpf}`)
    expect(resposta.status).toBe(200)

    const registro = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, acao: 'LEADS_EXPORTADOS' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(registro).not.toBeNull()
    expect(JSON.stringify(registro?.depois)).not.toContain(cpf)
    expect((registro?.depois as { filtros: { buscaInformada: boolean } }).filtros.buscaInformada).toBe(
      true,
    )
  })

  it('a auditoria não guarda texto cru dos parâmetros de data', async () => {
    const valorNaoData = '52998224725'

    const resposta = await requisitar(sessaoAdmin, `?desde=${valorNaoData}&ate=2026-03-10`)
    expect(resposta.status).toBe(200)

    const registro = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, acao: 'LEADS_EXPORTADOS' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(registro).not.toBeNull()
    expect(JSON.stringify(registro?.depois)).not.toContain(valorNaoData)

    const filtros = (registro?.depois as { filtros: { desde: string | null; ate: string | null } })
      .filtros
    expect(filtros.desde).toBeNull()
    expect(filtros.ate).toBe('2026-03-11T02:59:59.999Z')
  })

  it('neutraliza fórmula que começa com tabulação ou retorno de carro', async () => {
    /*
      Direto pelo Prisma, e não por `registrarLead`: o serviço faz `.trim()`
      no nome antes de gravar, o que já removeria o próprio caractere que
      este teste precisa preservar para verificar a neutralização.
    */
    const agora = new Date()
    await prisma.lead.createMany({
      data: [
        {
          nome: '\t=1+1',
          telefoneNormalizado: telefoneDistinto(4002),
          primeiroContatoEm: agora,
          ultimoContatoEm: agora,
        },
        {
          nome: '\r=1+1',
          telefoneNormalizado: telefoneDistinto(4003),
          primeiroContatoEm: agora,
          ultimoContatoEm: agora,
        },
      ],
    })

    const resposta = await requisitar(sessaoAdmin, '')
    expect(resposta.status).toBe(200)

    const corpo = await resposta.text()
    expect(corpo).toContain("'\t=1+1")
    expect(corpo).toContain("'\r=1+1")
  })

  it('respeita o filtro de período, incluindo o próprio dia de "ate"', async () => {
    await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date('2026-03-10T12:00:00-03:00'),
      nome: 'Lead Dentro do Período',
      telefone: telefoneDistinto(3001),
    })
    await registrarLead({
      tipo: 'PEDIDO_PAGO',
      ocorridoEm: new Date('2026-03-15T12:00:00-03:00'),
      nome: 'Lead Fora do Período',
      telefone: telefoneDistinto(3002),
    })

    const resposta = await requisitar(sessaoAdmin, '?desde=2026-03-01&ate=2026-03-10')
    expect(resposta.status).toBe(200)

    const corpo = await resposta.text()
    expect(corpo).toContain('Lead Dentro do Período')
    expect(corpo).not.toContain('Lead Fora do Período')
  })
})
