export type EnderecoCep = {
  cep: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

export interface GeoProvider {
  buscarPorCep(cep: string): Promise<EnderecoCep>
}
