import { normalizarCep } from '@/domain/pricing/cep'
import { CepInvalidoError, ServicoIndisponivelError, DomainError } from '@/domain/errors'
import { EnderecoCep, GeoProvider } from './provider'

interface ViaCepResponse {
  cep?: string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean | string
}

/** Ajustes de cache e tempo limite. Todos têm padrão; nada é obrigatório. */
export type OpcoesViaCep = {
  /** Validade de uma entrada de cache. Padrão: 24h. */
  ttlMs?: number
  /** Teto de CEPs guardados, para o cache não virar vazamento. Padrão: 500. */
  maxEntradas?: number
  /** Tempo limite de cada requisição ao ViaCEP. Padrão: 5s. */
  timeoutMs?: number
  /** Fonte de tempo, trocável no teste para não depender de espera real. */
  relogio?: () => number
}

/** Dado de CEP é praticamente estático; um dia é conservador e já evita a maior parte das chamadas. */
const TTL_PADRAO_MS = 24 * 60 * 60 * 1000
const MAX_ENTRADAS_PADRAO = 500
const TIMEOUT_PADRAO_MS = 5_000

type EntradaCache = { endereco: EnderecoCep; expiraEm: number }

export class ViaCepProvider implements GeoProvider {
  private readonly cache = new Map<string, EntradaCache>()
  private readonly ttlMs: number
  private readonly maxEntradas: number
  private readonly timeoutMs: number
  private readonly relogio: () => number

  constructor(
    private fetch: typeof globalThis.fetch = globalThis.fetch,
    opcoes: OpcoesViaCep = {},
  ) {
    this.ttlMs = opcoes.ttlMs ?? TTL_PADRAO_MS
    this.maxEntradas = opcoes.maxEntradas ?? MAX_ENTRADAS_PADRAO
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
    this.relogio = opcoes.relogio ?? Date.now
  }

  /**
   * Lê do cache, descartando a entrada se já venceu. A chave é o CEP
   * normalizado, então `01001-000`, `01001000` e ` 01001-000 ` são o mesmo.
   */
  private lerDoCache(cepNormalizado: string): EnderecoCep | null {
    const entrada = this.cache.get(cepNormalizado)
    if (!entrada) return null

    if (entrada.expiraEm <= this.relogio()) {
      this.cache.delete(cepNormalizado)
      return null
    }

    return entrada.endereco
  }

  /**
   * Guarda **apenas resultados bem-sucedidos**.
   *
   * Nem `ServicoIndisponivelError` nem `CepInvalidoError` entram aqui: um
   * soluço de rede de um segundo viraria erro grudado pelo resto do TTL, e
   * uma resposta ruim do ViaCEP fixaria "esse CEP não existe" para um CEP
   * que existe. Errar para o lado de consultar de novo é mais barato que
   * errar para o lado de mentir.
   *
   * Ao encher, descarta a entrada inserida há mais tempo — `Map` preserva a
   * ordem de inserção, então a primeira chave é a mais antiga.
   */
  private guardarNoCache(cepNormalizado: string, endereco: EnderecoCep): void {
    if (this.cache.size >= this.maxEntradas) {
      const maisAntiga = this.cache.keys().next().value
      if (maisAntiga !== undefined) {
        this.cache.delete(maisAntiga)
      }
    }

    this.cache.set(cepNormalizado, { endereco, expiraEm: this.relogio() + this.ttlMs })
  }

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    // normalizarCep lança CepInvalidoError se formato inválido — deixar propagar
    const cepNormalizado = normalizarCep(cep)

    const emCache = this.lerDoCache(cepNormalizado)
    if (emCache) {
      return emCache
    }

    try {
      // O tempo limite existe para o caso pior: o ViaCEP aceita a conexão e
      // nunca responde. Sem ele, a requisição do usuário fica pendurada até
      // o timeout do runtime, segurando conexão à toa numa rota que dispara
      // a cada CEP digitado no formulário.
      const response = await this.fetch(`https://viacep.com.br/ws/${cepNormalizado}/json/`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      // Verificar status HTTP
      if (!response.ok) {
        throw new ServicoIndisponivelError(`Serviço indisponível (HTTP ${response.status})`)
      }

      const data = (await response.json()) as ViaCepResponse

      // Verificar se ViaCEP retornou erro (CEP não existe)
      if (data.erro) {
        throw new CepInvalidoError('CEP não encontrado.')
      }

      // Verificar se todos os campos obrigatórios estão presentes
      if (!data.cep || !data.logradouro || !data.bairro || !data.localidade || !data.uf) {
        throw new ServicoIndisponivelError('Resposta do ViaCEP com campos faltando')
      }

      // Normalizar CEP de retorno (remove hífen se houver)
      const cepRetorno = normalizarCep(data.cep)

      const endereco: EnderecoCep = {
        cep: cepRetorno,
        logradouro: data.logradouro,
        bairro: data.bairro,
        cidade: data.localidade,
        uf: data.uf,
      }

      this.guardarNoCache(cepNormalizado, endereco)
      return endereco
    } catch (error) {
      // Se já é DomainError, repasse como está
      if (error instanceof DomainError) {
        throw error
      }

      // Qualquer outra exceção (rede, JSON parsing, tempo limite estourado)
      // vira ServicoIndisponivelError com a causa preservada. Nunca
      // CepInvalidoError: dizer "CEP inválido" quando o serviço não
      // respondeu faz o usuário reconferir um CEP que estava certo.
      throw new ServicoIndisponivelError('Erro ao buscar endereço do ViaCEP', { cause: error })
    }
  }
}
