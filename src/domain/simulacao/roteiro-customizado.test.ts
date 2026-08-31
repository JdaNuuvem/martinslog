import { describe, expect, it } from 'vitest'
import { ValorInvalidoError, TransicaoInvalidaError } from '../errors'
import { gerarRoteiro, statusDoEvento, validarRoteiro } from './roteiro'
import type { EntradaRoteiro } from './tipos'

function entrada(sobrescritas: Partial<EntradaRoteiro> = {}): EntradaRoteiro {
  return {
    cenario: 'ENTREGA_NORMAL',
    prazoDias: 5,
    origem: { cidade: 'São Paulo', uf: 'SP' },
    destino: { cidade: 'Rio de Janeiro', uf: 'RJ' },
    ...sobrescritas,
  }
}

describe('statusDoEvento', () => {
  it('resolve os códigos padrão sem mapa extra', () => {
    expect(statusDoEvento('POSTADO')).toBe('POSTED')
    expect(statusDoEvento('ENTREGUE')).toBe('DELIVERED')
  })

  it('resolve código da conta pelo mapa informado', () => {
    expect(statusDoEvento('EM_CONFERENCIA', { EM_CONFERENCIA: 'POSTED' })).toBe('POSTED')
  })

  it('lança em vez de devolver undefined para código desconhecido', () => {
    // Devolver undefined fazia sincronizarEnvio parar em silêncio: o
    // rastreio congelava e ninguém percebia.
    expect(() => statusDoEvento('NAO_EXISTE')).toThrow(ValorInvalidoError)
  })
})

describe('validarRoteiro', () => {
  it('aceita a sequência padrão', () => {
    expect(() => validarRoteiro(gerarRoteiro(entrada()))).not.toThrow()
  })

  it('recusa evento que volta de um status terminal', () => {
    expect(() =>
      validarRoteiro([{ codigo: 'ENTREGUE' }, { codigo: 'POSTADO' }]),
    ).toThrow(TransicaoInvalidaError)
  })
})

describe('gerarRoteiro com catálogo da conta', () => {
  it('usa o texto da conta e mantém o padrão no que ela não personalizou', () => {
    const eventos = gerarRoteiro(
      entrada({ textos: { POSTADO: { titulo: 'Saiu da nossa loja', descricao: 'A caminho' } } }),
    )

    const postado = eventos.find((e) => e.codigo === 'POSTADO')
    const entregue = eventos.find((e) => e.codigo === 'ENTREGUE')
    expect(postado?.titulo).toBe('Saiu da nossa loja')
    expect(entregue?.titulo).toBe('Objeto entregue ao destinatário')
  })

  it('encaixa a etapa da conta na posição certa pela fração do prazo', () => {
    const eventos = gerarRoteiro(
      entrada({
        etapasExtras: [
          {
            fracao: 0.4,
            codigo: 'EM_CONFERENCIA',
            titulo: 'Em conferência',
            descricao: 'Conferindo o pedido',
            cenario: 'ENTREGA_NORMAL',
            statusResultante: 'POSTED',
          },
        ],
      }),
    )

    const codigos = eventos.map((e) => e.codigo)
    expect(codigos).toContain('EM_CONFERENCIA')

    // Entre a transferência de 0,25 e a de 0,55.
    const posicao = codigos.indexOf('EM_CONFERENCIA')
    expect(eventos[posicao - 1]?.codigo).toBe('TRANSFERENCIA')
    expect(eventos[posicao + 1]?.codigo).toBe('TRANSFERENCIA')

    // A sequência é renumerada sem buracos depois da fusão.
    expect(eventos.map((e) => e.sequencia)).toEqual(eventos.map((_, i) => i + 1))
  })

  it('não deixa etapa de outro cenário vazar para este envio', () => {
    const eventos = gerarRoteiro(
      entrada({
        cenario: 'ENTREGA_NORMAL',
        etapasExtras: [
          {
            fracao: 0.4,
            codigo: 'SO_NO_ATRASO',
            titulo: 'Só no atraso',
            descricao: 'x',
            cenario: 'ATRASO',
            statusResultante: 'POSTED',
          },
        ],
      }),
    )

    expect(eventos.map((e) => e.codigo)).not.toContain('SO_NO_ATRASO')
  })

  it('barra na geração uma etapa que quebra a máquina de estados', () => {
    // A etapa é válida isolada, mas cai depois da entrega (1,0·P) e
    // produziria DELIVERED → POSTED. O painel não consegue enxergar isso ao
    // salvar, porque não conhece os vizinhos.
    expect(() =>
      gerarRoteiro(
        entrada({
          etapasExtras: [
            {
              fracao: 1.5,
              codigo: 'DEPOIS_DA_ENTREGA',
              titulo: 'Tarde demais',
              descricao: 'x',
              cenario: 'ENTREGA_NORMAL',
              statusResultante: 'POSTED',
            },
          ],
        }),
      ),
    ).toThrow(TransicaoInvalidaError)
  })

  it('aceita etapa da conta com o texto que ela mesma carrega', () => {
    expect(() =>
      gerarRoteiro(
        entrada({
          etapasExtras: [
            {
              fracao: 0.4,
              codigo: 'SEM_TEXTO',
              titulo: '',
              descricao: '',
              cenario: 'ENTREGA_NORMAL',
              statusResultante: 'POSTED',
            },
          ],
        }),
      ),
    ).not.toThrow()
  })
})
