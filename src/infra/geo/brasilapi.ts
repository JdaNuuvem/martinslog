import { normalizarCep } from '@/domain/pricing/cep'
import { CepInvalidoError, ServicoIndisponivelError, DomainError } from '@/domain/errors'
import { EnderecoCep, GeoProvider } from './provider'

/**
 * Segunda fonte de CEP: a BrasilAPI, que consulta vários serviços de uma vez.
 *
 * Existe porque o ViaCEP tem um buraco sistemático: ele não carrega o **CEP
 * geral de município** — aquele terminado em `-000` que toda cidade pequena
 * usa. Medido em produção: de catorze cotações recusadas por "CEP não
 * encontrado", quatro eram CEPs reais (Casa Branca/SP, Arcos/MG,
 * Cassilândia/MS, Antonina/PR). Cada uma era uma venda paga que nunca virou
 * etiqueta.
 *
 * Não substitui o ViaCEP: complementa. O ViaCEP devolve logradouro e bairro,
 * que a BrasilAPI deixa nulos justamente nesses CEPs de cidade inteira.
 */

interface RespostaBrasilApi {
  cep?: string
  state?: string
  city?: string
  neighborhood?: string | null
  street?: string | null
  /** Presente apenas nas respostas de erro. */
  name?: string
  message?: string
}

const TIMEOUT_PADRAO_MS = 5_000

export class BrasilApiProvider implements GeoProvider {
  constructor(
    private fetch: typeof globalThis.fetch = globalThis.fetch,
    private readonly timeoutMs: number = TIMEOUT_PADRAO_MS,
  ) {}

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    const cepNormalizado = normalizarCep(cep)

    try {
      const resposta = await this.fetch(
        `https://brasilapi.com.br/api/cep/v2/${cepNormalizado}`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      )

      /*
        404 é a resposta de "não achei em nenhum serviço" — CEP inexistente,
        não indisponibilidade. Qualquer outro status fora da faixa de sucesso
        é problema deles, e problema deles nunca pode virar "esse CEP não
        existe" na cara do lojista.
      */
      if (resposta.status === 404) {
        throw new CepInvalidoError('CEP não encontrado.')
      }
      if (!resposta.ok) {
        throw new ServicoIndisponivelError(`BrasilAPI indisponível (HTTP ${resposta.status})`)
      }

      const dados = (await resposta.json()) as RespostaBrasilApi

      if (!dados.cep || !dados.city || !dados.state) {
        throw new ServicoIndisponivelError('Resposta da BrasilAPI com campos faltando')
      }

      /*
        Logradouro e bairro vazios são o caso NORMAL aqui, não um defeito: num
        CEP que cobre a cidade inteira não existe rua. Recusar por isso jogaria
        fora exatamente o caso que esta fonte veio resolver — quem preenche a
        rua é o formulário da loja, não a consulta.
      */
      return {
        cep: normalizarCep(dados.cep),
        logradouro: dados.street ?? '',
        bairro: dados.neighborhood ?? '',
        cidade: dados.city,
        uf: dados.state,
      }
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new ServicoIndisponivelError('Erro ao buscar endereço na BrasilAPI', { cause: error })
    }
  }
}
