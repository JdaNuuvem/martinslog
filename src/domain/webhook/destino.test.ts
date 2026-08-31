import { describe, expect, it } from 'vitest'
import { ehIpPrivado, validarUrlDestino } from './destino'

describe('ehIpPrivado', () => {
  it('reconhece as faixas privadas e locais de IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '127.53.1.9',
      '10.0.0.1',
      '10.255.255.254',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.1',
      '169.254.169.254', // metadados de nuvem — o alvo clássico de SSRF
      '0.0.0.0',
      '100.64.0.1', // CGNAT
      '192.0.0.1',
    ]) {
      expect(ehIpPrivado(ip), ip).toBe(true)
    }
  })

  it('reconhece endereços locais de IPv6, inclusive IPv4 mapeado', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(ehIpPrivado(ip), ip).toBe(true)
    }
  })

  it('deixa passar endereços públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '11.0.0.1', '2001:4860:4860::8888']) {
      expect(ehIpPrivado(ip), ip).toBe(false)
    }
  })
})

describe('validarUrlDestino', () => {
  it('aceita uma URL https pública', () => {
    expect(validarUrlDestino('https://exemplo.com.br/webhook').valida).toBe(true)
  })

  it('recusa http sem TLS', () => {
    // O corpo carrega dados do envio e a assinatura; em texto claro ambos
    // vazam para qualquer intermediário.
    const resultado = validarUrlDestino('http://exemplo.com.br/webhook')

    expect(resultado.valida).toBe(false)
    if (!resultado.valida) expect(resultado.motivo).toMatch(/https/i)
  })

  it('recusa esquemas que não são http(s)', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://exemplo.com',
      'ftp://exemplo.com',
      'data:text/plain,oi',
    ]) {
      expect(validarUrlDestino(url).valida, url).toBe(false)
    }
  })

  it('recusa host literal em faixa interna, sem precisar resolver DNS', () => {
    for (const url of [
      'https://127.0.0.1/webhook',
      'https://localhost/webhook',
      'https://10.0.0.5/webhook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/webhook',
    ]) {
      expect(validarUrlDestino(url).valida, url).toBe(false)
    }
  })

  it('recusa URL com credenciais embutidas', () => {
    expect(validarUrlDestino('https://usuario:senha@exemplo.com/webhook').valida).toBe(false)
  })

  it('recusa texto que não é URL', () => {
    for (const url of ['', 'exemplo.com', 'nao é url', '://']) {
      expect(validarUrlDestino(url).valida, url).toBe(false)
    }
  })
})
