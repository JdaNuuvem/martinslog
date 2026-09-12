import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('POST /api/admin/leads/[id]/cpf', () => {
  it('devolve 404 para quem não é admin, nunca 403', async () => {
    /*
      403 confirmaria que existe um painel administrativo ali, dando alvo a
      quem sonda. Para quem não é admin a área simplesmente não existe.
    */
    const requisicao = new NextRequest('http://localhost/api/admin/leads/abc/cpf', {
      method: 'POST',
    })

    const resposta = await POST(requisicao, { params: Promise.resolve({ id: 'abc' }) })

    expect(resposta.status).toBe(404)
  })
})
