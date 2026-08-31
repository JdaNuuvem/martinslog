import { describe, expect, it, vi } from 'vitest'
import { ViaCepProvider } from './viacep'
import { CepInvalidoError, ServicoIndisponivelError } from '@/domain/errors'

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

  it('lança ServicoIndisponivelError quando a rede falha', async () => {
    const networkError = new Error('network failed')
    const fetchMock = vi.fn().mockRejectedValue(networkError)
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    try {
      await provider.buscarPorCep('01001000')
    } catch (e) {
      expect(e).toBeInstanceOf(ServicoIndisponivelError)
      expect((e as ServicoIndisponivelError).cause).toBe(networkError)
    }
  })

  it('lança ServicoIndisponivelError com HTTP 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(ServicoIndisponivelError)
  })

  it('lança ServicoIndisponivelError com HTTP 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(ServicoIndisponivelError)
  })

  it('lança ServicoIndisponivelError quando corpo é {} (contrato quebrado)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(ServicoIndisponivelError)
  })

  it('lança CepInvalidoError quando erro é string "true"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ erro: 'true' }),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(CepInvalidoError)
  })

  it('lança CepInvalidoError quando erro é booleano true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ erro: true }),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('01001000')).rejects.toThrow(CepInvalidoError)
  })

  it('lança CepInvalidoError quando CEP é malformado e não faz fetch', async () => {
    const fetchMock = vi.fn()
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)
    await expect(provider.buscarPorCep('invalid')).rejects.toThrow(CepInvalidoError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
