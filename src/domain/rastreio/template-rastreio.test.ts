import { describe, expect, it } from 'vitest'
import { ValorInvalidoError } from '../errors'
import {
  PALETA,
  diasAcumulados,
  gerarRoteiroDeTemplate,
  itemDaPaleta,
  normalizarDias,
  ordenarPorConexoes,
  statusPorCodigoDoTemplate,
  templatePadrao,
  validarTemplate,
  type PassoTemplate,
} from './template-rastreio'

/** Passo com o intervalo, em dias, desde a etapa anterior do percurso. */
function passo(codigo: string, diasAposAnterior: number): PassoTemplate {
  const item = itemDaPaleta(codigo)
  return {
    codigo,
    titulo: item?.rotulo ?? codigo,
    descricao: item?.descricaoPadrao ?? 'x',
    diasAposAnterior,
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
      validarTemplate([passo('TRANSFERENCIA', 2), passo('TRANSFERENCIA', 0)]),
    ).toThrow(/idêntico ao passo 1/)
  })

  it('aceita o mesmo tipo no mesmo dia quando o texto difere', () => {
    const primeiro = { ...passo('TRANSFERENCIA', 2), titulo: 'Saiu de São Paulo' }
    const segundo = { ...passo('TRANSFERENCIA', 0), titulo: 'Chegou em Campinas' }
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

  it('não tem como um passo cair antes do anterior — o intervalo é sempre para a frente', () => {
    // A regra antiga existia porque cada passo trazia um dia absoluto e nada
    // impedia o segundo de ser menor que o primeiro. Com intervalos, o
    // percurso só anda para a frente por construção.
    const passos = [passo('POSTADO', 5), passo('SAIU_PARA_ENTREGA', 2)]

    expect(() => validarTemplate(passos)).not.toThrow()
    expect(diasAcumulados(passos)).toEqual([5, 7])
  })

  it('aceita dois passos no mesmo dia — intervalo zero', () => {
    expect(() =>
      validarTemplate([passo('ETIQUETA_EMITIDA', 0), passo('POSTADO', 0)]),
    ).not.toThrow()
  })

  it('recusa intervalos fora da faixa', () => {
    for (const dias of [-1, 366, Number.NaN]) {
      expect(() => validarTemplate([passo('POSTADO', dias)])).toThrow(/intervalo até a etapa anterior/)
    }
  })

  it('recusa um percurso cuja soma passa do teto, ainda que cada intervalo caiba', () => {
    expect(() =>
      validarTemplate([passo('POSTADO', 300), passo('SAIU_PARA_ENTREGA', 100)]),
    ).toThrow(/passa de 365 dias no total/)
  })

  it('recusa título ou descrição vazios', () => {
    expect(() =>
      validarTemplate([{ codigo: 'POSTADO', titulo: '  ', descricao: 'x', diasAposAnterior: 1 }]),
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

describe('ordenarPorConexoes', () => {
  function comId(id: string, codigo: string, dias: number): PassoTemplate {
    return { ...passo(codigo, dias), id }
  }

  it('sem conexões, mantém a ordem do array', () => {
    const passos = [comId('a', 'POSTADO', 1), comId('b', 'ENTREGUE', 5)]
    expect(ordenarPorConexoes(passos, []).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('segue as setas, e não a ordem em que os nós foram criados', () => {
    // O nó "b" foi criado antes, mas a seta diz que ele vem depois.
    const passos = [comId('b', 'ENTREGUE', 5), comId('a', 'POSTADO', 1)]
    const conexoes = [{ de: 'a', para: 'b' }]

    expect(ordenarPorConexoes(passos, conexoes).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('resolve empate de conexão pela ordem em que os nós foram criados', () => {
    /*
      Dois ramos saindo do mesmo nó: nada nas setas diz qual vem primeiro.
      O desempate era pelo dia, quando o número do passo era o total desde a
      emissão. Agora ele é o intervalo até o anterior — e o intervalo de um nó
      só significa alguma coisa depois de já se saber a ordem, então usá-lo
      para decidir a ordem seria circular. Vale a ordem de criação.
    */
    const passos = [
      comId('raiz', 'ETIQUETA_EMITIDA', 0),
      comId('primeiro-criado', 'TRANSFERENCIA', 5),
      comId('segundo-criado', 'POSTADO', 1),
    ]
    const conexoes = [
      { de: 'raiz', para: 'primeiro-criado' },
      { de: 'raiz', para: 'segundo-criado' },
    ]

    expect(ordenarPorConexoes(passos, conexoes).map((p) => p.id)).toEqual([
      'raiz',
      'primeiro-criado',
      'segundo-criado',
    ])
  })

  it('inclui nó solto, posicionado pelo dia', () => {
    const passos = [
      comId('a', 'POSTADO', 1),
      comId('solto', 'TRANSFERENCIA', 2),
      comId('b', 'ENTREGUE', 5),
    ]
    const conexoes = [{ de: 'a', para: 'b' }]

    const ordem = ordenarPorConexoes(passos, conexoes).map((p) => p.id)
    expect(ordem).toHaveLength(3)
    expect(ordem).toContain('solto')
  })

  it('recusa ciclo em vez de produzir uma ordem arbitrária', () => {
    const passos = [comId('a', 'POSTADO', 1), comId('b', 'TRANSFERENCIA', 2)]
    const conexoes = [
      { de: 'a', para: 'b' },
      { de: 'b', para: 'a' },
    ]

    expect(() => ordenarPorConexoes(passos, conexoes)).toThrow(/ciclo/)
  })

  it('ignora conexão que aponta para nó inexistente, em vez de quebrar', () => {
    const passos = [comId('a', 'POSTADO', 1)]
    const conexoes = [{ de: 'a', para: 'apagado' }]

    expect(ordenarPorConexoes(passos, conexoes).map((p) => p.id)).toEqual(['a'])
  })
})

describe('dias entre etapas', () => {
  const origem = { cidade: 'São Paulo', uf: 'SP' }
  const destino = { cidade: 'Rio de Janeiro', uf: 'RJ' }

  it('soma o intervalo de cada etapa à anterior, e não à emissão', () => {
    const passos = [
      passo('ETIQUETA_EMITIDA', 0),
      passo('POSTADO', 1),
      passo('TRANSFERENCIA', 2),
      passo('ENTREGUE', 3),
    ]

    expect(diasAcumulados(passos)).toEqual([0, 1, 3, 6])
  })

  it('leva o acumulado para o offset do roteiro', () => {
    const roteiro = gerarRoteiroDeTemplate(
      [passo('POSTADO', 1), passo('TRANSFERENCIA', 2), passo('ENTREGUE', 3)],
      origem,
      destino,
    )

    // 1 dia, depois mais 2 (=3), depois mais 3 (=6) — em minutos.
    expect(roteiro.map((evento) => evento.offsetMinutos)).toEqual([1440, 4320, 8640])
  })

  it('mover um intervalo no meio empurra só o que vem depois', () => {
    const antes = [passo('POSTADO', 1), passo('TRANSFERENCIA', 2), passo('ENTREGUE', 3)]
    const depois = [passo('POSTADO', 1), passo('TRANSFERENCIA', 5), passo('ENTREGUE', 3)]

    expect(diasAcumulados(antes)).toEqual([1, 3, 6])
    expect(diasAcumulados(depois)).toEqual([1, 6, 9])
  })

  it('converte template antigo, que guardava o total desde a emissão', () => {
    const legado: PassoTemplate[] = [
      { codigo: 'POSTADO', titulo: 'Postado', descricao: 'x', diasAposEmissao: 1 },
      { codigo: 'TRANSFERENCIA', titulo: 'Trânsito', descricao: 'x', diasAposEmissao: 3 },
      { codigo: 'ENTREGUE', titulo: 'Entregue', descricao: 'x', diasAposEmissao: 6 },
    ] as unknown as PassoTemplate[]

    const convertido = normalizarDias(legado)

    expect(convertido.map((p) => p.diasAposAnterior)).toEqual([1, 2, 3])
    // O que importa: os dias em que os eventos caem não mudam na conversão.
    expect(diasAcumulados(convertido)).toEqual([1, 3, 6])
  })

  it('converter é idempotente: passo já convertido não é mexido de novo', () => {
    const passos = [passo('POSTADO', 1), passo('ENTREGUE', 2)]

    expect(normalizarDias(normalizarDias(passos))).toEqual(normalizarDias(passos))
  })
})
