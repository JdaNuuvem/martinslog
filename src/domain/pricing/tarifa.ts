import { cepParaNumero } from './cep'

export type RegraTarifa = {
  serviceId: string
  cepOrigemIni: number
  cepOrigemFim: number
  cepDestinoIni: number
  cepDestinoFim: number
  pesoMinG: number
  pesoMaxG: number
  precoBalcaoCentavos: number
  precoVendaCentavos: number
  prazoDias: number
}

export type CriterioTarifa = { cepOrigem: string; cepDestino: string; pesoTaxavelG: number }

export type OpcaoPreco = {
  precoBalcaoCentavos: number
  precoFinalCentavos: number
  descontoCentavos: number
  descontoPercentual: number
  prazoDias: number
}

export function selecionarRegra(regras: RegraTarifa[], criterio: CriterioTarifa): RegraTarifa | null {
  const origem = cepParaNumero(criterio.cepOrigem)
  const destino = cepParaNumero(criterio.cepDestino)

  const candidatas = regras.filter(
    (r) =>
      origem >= r.cepOrigemIni && origem <= r.cepOrigemFim &&
      destino >= r.cepDestinoIni && destino <= r.cepDestinoFim &&
      criterio.pesoTaxavelG >= r.pesoMinG && criterio.pesoTaxavelG <= r.pesoMaxG,
  )

  if (candidatas.length === 0) return null

  return candidatas.reduce((melhor, atual) =>
    atual.precoVendaCentavos < melhor.precoVendaCentavos ? atual : melhor,
  )
}

export function montarOpcao(regra: RegraTarifa): OpcaoPreco {
  const desconto = Math.max(0, regra.precoBalcaoCentavos - regra.precoVendaCentavos)
  const percentual = regra.precoBalcaoCentavos === 0
    ? 0
    : Math.round((desconto / regra.precoBalcaoCentavos) * 100)

  return {
    precoBalcaoCentavos: regra.precoBalcaoCentavos,
    precoFinalCentavos: regra.precoVendaCentavos,
    descontoCentavos: desconto,
    descontoPercentual: percentual,
    prazoDias: regra.prazoDias,
  }
}
