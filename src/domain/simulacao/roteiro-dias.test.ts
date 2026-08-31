import { describe, expect, it } from 'vitest'
import { gerarRoteiro } from './roteiro'
import type { EntradaRoteiro } from './tipos'

const MINUTOS_POR_DIA = 1440

const base: EntradaRoteiro = {
  cenario: 'ENTREGA_NORMAL',
  prazoDias: 5,
  origem: { cidade: 'São Paulo', uf: 'SP' },
  destino: { cidade: 'Rio de Janeiro', uf: 'RJ' },
}

function offsetPorCodigo(entrada: EntradaRoteiro): Record<string, number[]> {
  const mapa: Record<string, number[]> = {}
  for (const evento of gerarRoteiro(entrada)) {
    mapa[evento.codigo] = [...(mapa[evento.codigo] ?? []), evento.offsetMinutos]
  }
  return mapa
}

/**
 * Posicionamento em dias — o "muda de status a cada X dias" da operação.
 *
 * O motor continua sabendo posicionar por fração do prazo do serviço; estes
 * testes cobrem o caminho alternativo, em que a posição é um número absoluto
 * de dias e o prazo contratado deixa de influenciar aquela etapa.
 */
describe('gerarRoteiro com posições em dias', () => {
  it('sem posições em dias, mantém as frações do prazo', () => {
    const offsets = offsetPorCodigo(base)

    expect(offsets.ETIQUETA_EMITIDA).toEqual([0])
    expect(offsets.POSTADO).toEqual([0.1 * 5 * MINUTOS_POR_DIA])
    expect(offsets.ENTREGUE).toEqual([1.0 * 5 * MINUTOS_POR_DIA])
  })

  it('reposiciona uma etapa do roteiro padrão para o dia pedido', () => {
    const offsets = offsetPorCodigo({ ...base, posicoesDias: { POSTADO: 2 } })

    expect(offsets.POSTADO).toEqual([2 * MINUTOS_POR_DIA])
    // As demais não se mexem: mover uma etapa não é reescrever o roteiro.
    expect(offsets.ENTREGUE).toEqual([1.0 * 5 * MINUTOS_POR_DIA])
  })

  it('a posição em dias não depende do prazo do serviço', () => {
    const curto = offsetPorCodigo({ ...base, prazoDias: 5, posicoesDias: { POSTADO: 3 } })
    const longo = offsetPorCodigo({ ...base, prazoDias: 20, posicoesDias: { POSTADO: 3 } })

    expect(curto.POSTADO).toEqual([3 * MINUTOS_POR_DIA])
    expect(longo.POSTADO).toEqual([3 * MINUTOS_POR_DIA])
    // A prova de que é absoluto: no prazo de 20 dias, a fração equivalente
    // seria 0,1 · 20 = 2 dias, e não 3.
    expect(longo.POSTADO).not.toEqual([0.1 * 20 * MINUTOS_POR_DIA])
  })

  it('recusa a posição em dias que atropela a entrega em um serviço curto', () => {
    // Mesmos 3 dias, prazo de 2: a postagem cairia depois da entrega. O motor
    // reprova em vez de gravar uma timeline impossível — a configuração é
    // global, mas a validade depende do prazo de cada serviço.
    expect(() =>
      gerarRoteiro({ ...base, prazoDias: 2, posicoesDias: { POSTADO: 3 } }),
    ).toThrow()
  })

  it('código repetido: a segunda ocorrência preserva o intervalo até a primeira', () => {
    // TRANSFERENCIA aparece duas vezes na rota interestadual, em 0,25·P e
    // 0,55·P — 0,30·P de intervalo, que com prazo 5 são 1,5 dias.
    const offsets = offsetPorCodigo({ ...base, posicoesDias: { TRANSFERENCIA: 1 } })

    expect(offsets.TRANSFERENCIA).toEqual([1 * MINUTOS_POR_DIA, 2.5 * MINUTOS_POR_DIA])
  })

  it('cadência fixa: cada etapa do fluxo normal a cada 2 dias', () => {
    const eventos = gerarRoteiro({
      ...base,
      posicoesDias: {
        ETIQUETA_EMITIDA: 0,
        POSTADO: 2,
        TRANSFERENCIA: 4,
        SAIU_PARA_ENTREGA: 8,
        ENTREGUE: 10,
      },
    })

    expect(eventos.map((evento) => evento.offsetMinutos / MINUTOS_POR_DIA)).toEqual([
      0, 2, 4, 5.5, 8, 10,
    ])
    // 5,5 é a segunda TRANSFERENCIA, que herdou o intervalo de 1,5 dia da
    // primeira; a ordem cronológica dos eventos continua íntegra.
    expect(eventos.map((evento) => evento.codigo)).toEqual([
      'ETIQUETA_EMITIDA',
      'POSTADO',
      'TRANSFERENCIA',
      'TRANSFERENCIA',
      'SAIU_PARA_ENTREGA',
      'ENTREGUE',
    ])
  })

  it('reordena a timeline quando a posição em dias muda a ordem das etapas', () => {
    // POSTADO empurrado para depois de onde caía a saída para entrega.
    const eventos = gerarRoteiro({ ...base, posicoesDias: { SAIU_PARA_ENTREGA: 0.2 } })
    const offsets = eventos.map((evento) => evento.offsetMinutos)

    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets)
    expect(eventos.map((evento) => evento.sequencia)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('etapa da conta posicionada em dias entra no instante pedido', () => {
    const eventos = gerarRoteiro({
      ...base,
      etapasExtras: [
        {
          fracao: 0.4,
          dias: 3,
          codigo: 'EM_CONFERENCIA',
          titulo: 'Em conferência',
          descricao: 'Objeto em conferência na unidade',
          cenario: 'ENTREGA_NORMAL',
          statusResultante: 'POSTED',
        },
      ],
    })

    const extra = eventos.find((evento) => evento.codigo === 'EM_CONFERENCIA')
    expect(extra?.offsetMinutos).toBe(3 * MINUTOS_POR_DIA)
  })

  it('recusa uma posição em dias que jogue uma etapa depois da entrega', () => {
    // ENTREGUE cai em 5 dias; mover a postagem para o dia 9 produziria
    // DELIVERED seguido de POSTED, que a máquina de estados não permite.
    expect(() => gerarRoteiro({ ...base, posicoesDias: { POSTADO: 9 } })).toThrow()
  })
})
