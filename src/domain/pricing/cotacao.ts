import { calcularPesoCubadoG, calcularPesoTaxavelG } from './cubagem'
import { selecionarRegra, montarOpcao, RegraTarifa, OpcaoPreco } from './tarifa'

export type EntradaCotacao = {
  cepOrigem: string
  cepDestino: string
  pesoRealG: number
  alturaCm: number
  larguraCm: number
  comprimentoCm: number
}

export type ItemCatalogo = {
  servico: { id: string; nome: string; carrierNome: string; limitePesoG: number }
  regras: RegraTarifa[]
}

export type OpcaoCotacao = OpcaoPreco & {
  servicoId: string
  servicoNome: string
  carrierNome: string
  disponivel: boolean
  observacao: string | null
}

export type ResultadoCotacao = {
  pesoCubadoG: number
  pesoTaxavelG: number
  opcoes: OpcaoCotacao[]
}

export function cotar(entrada: EntradaCotacao, catalogo: ItemCatalogo[]): ResultadoCotacao {
  const pesoCubadoG = calcularPesoCubadoG({
    alturaCm: entrada.alturaCm,
    larguraCm: entrada.larguraCm,
    comprimentoCm: entrada.comprimentoCm,
  })
  const pesoTaxavelG = calcularPesoTaxavelG(entrada.pesoRealG, pesoCubadoG)

  const opcoes = catalogo.map((item): OpcaoCotacao => {
    const { servico, regras } = item

    if (pesoTaxavelG > servico.limitePesoG) {
      return {
        precoBalcaoCentavos: 0,
        precoFinalCentavos: 0,
        descontoCentavos: 0,
        descontoPercentual: 0,
        prazoDias: 0,
        servicoId: servico.id,
        servicoNome: servico.nome,
        carrierNome: servico.carrierNome,
        disponivel: false,
        observacao: `Peso taxável de ${pesoTaxavelG}g excede o limite de ${servico.limitePesoG}g deste serviço.`,
      }
    }

    const regra = selecionarRegra(regras, {
      cepOrigem: entrada.cepOrigem,
      cepDestino: entrada.cepDestino,
      pesoTaxavelG,
    })

    if (!regra) {
      return {
        precoBalcaoCentavos: 0,
        precoFinalCentavos: 0,
        descontoCentavos: 0,
        descontoPercentual: 0,
        prazoDias: 0,
        servicoId: servico.id,
        servicoNome: servico.nome,
        carrierNome: servico.carrierNome,
        disponivel: false,
        observacao: 'Este serviço não atende a rota informada.',
      }
    }

    const opcaoPreco = montarOpcao(regra)

    return {
      ...opcaoPreco,
      servicoId: servico.id,
      servicoNome: servico.nome,
      carrierNome: servico.carrierNome,
      disponivel: true,
      observacao: null,
    }
  })

  const disponiveis = opcoes
    .filter((o) => o.disponivel)
    .sort((a, b) => a.precoFinalCentavos - b.precoFinalCentavos)
  const indisponiveis = opcoes.filter((o) => !o.disponivel)

  return { pesoCubadoG, pesoTaxavelG, opcoes: [...disponiveis, ...indisponiveis] }
}
