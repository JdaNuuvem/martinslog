import { describe, expect, it } from 'vitest'
import { cotar } from './cotacao'

const catalogo = [
  {
    servico: { id: 'eco', nome: 'Econômico', carrierNome: 'Própria', limitePesoG: 30000 },
    regras: [{
      serviceId: 'eco',
      cepOrigemIni: 1000000, cepOrigemFim: 19999999,
      cepDestinoIni: 20000000, cepDestinoFim: 28999999,
      pesoMinG: 0, pesoMaxG: 300,
      precoBalcaoCentavos: 2750, precoVendaCentavos: 1416, prazoDias: 5,
    }],
  },
  {
    servico: { id: 'mini', nome: 'Mini', carrierNome: 'Própria', limitePesoG: 300 },
    regras: [{
      serviceId: 'mini',
      cepOrigemIni: 1000000, cepOrigemFim: 19999999,
      cepDestinoIni: 20000000, cepDestinoFim: 28999999,
      pesoMinG: 0, pesoMaxG: 300,
      precoBalcaoCentavos: 2750, precoVendaCentavos: 943, prazoDias: 5,
    }],
  },
]

const entrada = {
  cepOrigem: '01001000', cepDestino: '20040002',
  pesoRealG: 300, alturaCm: 4, larguraCm: 12, comprimentoCm: 18,
}

describe('cotar', () => {
  it('ordena da opção mais barata para a mais cara', () => {
    const r = cotar(entrada, catalogo)
    expect(r.opcoes.map((o) => o.servicoId)).toEqual(['mini', 'eco'])
  })

  it('calcula o peso taxável', () => {
    const r = cotar(entrada, catalogo)
    expect(r.pesoCubadoG).toBe(144)
    expect(r.pesoTaxavelG).toBe(300)
  })

  it('mantém na lista o serviço que excede o limite, marcado como indisponível', () => {
    const r = cotar({ ...entrada, pesoRealG: 500 }, catalogo)
    const mini = r.opcoes.find((o) => o.servicoId === 'mini')!
    expect(mini.disponivel).toBe(false)
    expect(mini.observacao).toContain('300')
  })

  it('mantém na lista o serviço cuja regra não cobre a rota, sem sumir', () => {
    const r = cotar({ ...entrada, cepDestino: '99999000' }, catalogo)
    expect(r.opcoes).toHaveLength(2)
    for (const opcao of r.opcoes) {
      expect(opcao.disponivel).toBe(false)
      expect(opcao.observacao).toBeTruthy()
    }
  })
})
