import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

function criarRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/cotacao', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const corpoValido = {
  cepOrigem: '01001-000',
  cepDestino: '20040-002',
  pesoG: 300,
  alturaCm: 4,
  larguraCm: 12,
  comprimentoCm: 18,
}

describe('POST /api/cotacao', () => {
  it('devolve 200 com opções para um pedido válido', async () => {
    const response = await POST(criarRequest(corpoValido))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(Array.isArray(json.opcoes)).toBe(true)
    expect(json.opcoes.length).toBeGreaterThan(0)
    expect(typeof json.quoteId).toBe('string')
  })

  it('define o cookie de sessão anônima na resposta', async () => {
    const response = await POST(criarRequest(corpoValido))
    const cookie = response.cookies.get('anon_session_id')
    expect(cookie?.value).toBeTruthy()
  })

  it('devolve 422 com CEP_INVALIDO quando o CEP é inválido', async () => {
    const response = await POST(criarRequest({ ...corpoValido, cepOrigem: 'abc' }))
    expect(response.status).toBe(422)
    const json = await response.json()
    expect(json.codigo).toBe('CEP_INVALIDO')
  })

  it('devolve 400 quando o corpo é malformado', async () => {
    const response = await POST(criarRequest({ cepOrigem: '01001-000' }))
    expect(response.status).toBe(400)
  })

  it('devolve 400 quando o corpo não é JSON válido', async () => {
    const response = await POST(criarRequest('não é json'))
    expect(response.status).toBe(400)
  })
})
