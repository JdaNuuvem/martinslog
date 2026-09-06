import { CepInvalidoError } from '@/domain/errors'
import { EnderecoCep, GeoProvider } from './provider'

/**
 * Duas fontes de CEP, uma decisão.
 *
 * A regra é curta e vale a pena ler inteira, porque cada ramo custa dinheiro
 * de um jeito diferente:
 *
 *  - **A primeira fonte achou** → devolve. A reserva nem é consultada.
 *  - **A primeira disse que não existe** → PERGUNTA À RESERVA antes de
 *    acreditar. É o caso que motivou tudo isto: o ViaCEP não carrega o CEP
 *    geral de município, e um comprador de cidade pequena tinha a venda
 *    recusada com "CEP não encontrado" para um CEP perfeitamente válido.
 *  - **A primeira estava fora do ar** → tenta a reserva. Se ela responder,
 *    ótimo; a indisponibilidade de um fornecedor deixa de ser problema do
 *    lojista.
 *  - **As duas dizem que não existe** → aí sim, não existe.
 *  - **A primeira disse que não existe e a reserva não respondeu** → mantém a
 *    recusa. Uma fonte afirmou positivamente que o CEP não existe; deixar
 *    passar geraria etiqueta para um endereço inexistente, que é pior do que
 *    recusar — a recusa aparece na lista de erros e alguém conserta.
 *  - **As duas fora do ar** → indisponibilidade, que a cotação trata como
 *    "pula a validação" em vez de recusar.
 */
export class GeoComReserva implements GeoProvider {
  constructor(
    private readonly principal: GeoProvider,
    private readonly reserva: GeoProvider,
  ) {}

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    try {
      return await this.principal.buscarPorCep(cep)
    } catch (erroPrincipal) {
      /*
        Formato inválido (`normalizarCep`) também chega como CepInvalidoError.
        Consultar a reserva com um texto que não é CEP só gastaria uma ida à
        rede para receber a mesma recusa — mas distinguir os dois casos aqui
        exigiria um erro próprio, e o custo de uma consulta a mais é menor que
        o de um caminho especial mal testado. Vai para a reserva.
      */
      try {
        return await this.reserva.buscarPorCep(cep)
      } catch (erroReserva) {
        // A reserva também recusou de forma positiva: as duas fontes negam.
        if (erroReserva instanceof CepInvalidoError) throw erroReserva

        // A reserva não respondeu. Vale o veredito da principal, seja ele
        // "não existe" (recusa) ou "não respondeu" (pula a validação).
        throw erroPrincipal
      }
    }
  }
}
