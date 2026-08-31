import { EnderecoCep, GeoProvider } from './provider'

export class FakeGeoProvider implements GeoProvider {
  async buscarPorCep(): Promise<EnderecoCep> {
    return {
      cep: '01001000',
      logradouro: 'Praça da Sé',
      bairro: 'Sé',
      cidade: 'São Paulo',
      uf: 'SP',
    }
  }
}
