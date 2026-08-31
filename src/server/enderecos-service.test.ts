import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { DocumentoInvalidoError, EnderecoNaoEncontradoError } from '@/domain/errors'
import {
  arquivarEndereco,
  atualizarEndereco,
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

describe('criarEndereco', () => {
  it('normaliza o CEP e a UF antes de gravar', async () => {
    const userId = await criarUsuario()

    const endereco = await criarEndereco(
      userId,
      dadosEndereco({ cep: '01001-000', uf: 'sp' }),
    )

    // O CEP entra com hífen e sai só com dígitos: a comparação de faixa na
    // tarifa é numérica, e guardar formatado obrigaria a limpar em toda
    // leitura.
    expect(endereco.cep).toBe('01001000')
    expect(endereco.uf).toBe('SP')
  })

  it('aceita destinatário com CPF válido e guarda só os dígitos', async () => {
    const userId = await criarUsuario()

    const endereco = await criarEndereco(
      userId,
      dadosEndereco({ tipo: 'DESTINATARIO', documento: '529.982.247-25' }),
    )

    expect(endereco.documento).toBe('52998224725')
  })

  it('recusa destinatário com documento inválido', async () => {
    const userId = await criarUsuario()

    await expect(
      criarEndereco(userId, dadosEndereco({ tipo: 'DESTINATARIO', documento: '11111111111' })),
    ).rejects.toThrow(DocumentoInvalidoError)
  })

  it('ignora documento inválido em remetente — a exigência é só do destinatário', async () => {
    const userId = await criarUsuario()

    const endereco = await criarEndereco(
      userId,
      dadosEndereco({ tipo: 'REMETENTE', documento: '11111111111' }),
    )

    expect(endereco.documento).toBeNull()
  })

  it('ao criar um padrão, desmarca o padrão anterior do mesmo tipo', async () => {
    const userId = await criarUsuario()

    const primeiro = await criarEndereco(userId, dadosEndereco({ padrao: true }))
    const segundo = await criarEndereco(userId, dadosEndereco({ padrao: true }))

    const antigo = await prisma.address.findUniqueOrThrow({ where: { id: primeiro.id } })
    expect(antigo.padrao).toBe(false)
    expect(segundo.padrao).toBe(true)
  })

  it('padrão de REMETENTE e de DESTINATARIO convivem — os tipos são independentes', async () => {
    const userId = await criarUsuario()

    const remetente = await criarEndereco(userId, dadosEndereco({ tipo: 'REMETENTE', padrao: true }))
    const destinatario = await criarEndereco(
      userId,
      dadosEndereco({ tipo: 'DESTINATARIO', padrao: true, documento: '529.982.247-25' }),
    )

    const remetenteDepois = await prisma.address.findUniqueOrThrow({ where: { id: remetente.id } })
    expect(remetenteDepois.padrao).toBe(true)
    expect(destinatario.padrao).toBe(true)
  })
})

describe('atualizarEndereco', () => {
  it('atualiza os campos do endereço do próprio usuário', async () => {
    const userId = await criarUsuario()
    const endereco = await criarEndereco(userId, dadosEndereco({ apelido: 'antes' }))

    const atualizado = await atualizarEndereco(
      userId,
      endereco.id,
      dadosEndereco({ apelido: 'depois', numero: '999' }),
    )

    expect(atualizado.apelido).toBe('depois')
    expect(atualizado.numero).toBe('999')
  })

  it('não deixa atualizar endereço de outro usuário, e não altera nada', async () => {
    const dono = await criarUsuario()
    const intruso = await criarUsuario()
    const endereco = await criarEndereco(dono, dadosEndereco({ apelido: 'do dono' }))

    await expect(
      atualizarEndereco(intruso, endereco.id, dadosEndereco({ apelido: 'invadido' })),
    ).rejects.toThrow(EnderecoNaoEncontradoError)

    const depois = await prisma.address.findUniqueOrThrow({ where: { id: endereco.id } })
    expect(depois.apelido).toBe('do dono')
  })

  it('promover um endereço a padrão desmarca o anterior', async () => {
    const userId = await criarUsuario()
    const primeiro = await criarEndereco(userId, dadosEndereco({ padrao: true }))
    const segundo = await criarEndereco(userId, dadosEndereco({ padrao: false }))

    await atualizarEndereco(userId, segundo.id, dadosEndereco({ padrao: true }))

    const antigo = await prisma.address.findUniqueOrThrow({ where: { id: primeiro.id } })
    const novo = await prisma.address.findUniqueOrThrow({ where: { id: segundo.id } })
    expect(antigo.padrao).toBe(false)
    expect(novo.padrao).toBe(true)
  })
})

describe('troca de padrão sob concorrência', () => {
  /**
   * Conta quantos endereços ativos estão marcados como padrão para o par
   * (usuário, tipo) — a invariante que o índice único parcial
   * `address_padrao_unico_por_tipo` protege no banco.
   */
  async function padroesAtivos(userId: string, tipo: 'REMETENTE' | 'DESTINATARIO') {
    return prisma.address.count({
      where: { userId, tipo, padrao: true, arquivadoEm: null },
    })
  }

  it('criações simultâneas com padrao: true terminam com exatamente um padrão', async () => {
    const userId = await criarUsuario()

    // Quatro, não duas. Com apenas duas escritas concorrentes este teste
    // passa mesmo sem o lock consultivo — a primeira costuma commitar antes
    // de a segunda rodar seu updateMany, e a corrida não se manifesta. Foi
    // verificado removendo o lock: com duas, verde; com quatro, vermelho.
    const resultados = await Promise.allSettled(
      ['A', 'B', 'C', 'D'].map((apelido) =>
        criarEndereco(userId, dadosEndereco({ padrao: true, apelido })),
      ),
    )

    // Nenhuma das duas pode falhar: o lock consultivo faz a segunda esperar
    // a primeira commitar e então enxergar o padrão já gravado, em vez de
    // as duas correrem para marcar e uma esbarrar no índice único.
    const rejeitadas = resultados.filter((r) => r.status === 'rejected')
    expect(rejeitadas).toHaveLength(0)

    expect(await padroesAtivos(userId, 'REMETENTE')).toBe(1)
  })

  it('não vaza P2002 cru do Prisma para quem chamou', async () => {
    const userId = await criarUsuario()

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        criarEndereco(userId, dadosEndereco({ padrao: true, apelido: `concorrente-${i}` })),
      ),
    )

    for (const resultado of resultados) {
      if (resultado.status === 'rejected') {
        // Uma violação de unicidade escapando daqui viraria 500 na API, com
        // mensagem de banco na cara do usuário.
        expect(String(resultado.reason)).not.toContain('P2002')
        expect(String(resultado.reason)).not.toContain('Unique constraint')
      }
    }

    expect(await padroesAtivos(userId, 'REMETENTE')).toBe(1)
  })

  it('atualizações simultâneas promovendo endereços diferentes deixam um só padrão', async () => {
    const userId = await criarUsuario()
    const primeiro = await criarEndereco(userId, dadosEndereco({ apelido: 'um' }))
    const segundo = await criarEndereco(userId, dadosEndereco({ apelido: 'dois' }))

    const resultados = await Promise.allSettled([
      atualizarEndereco(userId, primeiro.id, dadosEndereco({ apelido: 'um', padrao: true })),
      atualizarEndereco(userId, segundo.id, dadosEndereco({ apelido: 'dois', padrao: true })),
    ])

    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(0)
    expect(await padroesAtivos(userId, 'REMETENTE')).toBe(1)
  })

  it('REMETENTE e DESTINATARIO simultâneos não se bloqueiam nem se anulam', async () => {
    const userId = await criarUsuario()

    const resultados = await Promise.allSettled([
      criarEndereco(userId, dadosEndereco({ tipo: 'REMETENTE', padrao: true })),
      criarEndereco(
        userId,
        dadosEndereco({ tipo: 'DESTINATARIO', padrao: true, documento: '529.982.247-25' }),
      ),
    ])

    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(0)

    // Cada tipo mantém o seu: o lock é por (userId, tipo), não por usuário.
    expect(await padroesAtivos(userId, 'REMETENTE')).toBe(1)
    expect(await padroesAtivos(userId, 'DESTINATARIO')).toBe(1)
  })
})
