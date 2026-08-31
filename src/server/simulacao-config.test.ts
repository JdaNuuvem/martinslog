import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { ID_CONFIG_SIMULACAO, obterConfigSimulacao } from './simulacao-config'

const original = { fatorVelocidade: 1, operador: 'DE ENCOMENDAS' }

afterAll(async () => {
  await prisma.simulacaoConfig.update({
    where: { id: ID_CONFIG_SIMULACAO },
    data: original,
  })
})

describe('obterConfigSimulacao', () => {
  it('devolve o registro único com os padrões neutros', async () => {
    await prisma.simulacaoConfig.update({ where: { id: ID_CONFIG_SIMULACAO }, data: original })

    expect(await obterConfigSimulacao()).toEqual(original)
  })

  it('reflete a configuração gravada', async () => {
    await prisma.simulacaoConfig.update({
      where: { id: ID_CONFIG_SIMULACAO },
      data: { fatorVelocidade: 288, operador: 'ROTA SUL' },
    })

    expect(await obterConfigSimulacao()).toEqual({
      fatorVelocidade: 288,
      operador: 'ROTA SUL',
    })
  })

  it('recria o registro se ele não existir — ler configuração não derruba a emissão', async () => {
    await prisma.simulacaoConfig.deleteMany({ where: { id: ID_CONFIG_SIMULACAO } })

    expect(await obterConfigSimulacao()).toEqual(original)
  })

  it('funciona dentro de uma transação', async () => {
    const config = await prisma.$transaction((tx) => obterConfigSimulacao(tx))

    expect(config.fatorVelocidade).toBeGreaterThan(0)
  })
})
