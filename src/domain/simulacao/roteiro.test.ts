import { describe, expect, it } from 'vitest'
import { calcularOcorridoEm, gerarRoteiro, statusDoEvento } from './roteiro'
import type { CenarioSimulacao } from './tipos'

const SP = { cidade: 'São Paulo', uf: 'SP' }
const RJ = { cidade: 'Nova Iguaçu', uf: 'RJ' }

const base = { prazoDias: 5, origem: SP, destino: RJ } as const

/** Acesso indexado com falha explícita — o teste não deve morrer com `undefined`. */
function em<T>(lista: readonly T[], indice: number): T {
  const item = lista[indice]
  if (item === undefined) {
    throw new Error(`Índice ${indice} fora do roteiro de ${lista.length} eventos`)
  }
  return item
}

const ultimo = <T,>(lista: readonly T[]): T => em(lista, lista.length - 1)

const CENARIOS: CenarioSimulacao[] = [
  'ENTREGA_NORMAL',
  'ATRASO',
  'TENTATIVA_FALHA',
  'EXTRAVIO',
  'DEVOLUCAO',
]

describe('gerarRoteiro — invariantes de todos os cenários', () => {
  it.each(CENARIOS)('%s tem sequência densa e offsets não decrescentes', (cenario) => {
    const roteiro = gerarRoteiro({ ...base, cenario })

    expect(roteiro.length).toBeGreaterThan(1)
    expect(roteiro.map((evento) => evento.sequencia)).toEqual(
      roteiro.map((_, indice) => indice + 1),
    )
    for (let i = 1; i < roteiro.length; i += 1) {
      expect(em(roteiro, i).offsetMinutos).toBeGreaterThanOrEqual(em(roteiro, i - 1).offsetMinutos)
    }
    expect(em(roteiro, 0).codigo).toBe('ETIQUETA_EMITIDA')
    expect(em(roteiro, 0).offsetMinutos).toBe(0)
  })

  it.each(CENARIOS)('%s termina em evento terminal', (cenario) => {
    const roteiro = gerarRoteiro({ ...base, cenario })
    expect(['ENTREGUE', 'EXTRAVIADO', 'DEVOLVIDO']).toContain(
      ultimo(roteiro).codigo,
    )
  })
})

describe('gerarRoteiro — ENTREGA_NORMAL', () => {
  it('segue a sequência da spec com offsets proporcionais ao prazo', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'ENTREGA_NORMAL' })

    expect(roteiro.map((evento) => evento.codigo)).toEqual([
      'ETIQUETA_EMITIDA',
      'POSTADO',
      'TRANSFERENCIA',
      'TRANSFERENCIA',
      'SAIU_PARA_ENTREGA',
      'ENTREGUE',
    ])
    // 5 dias = 7200 minutos de simulação.
    expect(roteiro.map((evento) => evento.offsetMinutos)).toEqual([
      0, 720, 1800, 3960, 6120, 7200,
    ])
  })

  it('escala a mesma forma para prazos diferentes', () => {
    const curto = gerarRoteiro({ ...base, prazoDias: 1, cenario: 'ENTREGA_NORMAL' })
    const longo = gerarRoteiro({ ...base, prazoDias: 10, cenario: 'ENTREGA_NORMAL' })

    expect(curto.map((evento) => evento.codigo)).toEqual(longo.map((evento) => evento.codigo))
    expect(ultimo(curto).offsetMinutos).toBe(1440)
    expect(ultimo(longo).offsetMinutos).toBe(14400)
  })

  it('nomeia as unidades a partir de cidade e UF do envio', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'ENTREGA_NORMAL' })

    expect(em(roteiro, 0).unidadeOrigem).toBe('INTERFACE DO SISTEMA- BR')
    expect(em(roteiro, 1).unidadeOrigem).toBe('AGÊNCIA DE ENCOMENDAS- SAO PAULO/SP')
    expect(em(roteiro, 3).unidadeOrigem).toBe('UNIDADE DE TRATAMENTO- SAO PAULO/SP')
    expect(em(roteiro, 3).unidadeDestino).toBe('UNIDADE DE TRATAMENTO- NOVA IGUACU/RJ')
    expect(em(roteiro, 5).unidadeOrigem).toBe('UNIDADE DE DISTRIBUIÇÃO- NOVA IGUACU/RJ')
  })

  it('usa o operador configurado no nome da agência', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'ENTREGA_NORMAL', operador: 'Rota Sul' })
    expect(em(roteiro, 1).unidadeOrigem).toBe('AGÊNCIA ROTA SUL- SAO PAULO/SP')
  })

  it('funde as duas transferências quando origem e destino são a mesma cidade', () => {
    const roteiro = gerarRoteiro({
      cenario: 'ENTREGA_NORMAL',
      prazoDias: 5,
      origem: SP,
      destino: { cidade: 'SAO PAULO', uf: 'sp' },
    })

    expect(roteiro.filter((evento) => evento.codigo === 'TRANSFERENCIA')).toHaveLength(1)
    expect(roteiro.map((evento) => evento.sequencia)).toEqual([1, 2, 3, 4, 5])
  })

  it('leva a cidade e a UF de cada etapa no evento', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'ENTREGA_NORMAL' })
    expect(em(roteiro, 1)).toMatchObject({ cidade: 'São Paulo', uf: 'SP' })
    expect(em(roteiro, 4)).toMatchObject({ cidade: 'Nova Iguaçu', uf: 'RJ' })
  })
})

