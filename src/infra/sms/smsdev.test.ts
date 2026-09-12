import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmsDevProvider } from './smsdev'

/**
 * Testa o provedor contra as respostas que a documentação da SMS Dev descreve.
 *
 * O caso que mais importa é o terceiro: a API responde **HTTP 200 mesmo
 * recusando** o envio, e quem decide é o campo `situacao`. Um provedor que
 * olhasse só o código HTTP gravaria entrega no histórico onde não houve
 * nenhuma — e "o cliente não recebeu" viraria um mistério com log verde.
 */

const credenciais = { chave: 'chave-de-teste' }
const sms = { para: '5511988887777', texto: 'Teste', referencia: 'msg-123' }

function responder(corpo: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SmsDevProvider', () => {
  it('aceita a resposta de sucesso e guarda o id da mensagem', async () => {
    vi.stubGlobal(
      'fetch',
      responder({ situacao: 'OK', codigo: '1', id: '637849052', descricao: 'MENSAGEM NA FILA' }),
    )

    const r = await new SmsDevProvider().enviar(credenciais, sms)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.idExterno).toBe('637849052')
  })

  it('lê também a forma de lista, que a API usa em envio múltiplo', async () => {
    vi.stubGlobal('fetch', responder([{ situacao: 'OK', codigo: '1', id: '99' }]))

    const r = await new SmsDevProvider().enviar(credenciais, sms)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.idExterno).toBe('99')
  })

  it('trata recusa como falha mesmo com HTTP 200', async () => {
    // É assim que a API recusa: status 200, situacao ERRO.
    vi.stubGlobal(
      'fetch',
      responder({ situacao: 'ERRO', codigo: '10', descricao: 'NUMERO INVALIDO' }),
    )

    const r = await new SmsDevProvider().enviar(credenciais, sms)

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.mensagem).toContain('NUMERO INVALIDO')
      expect(r.codigo).toBe('10')
      // Número inválido nunca vira válido: repetir só gasta chamada.
      expect(r.retentavel).toBe(false)
    }
  })

  it('marca falta de saldo como temporária', async () => {
    vi.stubGlobal(
      'fetch',
      responder({ situacao: 'ERRO', codigo: '20', descricao: 'SALDO INSUFICIENTE' }),
    )

    const r = await new SmsDevProvider().enviar(credenciais, sms)

    expect(r.ok).toBe(false)
    // Uma recarga no meio do caminho resolve — vale repetir.
    if (!r.ok) expect(r.retentavel).toBe(true)
  })

  it('manda a nossa referência, para o aviso de situação voltar identificado', async () => {
    const chamada = responder({ situacao: 'OK', id: '1' })
    vi.stubGlobal('fetch', chamada)

    await new SmsDevProvider().enviar(credenciais, sms)

    const corpo = JSON.parse(chamada.mock.calls[0]![1]!.body as string)
    expect(corpo.refer).toBe('msg-123')
    expect(corpo.type).toBe(9)
    expect(corpo.number).toBe('5511988887777')
    expect(corpo.key).toBe('chave-de-teste')
  })

  it('corta a referência em 100 caracteres, que é o limite do campo', async () => {
    const chamada = responder({ situacao: 'OK', id: '1' })
    vi.stubGlobal('fetch', chamada)

    await new SmsDevProvider().enviar(credenciais, { ...sms, referencia: 'x'.repeat(250) })

    const corpo = JSON.parse(chamada.mock.calls[0]![1]!.body as string)
    expect(corpo.refer).toHaveLength(100)
  })

  it('falha de rede vale repetir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const r = await new SmsDevProvider().enviar(credenciais, sms)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retentavel).toBe(true)
  })

  it('erro do servidor deles vale repetir; corpo ilegível não vira sucesso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('não é json')
        },
      } as unknown as Response),
    )

    const r = await new SmsDevProvider().enviar(credenciais, sms)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retentavel).toBe(true)
  })
})
