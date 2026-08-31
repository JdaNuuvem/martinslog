import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { SaldoInsuficienteError, ValorInvalidoError } from '@/domain/errors'
import {
  confirmarRecarga,
  creditarCarteira,
  criarRecarga,
  debitarCarteira,
  listarExtrato,
  obterCarteira,
} from './wallet-service'

let contador = 0

async function criarUsuarioDeTeste(): Promise<string> {
  contador += 1
  const sufixo = `${Date.now()}${contador}`
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: String(contador).padStart(11, '9'),
      nome: 'Usuário Teste Carteira',
      email: `carteira-${sufixo}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

const usuariosCriados: string[] = []

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
  await prisma.paymentIntent.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

describe('creditarCarteira', () => {
  it('grava o LedgerEntry e atualiza Wallet.saldoCentavos atomicamente, com saldoAposCentavos coerente', async () => {
    const userId = await criarUsuarioDeTeste()

    await creditarCarteira(userId, 5000, { tipo: 'TESTE', id: 'ref-1' }, 'Crédito de teste')

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.saldoCentavos).toBe(5000)

    const entradas = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id } })
    expect(entradas).toHaveLength(1)
    const [entrada] = entradas
    expect(entrada?.tipo).toBe('CREDITO')
    expect(entrada?.valorCentavos).toBe(5000)
    expect(entrada?.saldoAposCentavos).toBe(5000)
  })

  it('lança ValorInvalidoError para valor zero ou negativo', async () => {
    const userId = await criarUsuarioDeTeste()

    await expect(
      creditarCarteira(userId, 0, { tipo: 'TESTE', id: 'ref-zero' }, 'Crédito inválido'),
    ).rejects.toBeInstanceOf(ValorInvalidoError)
    await expect(
      creditarCarteira(userId, -100, { tipo: 'TESTE', id: 'ref-neg' }, 'Crédito inválido'),
    ).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('não duplica o saldo ao creditar duas vezes a mesma referência (idempotência)', async () => {
    const userId = await criarUsuarioDeTeste()
    const ref = { tipo: 'PAYMENT_INTENT', id: 'intent-idempotente' }

    await creditarCarteira(userId, 2000, ref, 'Recarga')
    await creditarCarteira(userId, 2000, ref, 'Recarga') // segunda confirmação, mesmo ref

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.saldoCentavos).toBe(2000)

    const entradas = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id } })
    expect(entradas).toHaveLength(1)
  })
})

describe('debitarCarteira', () => {
  it('lança SaldoInsuficienteError quando o saldo é menor que o débito', async () => {
    const userId = await criarUsuarioDeTeste()

    await expect(
      debitarCarteira(userId, 1000, { tipo: 'TESTE', id: 'debito-sem-saldo' }, 'Débito de teste'),
    ).rejects.toBeInstanceOf(SaldoInsuficienteError)
  })
})

describe('saldo materializado vs. ledger', () => {
  it('Wallet.saldoCentavos nunca diverge da soma dos LedgerEntry após uma sequência de créditos e débitos', async () => {
    const userId = await criarUsuarioDeTeste()

    await creditarCarteira(userId, 10000, { tipo: 'TESTE', id: 'seq-1' }, 'Crédito 1')
    await creditarCarteira(userId, 5000, { tipo: 'TESTE', id: 'seq-2' }, 'Crédito 2')
    await debitarCarteira(userId, 3000, { tipo: 'TESTE', id: 'seq-3' }, 'Débito 1')
    await creditarCarteira(userId, 2000, { tipo: 'TESTE', id: 'seq-4' }, 'Crédito 3')
    await debitarCarteira(userId, 7000, { tipo: 'TESTE', id: 'seq-5' }, 'Débito 2')

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    const entradas = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id } })

    const somaCalculada = entradas.reduce(
      (soma, entrada) => soma + (entrada.tipo === 'CREDITO' ? entrada.valorCentavos : -entrada.valorCentavos),
      0,
    )

    expect(wallet.saldoCentavos).toBe(somaCalculada)
    expect(wallet.saldoCentavos).toBe(10000 + 5000 - 3000 + 2000 - 7000)
  })
})

describe('criarRecarga e confirmarRecarga', () => {
  it('cria uma cobrança Pix simulada e, ao confirmar, credita a carteira uma única vez', async () => {
    const userId = await criarUsuarioDeTeste()

    const recarga = await criarRecarga(userId, 5000)
    expect(recarga.qrCode).toContain('SIMULADO')
    expect(recarga.valorCentavos).toBe(5000)

    await confirmarRecarga(recarga.paymentIntentId)
    await confirmarRecarga(recarga.paymentIntentId) // confirmação repetida não deve duplicar

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.saldoCentavos).toBe(5000)

    const entradas = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id } })
    expect(entradas).toHaveLength(1)

    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: recarga.paymentIntentId } })
    expect(intent.status).toBe('CONFIRMADO')
  })

  it('confirmações concorrentes do mesmo PaymentIntent creditam a carteira uma única vez', async () => {
    const userId = await criarUsuarioDeTeste()
    const recarga = await criarRecarga(userId, 8000)

    await Promise.all([confirmarRecarga(recarga.paymentIntentId), confirmarRecarga(recarga.paymentIntentId)])

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.saldoCentavos).toBe(8000)

    const entradas = await prisma.ledgerEntry.findMany({ where: { walletId: wallet.id } })
    expect(entradas).toHaveLength(1)
  })
})

describe('obterCarteira e listarExtrato', () => {
  it('obterCarteira cria a carteira do usuário com saldo zero se ainda não existir', async () => {
    const userId = await criarUsuarioDeTeste()

    const carteira = await obterCarteira(userId)
    expect(carteira.saldoCentavos).toBe(0)
  })

  it('listarExtrato pagina os lançamentos, mais recentes primeiro', async () => {
    const userId = await criarUsuarioDeTeste()

    for (let i = 0; i < 3; i += 1) {
      await creditarCarteira(userId, 1000, { tipo: 'TESTE', id: `pag-${i}` }, `Crédito ${i}`)
    }

    const pagina1 = await listarExtrato(userId, 1, 2)
    expect(pagina1.itens).toHaveLength(2)
    expect(pagina1.total).toBe(3)
    expect(pagina1.totalPaginas).toBe(2)
    expect(pagina1.itens[0]?.descricao).toBe('Crédito 2')

    const pagina2 = await listarExtrato(userId, 2, 2)
    expect(pagina2.itens).toHaveLength(1)
    expect(pagina2.itens[0]?.descricao).toBe('Crédito 0')
  })
})
