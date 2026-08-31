import { describe, expect, it } from 'vitest'
import { ValorInvalidoError } from '../errors'
import {
  CODIGOS_PADRAO,
  normalizarCodigoStatus,
  resolverCatalogo,
  validarStatusCustomizado,
  type LinhaStatus,
} from './catalogo-status'

function linha(sobrescritas: Partial<LinhaStatus> = {}): LinhaStatus {
  return {
    codigo: 'POSTADO',
    titulo: 'Objeto postado',
    descricao: 'Objeto postado',
    cenario: null,
    fracaoPrazo: null,
    statusResultante: null,
    ativo: true,
    ...sobrescritas,
  }
}

describe('normalizarCodigoStatus', () => {
  it('transforma texto livre em código estável', () => {
    expect(normalizarCodigoStatus('Saiu do centro')).toBe('SAIU_DO_CENTRO')
    expect(normalizarCodigoStatus('  em  trânsito  ')).toBe('EM_TRANSITO')
    expect(normalizarCodigoStatus('Ação-Rápida')).toBe('ACAO_RAPIDA')
  })

  it('recusa texto que não sobra nada depois de normalizar', () => {
    expect(() => normalizarCodigoStatus('   ')).toThrow(ValorInvalidoError)
    expect(() => normalizarCodigoStatus('!!!')).toThrow(ValorInvalidoError)
  })
})

describe('resolverCatalogo', () => {
  it('usa o texto padrão quando a conta não personalizou nada', () => {
    const padrao = [linha({ codigo: 'POSTADO', titulo: 'Objeto postado' })]

    const catalogo = resolverCatalogo(padrao, [])

    expect(catalogo.textos.POSTADO).toEqual({
      titulo: 'Objeto postado',
      descricao: 'Objeto postado',
    })
  })

  it('sobrepõe só o código personalizado, preservando os demais', () => {
    const padrao = [
      linha({ codigo: 'POSTADO', titulo: 'Objeto postado' }),
      linha({ codigo: 'ENTREGUE', titulo: 'Objeto entregue', descricao: 'Entregue' }),
    ]
    const doCliente = [linha({ codigo: 'POSTADO', titulo: 'Sua encomenda saiu da loja' })]

    const catalogo = resolverCatalogo(padrao, doCliente)

    expect(catalogo.textos.POSTADO?.titulo).toBe('Sua encomenda saiu da loja')
    expect(catalogo.textos.ENTREGUE?.titulo).toBe('Objeto entregue')
  })

  it('ignora linha desativada e volta ao texto padrão', () => {
    const padrao = [linha({ codigo: 'POSTADO', titulo: 'Objeto postado' })]
    const doCliente = [linha({ codigo: 'POSTADO', titulo: 'Personalizado', ativo: false })]

    const catalogo = resolverCatalogo(padrao, doCliente)

    expect(catalogo.textos.POSTADO?.titulo).toBe('Objeto postado')
  })

  it('devolve etapas extras apenas dos status criados pelo cliente', () => {
    const doCliente = [
      linha({ codigo: 'POSTADO', titulo: 'Só uma copy nova' }),
      linha({
        codigo: 'EM_CONFERENCIA',
        titulo: 'Em conferência',
        descricao: 'Conferindo o pedido',
        cenario: 'ENTREGA_NORMAL',
        fracaoPrazo: 0.4,
        statusResultante: 'POSTED',
      }),
    ]

    const catalogo = resolverCatalogo([], doCliente)

    // Reescrever a copy de um código existente não muda a forma do roteiro.
    expect(catalogo.etapasExtras).toHaveLength(1)
    expect(catalogo.etapasExtras[0]).toEqual({
      fracao: 0.4,
      codigo: 'EM_CONFERENCIA',
      titulo: 'Em conferência',
      descricao: 'Conferindo o pedido',
      cenario: 'ENTREGA_NORMAL',
      statusResultante: 'POSTED',
    })
  })

  it('não deixa etapa extra desativada entrar no roteiro', () => {
    const doCliente = [
      linha({
        codigo: 'EM_CONFERENCIA',
        cenario: 'ENTREGA_NORMAL',
        fracaoPrazo: 0.4,
        statusResultante: 'POSTED',
        ativo: false,
      }),
    ]

    expect(resolverCatalogo([], doCliente).etapasExtras).toHaveLength(0)
  })

  it('ordena as etapas extras pela fração do prazo', () => {
    const extra = (codigo: string, fracaoPrazo: number) =>
      linha({ codigo, cenario: 'ENTREGA_NORMAL', fracaoPrazo, statusResultante: 'POSTED' })

    const catalogo = resolverCatalogo([], [extra('C', 0.9), extra('A', 0.2), extra('B', 0.5)])

    expect(catalogo.etapasExtras.map((e) => e.codigo)).toEqual(['A', 'B', 'C'])
  })
})

describe('validarStatusCustomizado', () => {
  it('aceita um status customizado completo', () => {
    expect(() =>
      validarStatusCustomizado({
        codigo: 'EM_CONFERENCIA',
        cenario: 'ENTREGA_NORMAL',
        fracaoPrazo: 0.4,
        statusResultante: 'POSTED',
      }),
    ).not.toThrow()
  })

  it('recusa fração fora da faixa aceita', () => {
    for (const fracaoPrazo of [-0.1, 0, 5.1, Number.NaN]) {
      expect(() =>
        validarStatusCustomizado({
          codigo: 'X',
          cenario: 'ENTREGA_NORMAL',
          fracaoPrazo,
          statusResultante: 'POSTED',
        }),
      ).toThrow(ValorInvalidoError)
    }
  })

  it('exige cenário e status resultante quando há fração', () => {
    expect(() =>
      validarStatusCustomizado({
        codigo: 'X',
        cenario: null,
        fracaoPrazo: 0.4,
        statusResultante: 'POSTED',
      }),
    ).toThrow(ValorInvalidoError)

    expect(() =>
      validarStatusCustomizado({
        codigo: 'X',
        cenario: 'ENTREGA_NORMAL',
        fracaoPrazo: 0.4,
        statusResultante: null,
      }),
    ).toThrow(ValorInvalidoError)
  })

  it('recusa status resultante que encerra o envio', () => {
    // DELIVERED, LOST e CANCELLED são terminais na máquina de estados: um
    // evento intermediário que os produzisse travaria a timeline no meio.
    for (const statusResultante of ['DELIVERED', 'LOST', 'CANCELLED'] as const) {
      expect(() =>
        validarStatusCustomizado({
          codigo: 'X',
          cenario: 'ENTREGA_NORMAL',
          fracaoPrazo: 0.4,
          statusResultante,
        }),
      ).toThrow(ValorInvalidoError)
    }
  })

  it('não deixa o cliente sequestrar um código do catálogo padrão como etapa nova', () => {
    // Reescrever a copy de POSTADO é legítimo; transformá-lo numa etapa
    // extra duplicaria o evento na timeline.
    expect(() =>
      validarStatusCustomizado({
        codigo: CODIGOS_PADRAO[0]!,
        cenario: 'ENTREGA_NORMAL',
        fracaoPrazo: 0.4,
        statusResultante: 'POSTED',
      }),
    ).toThrow(ValorInvalidoError)
  })
})
