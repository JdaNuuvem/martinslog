import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { prisma } from './client'

describe('prisma client singleton', () => {
  it('exporta uma instância de PrismaClient com os métodos esperados', () => {
    expect(typeof prisma.$connect).toBe('function')
    expect(typeof prisma.$disconnect).toBe('function')
    expect(typeof prisma.$queryRaw).toBe('function')
    expect(prisma.user).toBeDefined()
  })

  it('reaproveita a mesma instância em globalThis fora de produção', () => {
    const global2 = globalThis as unknown as { __prisma?: PrismaClient }
    expect(global2.__prisma).toBe(prisma)
  })

  it('consegue executar uma query simples contra o banco', async () => {
    const resultado = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`
    expect(resultado[0]?.ok).toBe(1)
  })
})