describe('gerarRoteiro — demais cenários', () => {
  it('ATRASO entrega com ~80% de atraso sobre o prazo', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'ATRASO' })

    expect(roteiro.map((evento) => evento.codigo)).toEqual([
      'ETIQUETA_EMITIDA',
      'POSTADO',
      'TRANSFERENCIA',
      'TRANSFERENCIA',
      'AGUARDANDO_TRATAMENTO',
      'SAIU_PARA_ENTREGA',
      'ENTREGUE',
    ])
    expect(ultimo(roteiro).offsetMinutos).toBe(Math.round(1.8 * 7200))
  })

  it('TENTATIVA_FALHA entrega na segunda tentativa', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'TENTATIVA_FALHA' })

    expect(roteiro.map((evento) => evento.codigo)).toEqual([
      'ETIQUETA_EMITIDA',
      'POSTADO',
      'TRANSFERENCIA',
      'TRANSFERENCIA',
      'SAIU_PARA_ENTREGA',
      'TENTATIVA_FRUSTRADA',
      'AGUARDANDO_RETIRADA',
      'SAIU_PARA_ENTREGA',
      'ENTREGUE',
    ])
    expect(ultimo(roteiro).offsetMinutos).toBe(2 * 7200)
  })

  it('EXTRAVIO para no evento de extravio', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'EXTRAVIO' })

    expect(roteiro.map((evento) => evento.codigo)).toEqual([
      'ETIQUETA_EMITIDA',
      'POSTADO',
      'TRANSFERENCIA',
      'TRANSFERENCIA',
      'EXTRAVIADO',
    ])
    expect(ultimo(roteiro).offsetMinutos).toBe(Math.round(1.5 * 7200))
  })

  it('DEVOLUCAO termina entregando ao remetente', () => {
    const roteiro = gerarRoteiro({ ...base, cenario: 'DEVOLUCAO' })

    expect(roteiro.map((evento) => evento.codigo)).toEqual([
      'ETIQUETA_EMITIDA',
      'POSTADO',
      'TRANSFERENCIA',
      'TRANSFERENCIA',
      'SAIU_PARA_ENTREGA',
      'TENTATIVA_FRUSTRADA',
      'AGUARDANDO_RETIRADA',
      'DEVOLUCAO_INICIADA',
      'DEVOLVIDO',
    ])
    // O objeto volta para a origem: o evento final acontece na cidade do remetente.
    expect(ultimo(roteiro)).toMatchObject({ cidade: 'São Paulo', uf: 'SP' })
  })
})

describe('statusDoEvento', () => {
  it('mapeia cada código para o status da spec', () => {
    expect(statusDoEvento('ETIQUETA_EMITIDA')).toBe('GENERATED')
    expect(statusDoEvento('POSTADO')).toBe('POSTED')
    expect(statusDoEvento('TRANSFERENCIA')).toBe('POSTED')
    expect(statusDoEvento('AGUARDANDO_TRATAMENTO')).toBe('POSTED')
    expect(statusDoEvento('SAIU_PARA_ENTREGA')).toBe('POSTED')
    expect(statusDoEvento('TENTATIVA_FRUSTRADA')).toBe('POSTED')
    expect(statusDoEvento('AGUARDANDO_RETIRADA')).toBe('POSTED')
    expect(statusDoEvento('DEVOLUCAO_INICIADA')).toBe('POSTED')
    expect(statusDoEvento('ENTREGUE')).toBe('DELIVERED')
    expect(statusDoEvento('EXTRAVIADO')).toBe('LOST')
    expect(statusDoEvento('DEVOLVIDO')).toBe('DELIVERED')
  })
})

describe('calcularOcorridoEm', () => {
  const inicio = new Date('2026-08-31T12:00:00.000Z')

  it('com fator 1 o offset é minuto real', () => {
    expect(calcularOcorridoEm(inicio, 60, 1).toISOString()).toBe('2026-08-31T13:00:00.000Z')
  })

  it('com fator 1440 um dia de simulação leva um minuto', () => {
    expect(calcularOcorridoEm(inicio, 1440, 1440).toISOString()).toBe(
      '2026-08-31T12:01:00.000Z',
    )
  })

  it('recusa fator não positivo', () => {
    expect(() => calcularOcorridoEm(inicio, 60, 0)).toThrow()
    expect(() => calcularOcorridoEm(inicio, 60, -3)).toThrow()
  })
})
