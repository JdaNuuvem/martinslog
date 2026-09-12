import { CepInvalidoError, ServicoIndisponivelError } from '@/domain/errors'
import { EnderecoCep, GeoProvider } from './provider'

/**
 * Duas fontes de CEP, uma decisão.
 *
 * A regra é curta e vale a pena ler inteira, porque cada ramo custa dinheiro
 * de um jeito diferente:
 *
 *  - **A primeira fonte achou** → devolve. A reserva nem é consultada.
 *  - **A reserva achou** → devolve. É o caso que motivou tudo isto: o ViaCEP
 *    não carrega o CEP geral de município, e um comprador de cidade pequena
 *    tinha a venda recusada com "CEP não encontrado" para um CEP válido.
 *  - **As duas negam** → aí sim, não existe. Recusa.
 *  - **A primeira não respondeu** → nunca recusa, aconteça o que acontecer com
 *    a reserva. Vira indisponibilidade, que a cotação trata pulando a
 *    validação em vez de barrar a venda.
 *
 * O último ramo é o que mudou, e o motivo importa. Antes, uma negativa da
 * RESERVA SOZINHA bastava para recusar — e é justamente o cenário em que ela
 * erra mais: com o ViaCEP fora do ar, toda venda cujo CEP a BrasilAPI não
 * conhece seria barrada de uma vez só, em escala, que é exatamente o que a
 * segunda fonte veio evitar.
 *
 * A assimetria é deliberada: recusar CEP bom é venda paga sem etiqueta, com o
 * erro à vista e alguém para consertar; deixar passar CEP ruim é uma encomenda
 * perdida. O primeiro é recuperável, e é o único que acontece em lote quando
 * um fornecedor cai.
 */
export class GeoComReserva implements GeoProvider {
  constructor(
    private readonly principal: GeoProvider,
    private readonly reserva: GeoProvider,
  ) {}

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    let erroPrincipal: unknown

    try {
      return await this.principal.buscarPorCep(cep)
    } catch (erro) {
      erroPrincipal = erro
    }

    /*
      Formato inválido (`normalizarCep`) também chega como CepInvalidoError.
      Consultar a reserva com um texto que não é CEP só gasta uma ida à rede
      para receber a mesma recusa — mas distinguir os dois casos exigiria um
      erro próprio, e o custo de uma consulta a mais é menor que o de um
      caminho especial mal testado.
    */
    try {
      return await this.reserva.buscarPorCep(cep)
    } catch (erroReserva) {
      const principalNegou = erroPrincipal instanceof CepInvalidoError
      const reservaNegou = erroReserva instanceof CepInvalidoError

      if (principalNegou && reservaNegou) {
        throw erroReserva
      }

      if (principalNegou) {
        // A primeira afirmou que não existe e a reserva não respondeu. Uma
        // negativa positiva basta para recusar — e a recusa aparece na lista
        // de erros, onde alguém conserta o endereço.
        throw erroPrincipal
      }

      /*
        A primeira não respondeu. Não importa o que a reserva disse: sem a
        fonte principal, não há base para afirmar que o CEP não existe. Vira
        indisponibilidade, e a cotação segue sem a validação.
      */
      throw new ServicoIndisponivelError(
        'Nenhuma fonte de CEP respondeu de forma conclusiva.',
        { cause: erroPrincipal },
      )
    }
  }
}
