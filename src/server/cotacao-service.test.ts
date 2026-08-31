import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/infra/db/client'
import { CepInvalidoError, ServicoIndisponivelError } from '@/domain/errors'
import type { EnderecoCep, GeoProvider } from '@/infra/geo'
import { gerarCotacao, type SolicitacaoCotacao } from './cotacao-service'

const CEP_ORIGEM = '01001-000'
const CEP_DESTINO = '20040-002'

const enderecoFake: EnderecoCep = {
  cep: '01001000',
  logradouro: 'Praça da Sé',
  bairro: 'Sé',
  cidade: 'São Paulo',
  uf: 'SP',
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function solicitacaoValida(): SolicitacaoCotacao {
  return {
    cepOrigem: CEP_ORIGEM,
    cepDestino: CEP_DESTINO,
    pesoRealG: 300,
    alturaCm: 4,
    larguraCm: 12,
    comprimentoCm: 18,
    formato: 'CAIXA',
  }
}

/** Resolve `buscarPorCep` conforme uma tabela fixa: cep -> ação (endereço, erro imediato ou erro após um atraso). */
class ProvedorControlado implements GeoProvider {
  chamadas: { cep: string; inicio: number }[] = []

  constructor(
    private readonly comportamento: Map<string, { erro?: () => Error; atrasoMs?: number }>,
  ) {}

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    this.chamadas.push({ cep, inicio: Date.now() })
    const config = this.comportamento.get(cep)
    if (!config) return enderecoFake

    if (config.atrasoMs) {
      await esperar(config.atrasoMs)
    }

    if (config.erro) {
      throw config.erro()
    }

    return enderecoFake
  }
}

const anonSessionIdsCriados: string[] = []

afterAll(async () => {
  await prisma.quote.deleteMany({ where: { anonSessionId: { in: anonSessionIdsCriados } } })
  await prisma.anonSession.deleteMany({ where: { id: { in: anonSessionIdsCriados } } })
})

async function gerar(provider: GeoProvider, solicitacao = solicitacaoValida()) {
  const resultado = await gerarCotacao(solicitacao, { userId: null, anonSessionId: null }, provider)
  anonSessionIdsCriados.push(resultado.anonSessionId as string)
  return resultado
}

describe('gerarCotacao — validação de existência de CEP', () => {
  it('recusa quando o CEP de origem não existe, citando a origem', async () => {
    const provider = new ProvedorControlado(
      new Map([[CEP_ORIGEM, { erro: () => new CepInvalidoError('CEP não encontrado.') }]]),
    )

    const antes = await prisma.quote.count({ where: { cepOrigem: CEP_ORIGEM, cepDestino: CEP_DESTINO } })

    await expect(gerarCotacao(solicitacaoValida(), { userId: null, anonSessionId: null }, provider)).rejects.toMatchObject(
      { codigo: 'CEP_INVALIDO', message: expect.stringContaining(CEP_ORIGEM) },
    )

    const depois = await prisma.quote.count({ where: { cepOrigem: CEP_ORIGEM, cepDestino: CEP_DESTINO } })
    expect(depois).toBe(antes)
  })

  it('recusa quando o CEP de destino não existe, citando o destino', async () => {
    const provider = new ProvedorControlado(
      new Map([[CEP_DESTINO, { erro: () => new CepInvalidoError('CEP não encontrado.') }]]),
    )

    const antes = await prisma.quote.count({ where: { cepOrigem: CEP_ORIGEM, cepDestino: CEP_DESTINO } })

    await expect(gerarCotacao(solicitacaoValida(), { userId: null, anonSessionId: null }, provider)).rejects.toMatchObject(
      { codigo: 'CEP_INVALIDO', message: expect.stringContaining(CEP_DESTINO) },
    )

    const depois = await prisma.quote.count({ where: { cepOrigem: CEP_ORIGEM, cepDestino: CEP_DESTINO } })
    expect(depois).toBe(antes)
  })

  it('prossegue normalmente quando o provedor está fora do ar nos dois CEPs', async () => {
    const provider = new ProvedorControlado(
      new Map([
        [CEP_ORIGEM, { erro: () => new ServicoIndisponivelError('Serviço indisponível (HTTP 500)') }],
        [CEP_DESTINO, { erro: () => new ServicoIndisponivelError('Serviço indisponível (HTTP 500)') }],
      ]),
    )

    const resultado = await gerar(provider)

    expect(resultado.opcoes.length).toBeGreaterThan(0)
    const quote = await prisma.quote.findUnique({ where: { id: resultado.quoteId } })
    expect(quote).not.toBeNull()
  })

  it('recusa quando um CEP é inválido e o outro tem o provedor fora do ar (inválido chegando primeiro)', async () => {
    const provider = new ProvedorControlado(
      new Map([
        [CEP_ORIGEM, { erro: () => new CepInvalidoError('CEP não encontrado.') }], // sem atraso: chega primeiro
        [CEP_DESTINO, { erro: () => new ServicoIndisponivelError('Timeout'), atrasoMs: 40 }], // chega depois
      ]),
    )

    await expect(gerarCotacao(solicitacaoValida(), { userId: null, anonSessionId: null }, provider)).rejects.toMatchObject(
      { codigo: 'CEP_INVALIDO' },
    )
  })

  it('recusa quando um CEP é inválido e o outro tem o provedor fora do ar (indisponível chegando primeiro)', async () => {
    const provider = new ProvedorControlado(
      new Map([
        [CEP_ORIGEM, { erro: () => new ServicoIndisponivelError('Timeout'), atrasoMs: 0 }], // resolve/rejeita antes
        [CEP_DESTINO, { erro: () => new CepInvalidoError('CEP não encontrado.'), atrasoMs: 40 }], // chega depois, mas tem precedência
      ]),
    )

    await expect(gerarCotacao(solicitacaoValida(), { userId: null, anonSessionId: null }, provider)).rejects.toMatchObject(
      { codigo: 'CEP_INVALIDO' },
    )
  })

  it('cota normalmente quando os dois CEPs são válidos (caminho feliz)', async () => {
    const provider = new ProvedorControlado(new Map())

    const resultado = await gerar(provider)

    expect(resultado.opcoes.length).toBeGreaterThan(0)
    expect(typeof resultado.quoteId).toBe('string')
  })

  it('resolve os dois CEPs em paralelo, não em sequência', async () => {
    const atrasoMs = 60
    const provider = new ProvedorControlado(
      new Map([
        [CEP_ORIGEM, { atrasoMs }],
        [CEP_DESTINO, { atrasoMs }],
      ]),
    )

    await gerar(provider)

    expect(provider.chamadas).toHaveLength(2)
    const [primeira, segunda] = provider.chamadas
    const diferencaInicio = Math.abs(segunda!.inicio - primeira!.inicio)
    // Se fosse sequencial, a segunda chamada só começaria depois que a
    // primeira (que demora `atrasoMs`) tivesse terminado. Em paralelo, as
    // duas começam quase juntas.
    expect(diferencaInicio).toBeLessThan(atrasoMs / 2)
  })
})
