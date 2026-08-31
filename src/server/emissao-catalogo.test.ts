import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { gerarRoteiro } from '@/domain/simulacao/roteiro'
import { salvarStatus } from './status-rastreio-service'

/**
 * Efeito do catálogo da conta na emissão da etiqueta.
 *
 * Cobre o ponto que a revisão levantou: a etapa da conta entra na sequência
 * gravada por `createMany`, e `TrackingEvent` tem `@@unique([shipmentId,
 * sequencia])`. Sequência repetida quebraria a emissão por violação de
 * unicidade.
 */

let contador = 0
const usuariosCriados: string[] = []

async function criarUsuario(): Promise<string> {
  contador += 1
  const user = await prisma.user.create({
    data: {
      tipo: 'PF',
      papel: 'CLIENTE',
      documento: `${Date.now()}${contador}`.slice(-11),
      nome: 'Conta Teste Emissão',
      email: `emissao-cat-${Date.now()}-${contador}@teste.com`,
      senhaHash: 'hash-fake-nao-usado-neste-teste',
    },
  })
  usuariosCriados.push(user.id)
  return user.id
}

afterAll(async () => {
  await prisma.statusRastreio.deleteMany({ where: { userId: { in: usuariosCriados } } })
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } })
})

const ENTRADA_BASE = {
  cenario: 'ENTREGA_NORMAL' as const,
  prazoDias: 5,
  origem: { cidade: 'São Paulo', uf: 'SP' },
  destino: { cidade: 'Rio de Janeiro', uf: 'RJ' },
}

describe('sequência do roteiro com etapa da conta', () => {
  it('renumera sem repetir quando a etapa cai exatamente sobre uma etapa padrão', async () => {
    // 0,1·P é a fração de POSTADO. Empate de fração é o caso que produziria
    // sequência duplicada e quebraria o createMany pelo índice único
    // (shipmentId, sequencia).
    const eventos = gerarRoteiro({
      ...ENTRADA_BASE,
      etapasExtras: [
        {
          fracao: 0.1,
          codigo: 'EMPATE',
          titulo: 'Empate',
          descricao: 'Mesma fração de POSTADO',
          cenario: 'ENTREGA_NORMAL',
          statusResultante: 'POSTED',
        },
      ],
    })

    const sequencias = eventos.map((e) => e.sequencia)
    expect(new Set(sequencias).size).toBe(sequencias.length)
    expect(sequencias).toEqual(eventos.map((_, i) => i + 1))
  })

  it('mantém a etapa do cenário na frente no empate, e não atropela a entrega', async () => {
    const eventos = gerarRoteiro({
      ...ENTRADA_BASE,
      etapasExtras: [
        {
          fracao: 0.1,
          codigo: 'EMPATE',
          titulo: 'Empate',
          descricao: 'x',
          cenario: 'ENTREGA_NORMAL',
          statusResultante: 'POSTED',
        },
      ],
    })

    const codigos = eventos.map((e) => e.codigo)
    expect(codigos.indexOf('POSTADO')).toBeLessThan(codigos.indexOf('EMPATE'))
    expect(codigos[codigos.length - 1]).toBe('ENTREGUE')
  })

  it('várias etapas da conta convivem sem repetir sequência', async () => {
    const eventos = gerarRoteiro({
      ...ENTRADA_BASE,
      etapasExtras: [0.15, 0.3, 0.45, 0.6, 0.75].map((fracao, i) => ({
        fracao,
        codigo: `EXTRA_${i}`,
        titulo: `Extra ${i}`,
        descricao: 'x',
        cenario: 'ENTREGA_NORMAL' as const,
        statusResultante: 'POSTED' as const,
      })),
    })

    const sequencias = eventos.map((e) => e.sequencia)
    expect(new Set(sequencias).size).toBe(sequencias.length)
    expect(eventos.filter((e) => e.codigo.startsWith('EXTRA_'))).toHaveLength(5)
  })
})

describe('catálogo da conta chega ao roteiro emitido', () => {
  it('a copy personalizada aparece no evento gerado', async () => {
    const userId = await criarUsuario()
    await salvarStatus(userId, {
      nome: 'POSTADO',
      titulo: 'Saiu da nossa loja',
      descricao: 'Sua encomenda está a caminho',
    })

    const { catalogoDoUsuario } = await import('./status-rastreio-service')
    const catalogo = await catalogoDoUsuario(userId)

    const eventos = gerarRoteiro({
      ...ENTRADA_BASE,
      textos: catalogo.textos,
      etapasExtras: catalogo.etapasExtras,
    })

    expect(eventos.find((e) => e.codigo === 'POSTADO')?.titulo).toBe('Saiu da nossa loja')
  })

  it('conta sem personalização gera exatamente o roteiro padrão', async () => {
    const userId = await criarUsuario()
    const { catalogoDoUsuario } = await import('./status-rastreio-service')
    const catalogo = await catalogoDoUsuario(userId)

    const comCatalogo = gerarRoteiro({
      ...ENTRADA_BASE,
      textos: catalogo.textos,
      etapasExtras: catalogo.etapasExtras,
    })

    // Regressão: ligar o catálogo não pode mudar nada para quem nunca
    // personalizou. Só vale se houver catálogo padrão semeado; sem ele,
    // `textos` vem vazio e o roteiro cai nos textos embutidos do motor.
    expect(comCatalogo.map((e) => e.codigo)).toEqual(gerarRoteiro(ENTRADA_BASE).map((e) => e.codigo))
  })
})
