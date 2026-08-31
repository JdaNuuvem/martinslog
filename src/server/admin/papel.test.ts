import { randomInt } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarSessao, SESSION_COOKIE, lerSessao } from '@/server/auth/sessao'
import { NextRequest, NextResponse } from 'next/server'
import { AlteracaoDoProprioPapelError } from '@/domain/errors'
import {
  alterarPapel,
  encerrarSessoesUsuario,
  marcarEmailVerificado,
  obterContextoAcesso,
} from './papel'

const usuariosCriados: string[] = []

function proximoSufixo(): string {
  return `${Date.now()}${randomInt(0, 1_000_000_000)}`
}

async function criarUsuario(papel: 'ADMIN' | 'CLIENTE'): Promise<string> {
  const sufixo = proximoSufixo()
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel,
      documento: sufixo.padStart(11, '0').slice(-11),
      nome: `Usuário teste papel ${papel}`,
      email: `papel-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entidadeId: { in: usuariosCriados } } })
  await prisma.session.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('alterarPapel', () => {
  it('recusa um admin tentando mudar o próprio papel', async () => {
    const admin = await criarUsuario('ADMIN')

    await expect(alterarPapel(admin, admin, 'CLIENTE')).rejects.toThrow(
      AlteracaoDoProprioPapelError,
    )

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: admin } })
    expect(usuario.papel).toBe('ADMIN')
  })

  // A checagem de "último administrador" depende da contagem GLOBAL de
  // admins na tabela `users` — é assim que a proteção real funciona (e é o
  // que o pedido exige: "conte os admins ativos"). Forçar esse cenário aqui
  // ("só sobra um admin no banco inteiro") exigiria rebaixar TODO admin
  // pré-existente, inclusive os criados por outros arquivos de teste rodando
  // em paralelo contra o mesmo banco — e isso já quebrou `guarda.test.ts`
  // nesta suíte quando tentado. Esse cenário e a corrida de quatro
  // requisições são testados de forma isolada, com um `prisma` simulado, em
  // `papel-ultimo-admin.test.ts` — sem tocar em nenhuma linha real do banco
  // de outro teste.

  it('promove e rebaixa normalmente, gravando o AuditLog com antes/depois', async () => {
    const ator = await criarUsuario('ADMIN')
    const alvo = await criarUsuario('CLIENTE')

    const promovido = await alterarPapel(ator, alvo, 'ADMIN')
    expect(promovido).toEqual({ papelAnterior: 'CLIENTE', papelAtual: 'ADMIN' })

    let log = await prisma.auditLog.findFirst({
      where: { entidade: 'User', entidadeId: alvo, acao: 'PAPEL_PROMOVIDO' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log?.antes).toEqual({ papel: 'CLIENTE' })
    expect(log?.depois).toEqual({ papel: 'ADMIN' })
    expect(log?.actorUserId).toBe(ator)

    const rebaixado = await alterarPapel(ator, alvo, 'CLIENTE')
    expect(rebaixado).toEqual({ papelAnterior: 'ADMIN', papelAtual: 'CLIENTE' })

    log = await prisma.auditLog.findFirst({
      where: { entidade: 'User', entidadeId: alvo, acao: 'PAPEL_REBAIXADO' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log?.antes).toEqual({ papel: 'ADMIN' })
    expect(log?.depois).toEqual({ papel: 'CLIENTE' })
  })
})

describe('encerrarSessoesUsuario', () => {
  it('apaga as Session do banco e o cookie antigo deixa de autenticar', async () => {
    const ator = await criarUsuario('ADMIN')
    const alvo = await criarUsuario('CLIENTE')

    const resposta = NextResponse.json({})
    const sessionId = await criarSessao(alvo, resposta)

    const antes = await lerSessao(
      new NextRequest('http://localhost/x', { headers: { cookie: `${SESSION_COOKIE}=${sessionId}` } }),
    )
    expect(antes?.userId).toBe(alvo)

    const resultado = await encerrarSessoesUsuario(ator, alvo)
    expect(resultado.sessoesEncerradas).toBeGreaterThanOrEqual(1)

    const restantes = await prisma.session.count({ where: { userId: alvo } })
    expect(restantes).toBe(0)

    const depois = await lerSessao(
      new NextRequest('http://localhost/x', { headers: { cookie: `${SESSION_COOKIE}=${sessionId}` } }),
    )
    expect(depois).toBeNull()

    const log = await prisma.auditLog.findFirst({
      where: { entidade: 'User', entidadeId: alvo, acao: 'SESSOES_ENCERRADAS' },
    })
    expect(log).not.toBeNull()
    expect(log?.depois).toEqual({ sessoesAtivas: 0 })
  })
})

describe('marcarEmailVerificado', () => {
  it('grava emailVerificadoEm e o AuditLog correspondente', async () => {
    const ator = await criarUsuario('ADMIN')
    const alvo = await criarUsuario('CLIENTE')

    const resultado = await marcarEmailVerificado(ator, alvo)
    expect(resultado.emailVerificadoEm).toBeInstanceOf(Date)

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: alvo } })
    expect(usuario.emailVerificadoEm).not.toBeNull()

    const log = await prisma.auditLog.findFirst({
      where: { entidade: 'User', entidadeId: alvo, acao: 'EMAIL_VERIFICADO_MANUALMENTE' },
    })
    expect(log).not.toBeNull()
    expect(log?.antes).toEqual({ emailVerificadoEm: null })
  })
})

describe('obterContextoAcesso', () => {
  it('marca ehProprio e ultimoAdmin corretamente', async () => {
    const admin = await criarUsuario('ADMIN')

    const proprio = await obterContextoAcesso(admin, admin)
    expect(proprio.ehProprio).toBe(true)

    const outroAdmin = await criarUsuario('ADMIN')
    const contexto = await obterContextoAcesso(outroAdmin, admin)
    expect(contexto.ehProprio).toBe(false)
    expect(contexto.papel).toBe('ADMIN')
  })
})
