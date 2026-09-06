import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { listarEtiquetas } from '@/server/etiquetas-service'
import { listarMeusEnvios } from '@/server/meus-envios-service'
import { criarCotacaoValida, criarUsuarioComSaldo } from '@/test/factories'
import { criarEnvio } from '@/server/shipment-service'

/**
 * O administrador enxerga as etiquetas e os rastreios de TODAS as lojas.
 *
 * O defeito que isto fixa não era de dado, era de expectativa — e por isso
 * doeu mais. A conta de administração entrava, abria "Etiquetas" e via
 * "Nenhuma etiqueta nesta situação", porque a tela filtrava pelo dono e a
 * conta de administração não tem envio próprio. Novecentas etiquetas de quatro
 * lojas existiam do outro lado do mesmo banco, e a tela dizia zero.
 *
 * O que estes testes fixam são as duas metades disso: o administrador vê tudo,
 * e o lojista continua vendo só o dele.
 */

const ENDERECO = {
  nome: 'Compradora Teste',
  documento: '52998224725',
  cep: '20040020',
  logradouro: 'Avenida Rio Branco',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Rio de Janeiro',
  uf: 'RJ',
}

const REMETENTE = { ...ENDERECO, nome: 'Loja', cep: '01310100', cidade: 'São Paulo', uf: 'SP' }

async function envioPara(userId: string) {
  const cotacao = await criarCotacaoValida(userId)
  return criarEnvio(userId, {
    quoteId: cotacao.id,
    servicoId: 'eco',
    remetente: REMETENTE,
    destinatario: ENDERECO,
    produtos: [{ nome: 'Produto', quantidade: 1, valorUnitarioCentavos: 5000 }],
  })
}

let admin = ''
let lojistaA = ''
let lojistaB = ''
let envioDeA = ''
let envioDeB = ''

beforeAll(async () => {
  const contaAdmin = await criarUsuarioComSaldo(0)
  admin = contaAdmin.id
  await prisma.user.update({ where: { id: admin }, data: { papel: 'ADMIN' } })

  const a = await criarUsuarioComSaldo(50_000)
  const b = await criarUsuarioComSaldo(50_000)
  lojistaA = a.id
  lojistaB = b.id

  envioDeA = (await envioPara(lojistaA)).id
  envioDeB = (await envioPara(lojistaB)).id
})

afterAll(async () => {
  const contas = [admin, lojistaA, lojistaB]
  await prisma.trackingEvent.deleteMany({ where: { shipment: { userId: { in: contas } } } })
  await prisma.shipment.deleteMany({ where: { userId: { in: contas } } })
  await prisma.quote.deleteMany({ where: { userId: { in: contas } } })
  await prisma.ledgerEntry.deleteMany({ where: { wallet: { userId: { in: contas } } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: contas } } })
  await prisma.user.deleteMany({ where: { id: { in: contas } } })
})

describe('etiquetas', () => {
  it('o administrador vê as etiquetas de outras contas', async () => {
    const lista = await listarEtiquetas(admin, { todasAsContas: true })
    const ids = lista.etiquetas.map((e) => e.id)

    expect(ids).toContain(envioDeA)
    expect(ids).toContain(envioDeB)
  })

  it('cada linha diz de qual loja é — senão vira uma pilha sem dono', async () => {
    const lista = await listarEtiquetas(admin, { todasAsContas: true })
    const linha = lista.etiquetas.find((e) => e.id === envioDeA)

    expect(linha?.loja).toBeTruthy()
  })

  it('o lojista continua vendo só o dele, e o campo de loja não aparece', async () => {
    /*
      A outra metade, e a que importa mais: a visão ampla é do papel, não da
      tela. Se ela vazasse para o lojista, um cliente leria os envios do
      concorrente que usa a mesma plataforma.
    */
    const lista = await listarEtiquetas(lojistaA)
    const ids = lista.etiquetas.map((e) => e.id)

    expect(ids).toContain(envioDeA)
    expect(ids).not.toContain(envioDeB)
    expect(lista.etiquetas[0]?.loja ?? null).toBeNull()
  })

  it('as contagens das abas também são de todas as contas', async () => {
    /*
      Contagem e lista precisam concordar. Uma aba dizendo "Todos (0)" sobre
      uma lista com linhas é o mesmo defeito de antes, só que menor.
    */
    const doAdmin = await listarEtiquetas(admin, { todasAsContas: true })
    expect(doAdmin.contagem.todos).toBeGreaterThanOrEqual(2)

    const doLojista = await listarEtiquetas(lojistaA)
    expect(doLojista.contagem.todos).toBeLessThan(doAdmin.contagem.todos)
  })
})

describe('rastreio', () => {
  it('o administrador vê os envios de outras contas', async () => {
    const lista = await listarMeusEnvios(admin, 'todos', new Date(), true)
    const ids = lista.envios.map((e) => e.id)

    expect(ids).toContain(envioDeA)
    expect(ids).toContain(envioDeB)
    expect(lista.envios.find((e) => e.id === envioDeA)?.loja).toBeTruthy()
  })

  it('o lojista continua vendo só o dele', async () => {
    const lista = await listarMeusEnvios(lojistaB)
    const ids = lista.envios.map((e) => e.id)

    expect(ids).toContain(envioDeB)
    expect(ids).not.toContain(envioDeA)
  })
})
