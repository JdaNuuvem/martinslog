import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { tokenDeCronValido } from './webhook-cron-auth'

const TOKEN = 'a'.repeat(48)

function requisicao(authorization?: string): NextRequest {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new NextRequest('http://localhost/api/admin/webhooks/disparar', {
    method: 'POST',
    headers,
  })
}

/**
 * O token esperado é parâmetro com valor padrão vindo do ambiente, para que
 * o teste exercite as duas configurações sem depender de variável de
 * ambiente do processo — inclusive a ausência dela.
 */
describe('tokenDeCronValido', () => {
  it('aceita o token exato no cabeçalho Bearer', () => {
    expect(tokenDeCronValido(requisicao(`Bearer ${TOKEN}`), TOKEN)).toBe(true)
  })

  it('recusa tudo quando o token não está configurado', () => {
    // Variável ausente não pode virar porta aberta: sem token, nenhuma
    // requisição passa por esta via, nem com cabeçalho vazio.
    expect(tokenDeCronValido(requisicao(`Bearer ${TOKEN}`), undefined)).toBe(false)
    expect(tokenDeCronValido(requisicao('Bearer '), undefined)).toBe(false)
    expect(tokenDeCronValido(requisicao(), undefined)).toBe(false)
  })

  it('recusa token errado, mesmo com o mesmo comprimento', () => {
    expect(tokenDeCronValido(requisicao(`Bearer ${'b'.repeat(48)}`), TOKEN)).toBe(false)
  })

  it('recusa token que é prefixo do correto', () => {
    expect(tokenDeCronValido(requisicao(`Bearer ${TOKEN.slice(0, 40)}`), TOKEN)).toBe(false)
  })

  it('recusa token correto com sufixo extra', () => {
    expect(tokenDeCronValido(requisicao(`Bearer ${TOKEN}x`), TOKEN)).toBe(false)
  })

  it('exige o esquema Bearer', () => {
    expect(tokenDeCronValido(requisicao(TOKEN), TOKEN)).toBe(false)
    expect(tokenDeCronValido(requisicao(`Basic ${TOKEN}`), TOKEN)).toBe(false)
    expect(tokenDeCronValido(requisicao(`bearer ${TOKEN}`), TOKEN)).toBe(false)
  })

  it('recusa requisição sem cabeçalho de autorização', () => {
    expect(tokenDeCronValido(requisicao(), TOKEN)).toBe(false)
    expect(tokenDeCronValido(requisicao(''), TOKEN)).toBe(false)
  })
})
