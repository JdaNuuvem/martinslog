import { describe, expect, it } from 'vitest'
import { ehIpBrasileiro, ehIpPrivado, paraInteiro, totalDeFaixas } from './brasil'

/**
 * O bloqueio por país erra de dois jeitos, e os dois custam caro.
 *
 * Barrar quem devia entrar é venda perdida sem ninguém saber — o visitante
 * simplesmente vai embora. Deixar entrar quem devia ser barrado esvazia o
 * recurso. Os testes abaixo cobrem as duas direções com endereços reais.
 */

describe('faixas do Brasil', () => {
  it('a lista carregou', () => {
    /*
      O teste mais importante do arquivo. Se a leitura falhar, `ehIpBrasileiro`
      passa a responder `false` para TODO MUNDO — e o site fecha para o país
      inteiro sem lançar erro nenhum.
    */
    expect(totalDeFaixas()).toBeGreaterThan(2000)
  })

  it('reconhece endereços brasileiros conhecidos', () => {
    // O próprio servidor da Martins Log, na Hostinger de Campinas.
    expect(ehIpBrasileiro('179.199.137.189')).toBe(true)
    // Faixas históricas da RNP e de operadoras nacionais.
    expect(ehIpBrasileiro('200.130.0.1')).toBe(true)
    expect(ehIpBrasileiro('189.1.0.1')).toBe(true)
  })

  it('recusa endereços de fora', () => {
    // Servidor do integrador, em Nova Jersey — o caso que motivou a exceção
    // da API: bloqueá-lo derrubaria toda venda das lojas.
    expect(ehIpBrasileiro('178.128.146.121')).toBe(false)
    // DNS do Google e da Cloudflare.
    expect(ehIpBrasileiro('8.8.8.8')).toBe(false)
    expect(ehIpBrasileiro('1.1.1.1')).toBe(false)
  })

  it('entende IPv4 embrulhado em IPv6', () => {
    // Chega assim quando o servidor escuta nas duas pilhas. Sem desembrulhar,
    // um brasileiro legítimo viraria "endereço inválido" e seria barrado.
    expect(ehIpBrasileiro('::ffff:179.199.137.189')).toBe(true)
  })

  it('recusa o que não é IPv4, em vez de deixar passar', () => {
    for (const lixo of ['', 'nao-e-ip', '999.1.1.1', '1.2.3', '1.2.3.4.5', '2001:db8::1']) {
      expect(paraInteiro(lixo), lixo).toBeNull()
      expect(ehIpBrasileiro(lixo), lixo).toBe(false)
    }
  })
})

describe('endereços sem país', () => {
  it('reconhece rede interna e laço local', () => {
    /*
      É por eles que a verificação de saúde do próprio servidor chega. Um
      bloqueio que derruba a verificação de saúde derruba a aplicação inteira
      achando que está protegendo.
    */
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.9', '192.168.1.1', '169.254.1.1']) {
      expect(ehIpPrivado(ip), ip).toBe(true)
    }
  })

  it('reconhece a rede compartilhada de operadora', () => {
    // Muita operadora móvel brasileira entrega o cliente por CGNAT, e o IP
    // público real não aparece. Tratar como privado evita barrar celular.
    expect(ehIpPrivado('100.64.0.1')).toBe(true)
    expect(ehIpPrivado('100.127.255.254')).toBe(true)
  })

  it('não confunde endereço público com privado', () => {
    for (const ip of ['179.199.137.189', '8.8.8.8', '100.63.255.255', '100.128.0.1']) {
      expect(ehIpPrivado(ip), ip).toBe(false)
    }
  })
})
