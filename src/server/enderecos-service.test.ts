import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { EnderecoNaoEncontradoError } from '@/domain/errors'
import {
  arquivarEndereco,
  criarEndereco,
  listarEnderecos,
  listarEnderecosArquivados,
  reativarEndereco,
} from './enderecos-service'
import type { EnderecoRequest } from '@/lib/endereco-schema'

let contador = 0
const usuariosCriados: string[] = []

async function criarUsuario(): Promise<string> {
  contador += 1
  const sufixo = `${Date.now()}${contador}`
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `${contador}`.padStart(11, '5'),
      nome: 'Usuário Teste Endereços',
      email: `enderecos-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

function dadosEndereco(sobrescritas: Partial<EnderecoRequest> = {}): EnderecoRequest {
  return {
    tipo: 'REMETENTE',
    cep: '01001-000',
    logradouro: 'Praça da Sé',
    numero: '1',
    bairro: 'Sé',
    cidade: 'São Paulo',
    uf: 'SP',
    ...sobrescritas,
  }
}

afterAll(async () => {
  await prisma.address.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('listarEnderecosArquivados', () => {
  it('devolve só os arquivados do próprio usuário', async () => {
    const userId = await criarUsuario()
    const outroId = await criarUsuario()

    const ativo = await criarEndereco(userId, dadosEndereco({ apelido: 'ativo' }))
    const arquivado = await criarEndereco(userId, dadosEndereco({ apelido: 'arquivado' }))
    const doOutro = await criarEndereco(outroId, dadosEndereco({ apelido: 'do outro' }))

    await arquivarEndereco(userId, arquivado.id)
    await arquivarEndereco(outroId, doOutro.id)

    const arquivados = await listarEnderecosArquivados(userId)
    const ids = arquivados.map((e) => e.id)

    expect(ids).toContain(arquivado.id)
    expect(ids).not.toContain(ativo.id)
    expect(ids).not.toContain(doOutro.id)
  })
})

describe('reativarEndereco', () => {
  it('traz o endereço de volta para a listagem ativa', async () => {
    const userId = await criarUsuario()
    const endereco = await criarEndereco(userId, dadosEndereco())
    await arquivarEndereco(userId, endereco.id)

    expect((await listarEnderecos(userId)).map((e) => e.id)).not.toContain(endereco.id)

    const reativado = await reativarEndereco(userId, endereco.id)

    expect(reativado.arquivadoEm).toBeNull()
    expect((await listarEnderecos(userId)).map((e) => e.id)).toContain(endereco.id)
    expect((await listarEnderecosArquivados(userId)).map((e) => e.id)).not.toContain(endereco.id)
  })

  it('reativa sempre como não-padrão, preservando o padrão atual', async () => {
    const userId = await criarUsuario()

    // O primeiro é padrão; ao ser arquivado, deixa de ser.
    const primeiro = await criarEndereco(userId, dadosEndereco({ padrao: true, apelido: 'antigo' }))
    await arquivarEndereco(userId, primeiro.id)

    // O segundo assume o posto de padrão enquanto o primeiro está arquivado.
    const segundo = await criarEndereco(userId, dadosEndereco({ padrao: true, apelido: 'novo' }))

    // Reativar o antigo não pode despromover o atual nem estourar o índice
    // único parcial (userId, tipo) WHERE padrao = true AND arquivadoEm IS NULL.
    const reativado = await reativarEndereco(userId, primeiro.id)

    expect(reativado.padrao).toBe(false)
    const atual = await prisma.address.findUniqueOrThrow({ where: { id: segundo.id } })
    expect(atual.padrao).toBe(true)

    const padroesAtivos = await prisma.address.count({
      where: { userId, tipo: 'REMETENTE', padrao: true, arquivadoEm: null },
    })
    expect(padroesAtivos).toBe(1)
  })

  it('não deixa reativar endereço de outro usuário', async () => {
    const dono = await criarUsuario()
    const intruso = await criarUsuario()

    const endereco = await criarEndereco(dono, dadosEndereco())
    await arquivarEndereco(dono, endereco.id)

    await expect(reativarEndereco(intruso, endereco.id)).rejects.toThrow(EnderecoNaoEncontradoError)

    // E continua arquivado para o dono: a tentativa alheia não teve efeito.
    const depois = await prisma.address.findUniqueOrThrow({ where: { id: endereco.id } })
    expect(depois.arquivadoEm).not.toBeNull()
  })

  it('trata id inexistente e endereço já ativo com o mesmo erro, sem revelar qual é o caso', async () => {
    const userId = await criarUsuario()
    const ativo = await criarEndereco(userId, dadosEndereco())

    const porInexistente = await reativarEndereco(userId, 'id-que-nao-existe').catch((e) => e)
    const porJaAtivo = await reativarEndereco(userId, ativo.id).catch((e) => e)

    expect(porInexistente).toBeInstanceOf(EnderecoNaoEncontradoError)
    expect(porJaAtivo).toBeInstanceOf(EnderecoNaoEncontradoError)
  })
})
