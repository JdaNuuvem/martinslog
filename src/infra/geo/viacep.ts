import { normalizarCep } from '@/domain/pricing/cep'
import { CepInvalidoError } from '@/domain/errors'
import { EnderecoCep, GeoProvider } from './provider'

interface ViaCepResponse {
  cep?: string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean
}

export class ViaCepProvider implements GeoProvider {
  constructor(private fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async buscarPorCep(cep: string): Promise<EnderecoCep> {
    try {
      const cepNormalizado = normalizarCep(cep)

      const response = await this.fetch(`https://viacep.com.br/ws/${cepNormalizado}/json/`)
      const data = (await response.json()) as ViaCepResponse

      if (data.erro) {
        throw new CepInvalidoError()
      }

      if (!data.cep || !data.logradouro || !data.bairro || !data.localidade || !data.uf) {
        throw new CepInvalidoError()
      }

      return {
        cep: data.cep.replace('-', ''),
        logradouro: data.logradouro,
        bairro: data.bairro,
        cidade: data.localidade,
        uf: data.uf,
      }
    } catch (error) {
      if (error instanceof CepInvalidoError) {
        throw error
      }
      throw new CepInvalidoError()
    }
  }
}
