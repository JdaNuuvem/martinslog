import { describe, expect, it } from 'vitest'
import { deveEstornar, garantirTransicao, podeCancelar } from './estados'
import { TransicaoInvalidaError } from '../errors'

describe('garantirTransicao', () => {
  it('aceita o caminho feliz', () => {
    expect(() => garantirTransicao('PENDING', 'RELEASED')).not.toThrow()
    expect(() => garantirTransicao('RELEASED', 'GENERATED')).not.toThrow()
    expect(() => garantirTransicao('GENERATED', 'POSTED')).not.toThrow()
    expect(() => garantirTransicao('POSTED', 'DELIVERED')).not.toThrow()
  })

  it('recusa pular etapas', () => {
    expect(() => garantirTransicao('PENDING', 'DELIVERED')).toThrow(TransicaoInvalidaError)
  })

  it('recusa sair de estado terminal', () => {
    expect(() => garantirTransicao('DELIVERED', 'POSTED')).toThrow(TransicaoInvalidaError)
    expect(() => garantirTransicao('CANCELLED', 'RELEASED')).toThrow(TransicaoInvalidaError)
  })

  it('aceita o envio extraviado a partir de POSTED', () => {
    expect(() => garantirTransicao('POSTED', 'LOST')).not.toThrow()
  })

  it('recusa sair do estado terminal LOST', () => {
    expect(() => garantirTransicao('LOST', 'DELIVERED')).toThrow(TransicaoInvalidaError)
  })
})

describe('podeCancelar', () => {
  it('permite até GENERATED e proíbe a partir de POSTED', () => {
    expect(podeCancelar('PENDING')).toBe(true)
    expect(podeCancelar('RELEASED')).toBe(true)
    expect(podeCancelar('GENERATED')).toBe(true)
    expect(podeCancelar('POSTED')).toBe(false)
    expect(podeCancelar('DELIVERED')).toBe(false)
  })

  it('proíbe cancelar estados terminais', () => {
    expect(podeCancelar('CANCELLED')).toBe(false)
    expect(podeCancelar('LOST')).toBe(false)
  })
})

describe('deveEstornar', () => {
  it('estorna quando o envio pago é cancelado ou extraviado', () => {
    expect(deveEstornar('RELEASED', 'CANCELLED')).toBe(true)
    expect(deveEstornar('POSTED', 'LOST')).toBe(true)
  })

  it('não estorna quando o envio nunca foi pago', () => {
    expect(deveEstornar('PENDING', 'CANCELLED')).toBe(false)
  })

  it('não estorna entregas', () => {
    expect(deveEstornar('POSTED', 'DELIVERED')).toBe(false)
  })
})
