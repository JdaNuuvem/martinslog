import { describe, expect, it } from 'vitest'
import { ValorInvalidoError } from '../errors'
import {
  PALETA,
  itemDaPaleta,
  statusPorCodigoDoTemplate,
  templatePadrao,
  validarTemplate,
  type PassoTemplate,
} from './template-rastreio'

function passo(codigo: string, diasAposEmissao: number): PassoTemplate {
  const item = itemDaPaleta(codigo)
  return {
    codigo,
    titulo: item?.rotulo ?? codigo,
    descricao: item?.descricaoPadrao ?? 'x',
    diasAposEmissao,
  }
}

describe('paleta', () => {
  it('oferece as tentativas numeradas, que são o caso de repetição', () => {
    const numeradas = PALETA.filter((item) => item.codigo.startsWith('TENTATIVA_ENTREGA_'))
    expect(numeradas.length).toBeGreaterThanOrEqual(3)
    expect(numeradas[0]?.rotulo).toBe('1ª tentativa de entrega')
  })

  it('marca como terminal só o que encerra o envio', () => {
    const terminais = PALETA.filter((item) => item.terminal).map((item) => item.codigo)
    expect(terminais.sort()).toEqual(['DEVOLVIDO', 'ENTREGUE', 'EXTRAVIADO'])
  })

  it('reaproveita os códigos do motor, para o resto do sistema reconhecer o evento', () => {
    for (const codigo of ['ETIQUETA_EMITIDA', 'POSTADO', 'TRANSFERENCIA', 'ENTREGUE']) {
      expect(itemDaPaleta(codigo)).toBeDefined()
    }
  })
})

describe('templatePadrao', () => {
  it('é um percurso válido, pronto para editar', () => {
    const passos = templatePadrao()
    expect(() => validarTemplate(passos)).not.toThrow()
    expect(passos[passos.length - 1]?.codigo).toBe('ENTREGUE')
  })
})

describe('validarTemplate', () => {
  it('aceita um percurso com tentativas numeradas antes da entrega', () => {
    const passos = [
      passo('ETIQUETA_EMITIDA', 0),
      passo('POSTADO', 1),
      passo('SAIU_PARA_ENTREGA', 3),
      passo('TENTATIVA_ENTREGA_1', 4),
      passo('TENTATIVA_ENTREGA_2', 5),
      passo('ENTREGUE', 6),
    ]

    expect(() => validarTemplate(passos)).not.toThrow()
  })

  it('recusa template vazio', () => {
    expect(() => validarTemplate([])).toThrow(ValorInvalidoError)
  })

  it('recusa código fora da paleta', () => {
    expect(() => validarTemplate([passo('INVENTADO', 1)])).toThrow(/não existe na paleta/)
  })

  it('aceita o mesmo código repetido em dias diferentes', () => {
    // Um percurso real passa por várias transferências; repetir o tipo do nó
    // é o caso de uso, não um erro.
    expect(() =>
      validarTemplate([
        passo('POSTADO', 1),
        passo('TRANSFERENCIA', 2),
        passo('TRANSFERENCIA_FILIAL', 3),
        passo('TRANSFERENCIA', 4),
        passo('ENTREGUE', 6),
      ]),
    ).not.toThrow()
  })

  it('recusa dois nós idênticos: mesmo tipo, mesmo dia e mesmo texto', () => {
    // Repetir é legítimo; repetir sem nada que os diferencie produziria duas
    // linhas iguais na timeline, e quem acompanha não saberia o motivo.
    expect(() =>
      validarTemplate([passo('TRANSFERENCIA', 2), passo('TRANSFERENCIA', 2)]),
    ).toThrow(/idêntico ao passo 1/)
  })

  it('aceita o mesmo tipo no mesmo dia quando o texto difere', () => {
    const primeiro = { ...passo('TRANSFERENCIA', 2), titulo: 'Saiu de São Paulo' }
    const segundo = { ...passo('TRANSFERENCIA', 2), titulo: 'Chegou em Campinas' }
    expect(() => validarTemplate([primeiro, segundo])).not.toThrow()
  })

  it('recusa instâncias com o mesmo identificador', () => {
    const a = { ...passo('TRANSFERENCIA', 2), id: 'no-1' }
    const b = { ...passo('TRANSFERENCIA', 3), id: 'no-1' }
    expect(() => validarTemplate([a, b])).toThrow(/identificador de nó repetido/)
  })

  it('exige que um passo terminal seja o último, apontando qual', () => {
    expect(() =>
      validarTemplate([passo('ENTREGUE', 2), passo('SAIU_PARA_ENTREGA', 3)]),
    ).toThrow(/Passo 1.*encerra o envio e precisa ser o último/)
  })

  it('recusa devolvido no meio, que é a armadilha do template linear', () => {
    // O usuário pediu desvios dentro da mesma sequência. Devolvido encerra o
    // envio, então só faz sentido no fim — e a mensagem precisa dizer isso.
    expect(() =>
      validarTemplate([
        passo('POSTADO', 1),
        passo('DEVOLVIDO', 5),
        passo('ENTREGUE', 6),
      ]),
    ).toThrow(/encerra o envio/)
  })

  it('recusa passo que acontece antes do anterior', () => {
    expect(() =>
      validarTemplate([passo('POSTADO', 5), passo('SAIU_PARA_ENTREGA', 2)]),
    ).toThrow(/acontece antes do passo anterior/)
  })

  it('aceita dois passos no mesmo dia', () => {
    expect(() =>
      validarTemplate([passo('ETIQUETA_EMITIDA', 0), passo('POSTADO', 0)]),
    ).not.toThrow()
  })

  it('recusa dias fora da faixa', () => {
    for (const dias of [-1, 366, Number.NaN]) {
      expect(() => validarTemplate([passo('POSTADO', dias)])).toThrow(/dias após a emissão/)
    }
  })

  it('recusa título ou descrição vazios', () => {
    expect(() =>
      validarTemplate([{ codigo: 'POSTADO', titulo: '  ', descricao: 'x', diasAposEmissao: 1 }]),
    ).toThrow(/título e descrição/)
  })
})

describe('statusPorCodigoDoTemplate', () => {
  it('traduz as tentativas numeradas, que só existem no template', () => {
    const mapa = statusPorCodigoDoTemplate([
      passo('TENTATIVA_ENTREGA_1', 4),
      passo('ENTREGUE', 6),
    ])

    expect(mapa.TENTATIVA_ENTREGA_1).toBe('POSTED')
    expect(mapa.ENTREGUE).toBe('DELIVERED')
  })
})
