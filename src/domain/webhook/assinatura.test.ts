import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
  JANELA_TOLERANCIA_SEGUNDOS,
  assinarPayload,
  verificarAssinatura,
} from './assinatura'

const SEGREDO = 'segredo-de-teste-com-tamanho-suficiente'
const PAYLOAD = JSON.stringify({ event: 'order.created', data: { id: 'abc' } })
const AGORA = new Date('2026-08-31T12:00:00Z')

describe('assinarPayload', () => {
  it('assina o timestamp junto com o corpo, não apenas o corpo', () => {
    // Assinar só o corpo permitiria reenviar a mesma mensagem para sempre:
    // a assinatura continuaria válida. Com o timestamp dentro da assinatura,
    // reenviar exige forjar também o timestamp, o que exige o segredo.
    const assinatura = assinarPayload(SEGREDO, PAYLOAD, AGORA)
    const esperado = createHmac('sha256', SEGREDO)
      .update(`${Math.floor(AGORA.getTime() / 1000)}.${PAYLOAD}`)
      .digest('hex')

    expect(assinatura.assinatura).toBe(`sha256=${esperado}`)
    expect(assinatura.timestamp).toBe(String(Math.floor(AGORA.getTime() / 1000)))
  })

  it('produz assinaturas diferentes para segredos diferentes', () => {
    const a = assinarPayload(SEGREDO, PAYLOAD, AGORA)
    const b = assinarPayload(`${SEGREDO}-outro`, PAYLOAD, AGORA)

    expect(a.assinatura).not.toBe(b.assinatura)
  })

  it('produz assinaturas diferentes quando um único byte do corpo muda', () => {
    const a = assinarPayload(SEGREDO, PAYLOAD, AGORA)
    const b = assinarPayload(SEGREDO, `${PAYLOAD} `, AGORA)

    expect(a.assinatura).not.toBe(b.assinatura)
  })
})

describe('verificarAssinatura', () => {
  it('aceita uma assinatura legítima dentro da janela de tolerância', () => {
    const { assinatura, timestamp } = assinarPayload(SEGREDO, PAYLOAD, AGORA)

    expect(verificarAssinatura(SEGREDO, PAYLOAD, assinatura, timestamp, AGORA)).toBe(true)
  })

  it('recusa corpo adulterado', () => {
    const { assinatura, timestamp } = assinarPayload(SEGREDO, PAYLOAD, AGORA)
    const adulterado = PAYLOAD.replace('abc', 'xyz')

    expect(verificarAssinatura(SEGREDO, adulterado, assinatura, timestamp, AGORA)).toBe(false)
  })

  it('recusa assinatura feita com outro segredo', () => {
    const { assinatura, timestamp } = assinarPayload('segredo-do-atacante', PAYLOAD, AGORA)

    expect(verificarAssinatura(SEGREDO, PAYLOAD, assinatura, timestamp, AGORA)).toBe(false)
  })

  it('recusa reenvio antigo — proteção contra replay', () => {
    const { assinatura, timestamp } = assinarPayload(SEGREDO, PAYLOAD, AGORA)
    const muitoDepois = new Date(AGORA.getTime() + (JANELA_TOLERANCIA_SEGUNDOS + 1) * 1000)

    expect(verificarAssinatura(SEGREDO, PAYLOAD, assinatura, timestamp, muitoDepois)).toBe(false)
  })

  it('recusa timestamp no futuro além da tolerância', () => {
    const futuro = new Date(AGORA.getTime() + (JANELA_TOLERANCIA_SEGUNDOS + 1) * 1000)
    const { assinatura, timestamp } = assinarPayload(SEGREDO, PAYLOAD, futuro)

    expect(verificarAssinatura(SEGREDO, PAYLOAD, assinatura, timestamp, AGORA)).toBe(false)
  })

  it('recusa entrada malformada sem estourar', () => {
    const { timestamp } = assinarPayload(SEGREDO, PAYLOAD, AGORA)

    for (const invalida of ['', 'sha256=', 'nao-e-hex', 'md5=abc', 'sha256=zz']) {
      expect(verificarAssinatura(SEGREDO, PAYLOAD, invalida, timestamp, AGORA)).toBe(false)
    }
    expect(verificarAssinatura(SEGREDO, PAYLOAD, 'sha256=aa', 'ontem', AGORA)).toBe(false)
  })

  it('expõe os nomes de cabeçalho que a documentação promete', () => {
    expect(CABECALHO_ASSINATURA).toBe('x-frete-signature')
    expect(CABECALHO_TIMESTAMP).toBe('x-frete-timestamp')
  })
})
