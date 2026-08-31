import { describe, expect, it } from 'vitest'
import { montarOpcao, selecionarRegra, type RegraTarifa } from './tarifa'

const regraSpRj: RegraTarifa = {
  serviceId: 'pac',
  cepOrigemIni: 1000000, cepOrigemFim: 19999999,
  cepDestinoIni: 20000000, cepDestinoFim: 28999999,
  pesoMinG: 0, pesoMaxG: 300,
  precoBalcaoCentavos: 2750, precoVendaCentavos: 1416, prazoDias: 5,
}

const regraSpRjPesada: RegraTarifa = {
  ...regraSpRj, pesoMinG: 301, pesoMaxG: 1000,
  precoBalcaoCentavos: 3500, precoVendaCentavos: 1900,
}

describe('selecionarRegra', () => {
  const regras = [regraSpRj, regraSpRjPesada]

  it('escolhe a regra da faixa de peso correta', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 300 })
    expect(r).toBe(regraSpRj)
  })

  it('escolhe a faixa seguinte quando o peso ultrapassa', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 301 })
    expect(r).toBe(regraSpRjPesada)
  })

  it('devolve null quando a rota não é atendida', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '90000000', pesoTaxavelG: 300 })
    expect(r).toBeNull()
  })

  it('devolve null quando o peso excede todas as faixas', () => {
    const r = selecionarRegra(regras, { cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 5000 })
    expect(r).toBeNull()
  })

  it('escolhe a regra mais barata quando duas cobrem o mesmo caso', () => {
    const maisBarata: RegraTarifa = { ...regraSpRj, serviceId: 'promo', precoVendaCentavos: 1200 }
    const r = selecionarRegra([regraSpRj, maisBarata], {
      cepOrigem: '01001000', cepDestino: '20040002', pesoTaxavelG: 300,
    })
    expect(r).toBe(maisBarata)
  })
})

describe('montarOpcao', () => {
  it('calcula desconto em valor e percentual', () => {
    const opcao = montarOpcao(regraSpRj)
    expect(opcao.precoFinalCentavos).toBe(1416)
    expect(opcao.descontoCentavos).toBe(1334)
    expect(opcao.descontoPercentual).toBe(49) // 1334/2750 = 48,5% -> 49
  })

  it('não gera desconto negativo quando a venda é mais cara que o balcão', () => {
    const opcao = montarOpcao({ ...regraSpRj, precoVendaCentavos: 3000 })
    expect(opcao.descontoCentavos).toBe(0)
    expect(opcao.descontoPercentual).toBe(0)
  })
})
