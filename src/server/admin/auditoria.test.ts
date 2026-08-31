import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarUsuarioComSaldo } from '@/test/factories'
import { listarAuditoria, listarFacetas } from './auditoria'

const usuariosCriados: string[] = []
const ENTIDADE_ID = `auditoria-teste-${Date.now()}`

let atorId = ''

beforeAll(async () => {
  const ator = await criarUsuarioComSaldo(0)
  usuariosCriados.push(ator.id)
  atorId = ator.id

  await prisma.auditLog.create({
    data: {
      actorUserId: ator.id,
      acao: 'TESTE_ACAO_A',
      entidade: 'Shipment',
      entidadeId: ENTIDADE_ID,
      antes: { status: 'PENDING' },
      depois: { status: 'RELEASED' },
    },
  })

  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      acao: 'TESTE_ACAO_B',
      entidade: 'Wallet',
      entidadeId: ENTIDADE_ID,
      antes: undefined,
      depois: { saldoCentavos: 100 },
    },
  })
})

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entidadeId: ENTIDADE_ID } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('listarAuditoria', () => {
  it('lista os registros da entidade, do mais recente para o mais antigo', async () => {
    const lista = await listarAuditoria({ entidadeId: ENTIDADE_ID })

    expect(lista.total).toBe(2)
    expect(lista.itens[0]?.acao).toBe('TESTE_ACAO_B')
    expect(lista.itens[1]?.acao).toBe('TESTE_ACAO_A')
  })

  it('resolve o nome do ator e chama de "sistema" o registro sem ator', async () => {
    const lista = await listarAuditoria({ entidadeId: ENTIDADE_ID })

    const comAtor = lista.itens.find((item) => item.acao === 'TESTE_ACAO_A')
    expect(comAtor?.atorId).toBe(atorId)
    expect(comAtor?.atorNome).toContain('@')

    const semAtor = lista.itens.find((item) => item.acao === 'TESTE_ACAO_B')
    expect(semAtor?.atorNome).toBe('sistema')
  })

  it('preserva antes e depois como vieram do banco', async () => {
    const lista = await listarAuditoria({ entidadeId: ENTIDADE_ID, acao: 'TESTE_ACAO_A' })

    expect(lista.itens).toHaveLength(1)
    expect(lista.itens[0]?.antes).toEqual({ status: 'PENDING' })
    expect(lista.itens[0]?.depois).toEqual({ status: 'RELEASED' })
  })

  it('filtra por ação, entidade e ator', async () => {
    expect((await listarAuditoria({ entidadeId: ENTIDADE_ID, acao: 'TESTE_ACAO_B' })).total).toBe(1)
    expect((await listarAuditoria({ entidadeId: ENTIDADE_ID, entidade: 'Wallet' })).total).toBe(1)
    expect((await listarAuditoria({ entidadeId: ENTIDADE_ID, actorUserId: atorId })).total).toBe(1)
  })

  it('filtra por período', async () => {
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
    expect((await listarAuditoria({ entidadeId: ENTIDADE_ID, de: amanha })).total).toBe(0)

    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect((await listarAuditoria({ entidadeId: ENTIDADE_ID, de: ontem })).total).toBe(2)
  })
})

describe('listarFacetas', () => {
  it('traz as ações e entidades existentes, sem repetição', async () => {
    const { acoes, entidades } = await listarFacetas()

    expect(acoes).toContain('TESTE_ACAO_A')
    expect(entidades).toContain('Wallet')
    expect(new Set(acoes).size).toBe(acoes.length)
    expect(new Set(entidades).size).toBe(entidades.length)
  })
})
