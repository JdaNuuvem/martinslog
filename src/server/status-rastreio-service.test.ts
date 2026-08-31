import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ValorInvalidoError } from '@/domain/errors'
import {
  catalogoDoUsuario,
  listarStatusDaConta,
  obterStatusPorCodigo,
  removerStatus,
  salvarStatus,
} from './status-rastreio-service'

let contador = 0
const usuariosCriados: string[] = []

async function criarUsuario(): Promise<string> {
  contador += 1
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `${Date.now()}${contador}`.slice(-11),
      nome: 'Conta Teste Status',
      email: `status-${Date.now()}-${contador}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

beforeAll(async () => {
  // Uma linha de catálogo padrão, para provar a sobreposição.
  const existente = await prisma.statusRastreio.findFirst({
    where: { userId: null, codigo: 'POSTADO' },
  })
  if (!existente) {
    await prisma.statusRastreio.create({
      data: {
        userId: null,
        codigo: 'POSTADO',
        titulo: 'Objeto postado',
        descricao: 'Objeto postado',
      },
    })
  }
})

afterAll(async () => {
  await prisma.statusRastreio.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('salvarStatus', () => {
  it('personaliza a copy de um código padrão sem criar etapa nova', async () => {
    const userId = await criarUsuario()

    await salvarStatus(userId, {
      nome: 'POSTADO',
      titulo: 'Saiu da nossa loja',
      descricao: 'Sua encomenda está a caminho',
    })

    const catalogo = await catalogoDoUsuario(userId)
    expect(catalogo.textos.POSTADO?.titulo).toBe('Saiu da nossa loja')
    expect(catalogo.etapasExtras).toHaveLength(0)
  })

  it('salvar de novo com o mesmo nome edita, não duplica', async () => {
    const userId = await criarUsuario()

    await salvarStatus(userId, { nome: 'POSTADO', titulo: 'Primeira', descricao: 'x' })
    await salvarStatus(userId, { nome: 'POSTADO', titulo: 'Segunda', descricao: 'y' })

    const linhas = await listarStatusDaConta(userId)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.titulo).toBe('Segunda')
  })

  it('cria etapa própria que entra no roteiro do cenário escolhido', async () => {
    const userId = await criarUsuario()

    await salvarStatus(userId, {
      nome: 'Em conferência',
      titulo: 'Em conferência',
      descricao: 'Conferindo seu pedido',
      cenario: 'ENTREGA_NORMAL',
      fracaoPrazo: 0.4,
      statusResultante: 'POSTED',
    })

    const catalogo = await catalogoDoUsuario(userId)
    expect(catalogo.etapasExtras).toHaveLength(1)
    expect(catalogo.etapasExtras[0]?.codigo).toBe('EM_CONFERENCIA')
  })

  it('recusa etapa que cairia depois da entrega, e não deixa resíduo gravado', async () => {
    const userId = await criarUsuario()

    await expect(
      salvarStatus(userId, {
        nome: 'Tarde demais',
        titulo: 'Tarde demais',
        descricao: 'x',
        cenario: 'ENTREGA_NORMAL',
        fracaoPrazo: 1.5,
        statusResultante: 'POSTED',
      }),
    ).rejects.toThrow(ValorInvalidoError)

    // O desfazer é o ponto do teste: uma configuração recusada não pode
    // ficar meio gravada e quebrar a próxima emissão.
    expect(await listarStatusDaConta(userId)).toHaveLength(0)
  })

  it('recusa título ou descrição vazios', async () => {
    const userId = await criarUsuario()

    await expect(
      salvarStatus(userId, { nome: 'POSTADO', titulo: '   ', descricao: 'x' }),
    ).rejects.toThrow(ValorInvalidoError)
  })
})

describe('catalogoDoUsuario', () => {
  it('não mistura o catálogo de uma conta com o de outra', async () => {
    const umaConta = await criarUsuario()
    const outraConta = await criarUsuario()

    await salvarStatus(umaConta, { nome: 'POSTADO', titulo: 'Só desta conta', descricao: 'x' })

    expect((await catalogoDoUsuario(umaConta)).textos.POSTADO?.titulo).toBe('Só desta conta')
    expect((await catalogoDoUsuario(outraConta)).textos.POSTADO?.titulo).toBe('Objeto postado')
  })
})

describe('removerStatus', () => {
  it('devolve o código ao texto padrão em vez de sumir com ele', async () => {
    const userId = await criarUsuario()
    await salvarStatus(userId, { nome: 'POSTADO', titulo: 'Personalizado', descricao: 'x' })

    const linha = (await listarStatusDaConta(userId))[0]!
    await removerStatus(userId, linha.id)

    expect((await catalogoDoUsuario(userId)).textos.POSTADO?.titulo).toBe('Objeto postado')
  })

  it('não deixa uma conta remover o status de outra', async () => {
    const dono = await criarUsuario()
    const intruso = await criarUsuario()
    await salvarStatus(dono, { nome: 'POSTADO', titulo: 'Do dono', descricao: 'x' })
    const linha = (await listarStatusDaConta(dono))[0]!

    await expect(removerStatus(intruso, linha.id)).rejects.toThrow(ValorInvalidoError)
    expect(await listarStatusDaConta(dono)).toHaveLength(1)
  })
})

describe('obterStatusPorCodigo', () => {
  it('traduz só as etapas que entram no roteiro', async () => {
    const userId = await criarUsuario()

    // Reescrita de copy: o código continua sendo um dos que o motor conhece,
    // então não precisa de tradução.
    await salvarStatus(userId, { nome: 'POSTADO', titulo: 'Saiu da loja', descricao: 'x' })
    await salvarStatus(userId, {
      nome: 'Em conferência',
      titulo: 'Em conferência',
      descricao: 'x',
      cenario: 'ENTREGA_NORMAL',
      fracaoPrazo: 0.4,
      statusResultante: 'POSTED',
    })

    const mapa = await obterStatusPorCodigo(userId)

    expect(mapa).toEqual({ EM_CONFERENCIA: 'POSTED' })
  })

  it('devolve mapa vazio para conta sem etapas próprias', async () => {
    const userId = await criarUsuario()
    expect(await obterStatusPorCodigo(userId)).toEqual({})
  })
})

describe('obterStatusPorCodigo com etapa desativada', () => {
  it('continua traduzindo etapa desligada, porque envios antigos ainda a têm na timeline', async () => {
    const userId = await criarUsuario()

    await salvarStatus(userId, {
      nome: 'Em conferência',
      titulo: 'Em conferência',
      descricao: 'x',
      cenario: 'ENTREGA_NORMAL',
      fracaoPrazo: 0.4,
      statusResultante: 'POSTED',
    })
    await salvarStatus(userId, {
      nome: 'Em conferência',
      titulo: 'Em conferência',
      descricao: 'x',
      cenario: 'ENTREGA_NORMAL',
      fracaoPrazo: 0.4,
      statusResultante: 'POSTED',
      ativo: false,
    })

    // Fora dos roteiros novos...
    const catalogo = await catalogoDoUsuario(userId)
    expect(catalogo.etapasExtras).toHaveLength(0)

    // ...mas ainda traduzível, senão os envios já emitidos com esse evento
    // parariam de avançar de status.
    expect(await obterStatusPorCodigo(userId)).toEqual({ EM_CONFERENCIA: 'POSTED' })
  })
})
