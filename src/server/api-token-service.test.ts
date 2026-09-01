import { randomInt } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { criarToken, listarTokens, revogarToken, autenticarToken } from './api-token-service'

const usuariosCriados: string[] = []

afterAll(async () => {
  await prisma.apiToken.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function criarUsuarioDeTeste() {
  const sufixo = `${Date.now()}${randomInt(0, 1_000_000_000)}`
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: sufixo.slice(-11).padStart(11, '0'),
      nome: 'Usuário Teste Token',
      email: `token-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user
}

describe('api-token-service', () => {
  it('gera o token com prefixo por ambiente e devolve o valor em claro só na criação', async () => {
    const user = await criarUsuarioDeTeste()

    const sandbox = await criarToken(user.id, 'Loja teste', 'SANDBOX')
    const producao = await criarToken(user.id, 'Loja real', 'PRODUCAO')

    expect(sandbox.tokenClaro.startsWith('frete_test_')).toBe(true)
    expect(producao.tokenClaro.startsWith('frete_live_')).toBe(true)
    expect(sandbox.tokenClaro).not.toBe(producao.tokenClaro)
  })

  it('não grava o valor em claro no banco — só o hash', async () => {
    const user = await criarUsuarioDeTeste()
    const criado = await criarToken(user.id, 'Loja teste', 'SANDBOX')

    const linha = await prisma.apiToken.findUniqueOrThrow({ where: { id: criado.id } })

    expect(linha.tokenHash).not.toBe(criado.tokenClaro)
    expect(JSON.stringify(linha)).not.toContain(criado.tokenClaro)
  })

  it('a listagem nunca traz o valor em claro nem o hash', async () => {
    const user = await criarUsuarioDeTeste()
    const criado = await criarToken(user.id, 'Loja teste', 'SANDBOX')

    const listados = await listarTokens(user.id)
    const encontrado = listados.find((t) => t.id === criado.id)

    expect(encontrado).toBeDefined()
    expect(JSON.stringify(encontrado)).not.toContain(criado.tokenClaro)
    expect(encontrado).not.toHaveProperty('tokenHash')
  })

  it('autentica um token válido e devolve o dono e o ambiente', async () => {
    const user = await criarUsuarioDeTeste()
    const criado = await criarToken(user.id, 'Loja teste', 'PRODUCAO')

    const autenticado = await autenticarToken(criado.tokenClaro)

    expect(autenticado).toEqual({ tokenId: criado.id, userId: user.id, ambiente: 'PRODUCAO' })
  })

  it('recusa token inexistente', async () => {
    const autenticado = await autenticarToken('frete_live_' + 'a'.repeat(64))
    expect(autenticado).toBeNull()
  })

  it('recusa token revogado imediatamente', async () => {
    const user = await criarUsuarioDeTeste()
    const criado = await criarToken(user.id, 'Loja teste', 'SANDBOX')

    await revogarToken(user.id, criado.id)

    const autenticado = await autenticarToken(criado.tokenClaro)
    expect(autenticado).toBeNull()
  })

  it('revogar duas vezes não é erro (idempotente)', async () => {
    const user = await criarUsuarioDeTeste()
    const criado = await criarToken(user.id, 'Loja teste', 'SANDBOX')

    await revogarToken(user.id, criado.id)
    await expect(revogarToken(user.id, criado.id)).resolves.toBeUndefined()
  })

  it('recusa revogar token de outra conta', async () => {
    const dono = await criarUsuarioDeTeste()
    const outro = await criarUsuarioDeTeste()
    const criado = await criarToken(dono.id, 'Loja teste', 'SANDBOX')

    await expect(revogarToken(outro.id, criado.id)).rejects.toThrow()

    const autenticado = await autenticarToken(criado.tokenClaro)
    expect(autenticado).not.toBeNull()
  })

  it('atualiza ultimoUsoEm a cada autenticação bem-sucedida', async () => {
    const user = await criarUsuarioDeTeste()
    const criado = await criarToken(user.id, 'Loja teste', 'SANDBOX')

    await autenticarToken(criado.tokenClaro)

    const linha = await prisma.apiToken.findUniqueOrThrow({ where: { id: criado.id } })
    expect(linha.ultimoUsoEm).not.toBeNull()
  })
})
