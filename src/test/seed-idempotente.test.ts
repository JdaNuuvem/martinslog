import { randomInt } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { executarSeed } from '../../prisma/seed'

/**
 * Testes de integração para o bug do seed create-only (`update: {}` nos
 * `upsert`): reexecutar `pnpm prisma db seed` tinha que corrigir divergências
 * de identidade/configuração (ex.: `papel` do admin) sem nunca repor estado
 * transacional (saldo da carteira).
 *
 * Este teste mexe nos registros globais do seed (`admin@frete.teste` e
 * `cliente@frete.teste`), que outros arquivos também usam. A suíte roda com
 * `fileParallelism: false` (ver `vitest.config.ts`), então não há corrida
 * entre arquivos — mas o `afterAll` restaura o estado original (papel e
 * saldo) para não deixar o banco diferente do que os outros arquivos
 * esperam.
 */
describe('executarSeed', () => {
  const emailAdmin = 'admin@frete.teste'
  const emailCliente = 'cliente@frete.teste'

  let papelAdminOriginal: 'ADMIN' | 'CLIENTE'
  let saldoClienteOriginal: number

  beforeAll(async () => {
    // Garante que os registros do seed já existem antes de capturar o
    // estado original a restaurar no afterAll.
    await executarSeed()

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: emailAdmin } })
    papelAdminOriginal = admin.papel

    const cliente = await prisma.user.findUniqueOrThrow({ where: { email: emailCliente } })
    const walletCliente = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente.id } })
    saldoClienteOriginal = walletCliente.saldoCentavos
  })

  afterAll(async () => {
    await prisma.user.update({ where: { email: emailAdmin }, data: { papel: papelAdminOriginal } })

    const cliente = await prisma.user.findUniqueOrThrow({ where: { email: emailCliente } })
    await prisma.wallet.update({
      where: { userId: cliente.id },
      data: { saldoCentavos: saldoClienteOriginal },
    })
  })

  it('restaura o papel do admin depois que ele foi alterado fora do seed', async () => {
    await prisma.user.update({ where: { email: emailAdmin }, data: { papel: 'CLIENTE' } })

    await executarSeed()

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: emailAdmin } })
    expect(admin.papel).toBe('ADMIN')
  })

  it('não repõe o saldo da carteira depois que o usuário gastou', async () => {
    const cliente = await prisma.user.findUniqueOrThrow({ where: { email: emailCliente } })
    const walletAntes = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente.id } })

    const valorGastoCentavos = 3000
    const saldoAposGasto = walletAntes.saldoCentavos - valorGastoCentavos
    // Sufixo aleatório: (refTipo, refId, tipo) é único no banco, e reexecuções
    // desta suíte (nesta sessão ou em outra) contra o mesmo banco de teste não
    // podem colidir com um lançamento de gasto simulado de uma execução
    // anterior que não foi limpo.
    const refTipoGasto = `TESTE_SEED_IDEMPOTENTE_${randomInt(0, 1_000_000_000)}`

    await prisma.$transaction([
      prisma.ledgerEntry.create({
        data: {
          walletId: walletAntes.id,
          tipo: 'DEBITO',
          valorCentavos: valorGastoCentavos,
          saldoAposCentavos: saldoAposGasto,
          refTipo: refTipoGasto,
          refId: cliente.id,
          descricao: 'Gasto simulado para testar que o seed não repõe saldo',
        },
      }),
      prisma.wallet.update({ where: { id: walletAntes.id }, data: { saldoCentavos: saldoAposGasto } }),
    ])

    await executarSeed()

    const walletDepois = await prisma.wallet.findUniqueOrThrow({ where: { userId: cliente.id } })
    expect(walletDepois.saldoCentavos).toBe(saldoAposGasto)
  })

  it('rodar o seed duas vezes não duplica usuários, carriers nem services', async () => {
    const [usuariosAntes, carriersAntes, servicesAntes] = await Promise.all([
      prisma.user.count({ where: { email: { in: [emailAdmin, emailCliente] } } }),
      prisma.carrier.count({ where: { slug: 'transportadora-propria' } }),
      prisma.service.count(),
    ])

    await executarSeed()
    await executarSeed()

    const [usuariosDepois, carriersDepois, servicesDepois] = await Promise.all([
      prisma.user.count({ where: { email: { in: [emailAdmin, emailCliente] } } }),
      prisma.carrier.count({ where: { slug: 'transportadora-propria' } }),
      prisma.service.count(),
    ])

    expect(usuariosDepois).toBe(usuariosAntes)
    expect(carriersDepois).toBe(carriersAntes)
    expect(servicesDepois).toBe(servicesAntes)
  })
})
