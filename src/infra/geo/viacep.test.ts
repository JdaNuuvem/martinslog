import { describe, expect, it, vi } from 'vitest'
import { ViaCepProvider } from './viacep'
import { CepInvalidoError } from '@/domain/errors'

describe('ViaCepProvider', () => {
  it('mapeia a resposta do ViaCEP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé',
        localidade: 'São Paulo', uf: 'SP',
      }),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    const endereco = await provider.buscarPorCep('01001-000')
    expect(endereco).toEqual({
      cep: '01001000', logradouro: 'Praça da Sé', bairro: 'Sé',
      cidade: 'São Paulo', uf: 'SP',
    })
  })

  it('lança CepInvalidoError quando o ViaCEP responde erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('99999999')).rejects.toThrow(CepInvalidoError)
  })

  it('lança CepInvalidoError quando a rede falha', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'))
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(CepInvalidoError)
  })
})
