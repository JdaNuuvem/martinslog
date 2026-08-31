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

describe('ViaCepProvider — cache', () => {
  function respostaOk() {
    return {
      ok: true,
      json: async () => ({
        cep: '01001-000',
        logradouro: 'Praça da Sé',
        bairro: 'Sé',
        localidade: 'São Paulo',
        uf: 'SP',
      }),
    }
  }

  it('não chama o ViaCEP de novo para um CEP já buscado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk())
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)

    const primeiro = await provider.buscarPorCep('01001-000')
    const segundo = await provider.buscarPorCep('01001000')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(segundo).toEqual(primeiro)
  })

  it('trata CEP formatado e sem formatação como a mesma chave', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk())
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)

    await provider.buscarPorCep('01001-000')
    await provider.buscarPorCep('01001000')
    await provider.buscarPorCep(' 01001-000 ')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('busca de novo depois que a entrada expira', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk())
    let agora = 1_000_000
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch, {
      ttlMs: 60_000,
      relogio: () => agora,
    })

    await provider.buscarPorCep('01001000')
    agora += 59_000
    await provider.buscarPorCep('01001000')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    agora += 2_000
    await provider.buscarPorCep('01001000')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('não guarda falha de serviço em cache', async () => {
    // Uma indisponibilidade de um segundo não pode virar erro grudado pelo
    // resto do TTL: a chamada seguinte precisa tentar de novo.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('rede caiu'))
      .mockResolvedValue(respostaOk())
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)

    await expect(provider.buscarPorCep('01001000')).rejects.toBeInstanceOf(ServicoIndisponivelError)

    const endereco = await provider.buscarPorCep('01001000')
    expect(endereco.cidade).toBe('São Paulo')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('não guarda CEP inexistente em cache', async () => {
    // Se o ViaCEP responder "erro" por instabilidade, não queremos fixar
    // "esse CEP não existe" para um CEP que existe.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ erro: true }) })
      .mockResolvedValue(respostaOk())
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)

    await expect(provider.buscarPorCep('01001000')).rejects.toBeInstanceOf(CepInvalidoError)
    await expect(provider.buscarPorCep('01001000')).resolves.toMatchObject({ uf: 'SP' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('não cresce sem limite: descarta a entrada mais antiga ao encher', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const cep = String(url).match(/(\d{8})/)?.[1] ?? '00000000'
      return {
        ok: true,
        json: async () => ({
          cep,
          logradouro: 'Rua Teste',
          bairro: 'Centro',
          localidade: 'São Paulo',
          uf: 'SP',
        }),
      }
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch, { maxEntradas: 2 })

    await provider.buscarPorCep('01001000')
    await provider.buscarPorCep('02002000')
    await provider.buscarPorCep('03003000')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // O primeiro foi descartado e precisa de nova busca; o último continua.
    await provider.buscarPorCep('03003000')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await provider.buscarPorCep('01001000')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('ViaCepProvider — timeout', () => {
  it('desiste da requisição pendurada e devolve ServicoIndisponivelError', async () => {
    // Um ViaCEP que aceita a conexão e nunca responde seguraria a requisição
    // do usuário até o timeout do runtime.
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolver, rejeitar) => {
          init?.signal?.addEventListener('abort', () => rejeitar(new Error('AbortError')))
        }),
    )
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch, { timeoutMs: 30 })

    await expect(provider.buscarPorCep('01001000')).rejects.toBeInstanceOf(ServicoIndisponivelError)
  })

  it('passa um signal para o fetch, para a requisição ser cancelável', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cep: '01001-000',
        logradouro: 'Praça da Sé',
        bairro: 'Sé',
        localidade: 'São Paulo',
        uf: 'SP',
      }),
    })
    const provider = new ViaCepProvider(fetchMock as unknown as typeof fetch)

    await provider.buscarPorCep('01001000')

    const [, init] = fetchMock.mock.calls[0] as [string, { signal?: AbortSignal }]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
