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

export class ViaCepProvider implements GeoProvider {
  constructor(private fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    // normalizarCep lança CepInvalidoError se formato inválido — deixar propagar
    const cepNormalizado = normalizarCep(cep)

    try {
      const response = await this.fetch(`https://viacep.com.br/ws/${cepNormalizado}/json/`)

      // Verificar status HTTP
      if (!response.ok) {
        throw new ServicoIndisponivelError(`Serviço indisponível (HTTP ${response.status})`)
      }

      const data = (await response.json()) as ViaCepResponse

      // Verificar se ViaCEP retornou erro (CEP não existe)
      if (data.erro) {
        throw new CepInvalidoError()
      }

      // Verificar se todos os campos obrigatórios estão presentes
      if (!data.cep || !data.logradouro || !data.bairro || !data.localidade || !data.uf) {
        throw new ServicoIndisponivelError('Resposta do ViaCEP com campos faltando')
      }

      // Normalizar CEP de retorno (remove hífen se houver)
      const cepRetorno = normalizarCep(data.cep)

      return {
        cep: cepRetorno,
        logradouro: data.logradouro,
        bairro: data.bairro,
        cidade: data.localidade,
        uf: data.uf,
      }
    } catch (error) {
      // Se já é DomainError, repasse como está
      if (error instanceof DomainError) {
        throw error
      }

      // Qualquer outra exceção (rede, JSON parsing, etc) vira ServicoIndisponivelError com cause
      throw new ServicoIndisponivelError('Erro ao buscar endereço do ViaCEP', { cause: error })
    }
  }
}
