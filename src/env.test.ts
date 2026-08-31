import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('aceita ambiente válido', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://frete:frete@localhost:5432/frete',
      SESSION_SECRET: 'x'.repeat(32),
      NODE_ENV: 'test',
    })
    expect(env.NODE_ENV).toBe('test')
  })

  it('rejeita SESSION_SECRET curto', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgresql://frete:frete@localhost:5432/frete',
        SESSION_SECRET: 'curto',
        NODE_ENV: 'test',
      }),
    ).toThrow()
  })

  it('TRUST_PROXY_HEADERS tem padrão false quando ausente', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://frete:frete@localhost:5432/frete',
      SESSION_SECRET: 'x'.repeat(32),
      NODE_ENV: 'test',
    })
    expect(env.TRUST_PROXY_HEADERS).toBe(false)
  })

  it('TRUST_PROXY_HEADERS aceita "true" e vira booleano', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://frete:frete@localhost:5432/frete',
      SESSION_SECRET: 'x'.repeat(32),
      NODE_ENV: 'test',
      TRUST_PROXY_HEADERS: 'true',
    })
    expect(env.TRUST_PROXY_HEADERS).toBe(true)
  })
})
