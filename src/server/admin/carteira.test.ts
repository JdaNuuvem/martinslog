import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { SaldoInsuficienteError, ValorInvalidoError } from '@/domain/errors'
import { criarUsuarioComSaldo } from '@/test/factories'
import { ajustarSaldo } from './carteira'

const usuariosCriados: string[] = []

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: usuariosCriados } } })
  const walletIds = wallets.map((w) => w.id)
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: usuariosCriados } } })
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } })
  await prisma.wallet.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

async function usuario(saldoCentavos: number): Promise<string> {
  const criado = await criarUsuarioComSaldo(saldoCentavos)
  usuariosCriados.push(criado.id)
  return criado.id
}

describe('ajustarSaldo', () => {
  it('credita a carteira, grava o lançamento no extrato e registra a auditoria', async () => {
    const admin = await usuario(0)
    const cliente = await usuario(1000)

    const resultado = await ajustarSaldo(admin, cliente, {
      tipo: 'CREDITO',
      valorCentavos: 2500,
      motivo: 'Cortesia do chamado 42',
    })

    expect(resultado).toMatchObject({ saldoAnteriorCentavos: 1000, saldoAtualCentavos: 3500 })

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente } })
    expect(wallet.saldoCentavos).toBe(3500)

    const entrada = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: resultado.lancamentoId },
    })
    expect(entrada.tipo).toBe('CREDITO')
    expect(entrada.refTipo).toBe('AJUSTE_ADMIN')
    expect(entrada.saldoAposCentavos).toBe(3500)
    expect(entrada.descricao).toContain('Cortesia do chamado 42')

    const log = await prisma.auditLog.findFirst({
      where: { actorUserId: admin, acao: 'SALDO_CREDITADO', entidadeId: wallet.id },
    })
    expect(log).not.toBeNull()
  })

  it('debita a carteira e deixa o saldo coerente com o extrato', async () => {
    const admin = await usuario(0)
    const cliente = await usuario(5000)

    const resultado = await ajustarSaldo(admin, cliente, {
      tipo: 'DEBITO',
      valorCentavos: 1500,
      motivo: 'Estorno de crédito indevido',
    })

    expect(resultado.saldoAtualCentavos).toBe(3500)
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente } })
    expect(wallet.saldoCentavos).toBe(3500)
  })

  it('recusa débito maior que o saldo, sem gravar nada', async () => {
    const admin = await usuario(0)
    const cliente = await usuario(1000)

    await expect(
      ajustarSaldo(admin, cliente, {
        tipo: 'DEBITO',
        valorCentavos: 1001,
        motivo: 'Tentativa acima do saldo',
      }),
    ).rejects.toBeInstanceOf(SaldoInsuficienteError)

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente } })
    expect(wallet.saldoCentavos).toBe(1000)
    expect(await prisma.ledgerEntry.count({ where: { walletId: wallet.id } })).toBe(0)
  })

  it('exige motivo', async () => {
    const admin = await usuario(0)
    const cliente = await usuario(1000)

    await expect(
      ajustarSaldo(admin, cliente, { tipo: 'CREDITO', valorCentavos: 100, motivo: '  ' }),
    ).rejects.toBeInstanceOf(ValorInvalidoError)
  })

  it('não confunde dois ajustes iguais: os dois entram no extrato', async () => {
    const admin = await usuario(0)
    const cliente = await usuario(0)

    await ajustarSaldo(admin, cliente, { tipo: 'CREDITO', valorCentavos: 500, motivo: 'Cortesia' })
    await ajustarSaldo(admin, cliente, { tipo: 'CREDITO', valorCentavos: 500, motivo: 'Cortesia' })

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente } })
    expect(wallet.saldoCentavos).toBe(1000)
    expect(await prisma.ledgerEntry.count({ where: { walletId: wallet.id } })).toBe(2)
  })
})
