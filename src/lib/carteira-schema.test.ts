import { describe, expect, it } from 'vitest'
import {
  recargaRequestSchema,
  VALOR_MAXIMO_RECARGA_CENTAVOS,
  VALOR_MINIMO_RECARGA_CENTAVOS,
} from './carteira-schema'

const NBSP = ' '

// `toLocaleString('pt-BR', { style: 'currency', ... })` usa NBSP (U+00A0)
// entre "R$" e o valor — normaliza para espaço comum antes de comparar,
// para não depender de um caractere invisível no teste.
function semEspacoFino(texto: string | undefined): string | undefined {
  return texto?.split(NBSP).join(' ')
}

describe('recargaRequestSchema — faixa de valor', () => {
  it('rejeita valor abaixo do mínimo com mensagem informando o mínimo em reais', () => {
    const resultado = recargaRequestSchema.safeParse({ valorCentavos: VALOR_MINIMO_RECARGA_CENTAVOS - 1 })
    expect(resultado.success).toBe(false)
    if (!resultado.success) {
      const mensagem = semEspacoFino(resultado.error.flatten().fieldErrors.valorCentavos?.[0])
      expect(mensagem).toContain('R$ 5,00')
      expect(mensagem?.toLowerCase()).toContain('mínimo')
    }
  })

  it('aceita o valor mínimo exato', () => {
    const resultado = recargaRequestSchema.safeParse({ valorCentavos: VALOR_MINIMO_RECARGA_CENTAVOS })
    expect(resultado.success).toBe(true)
  })

  it('rejeita valor acima do máximo com mensagem informando o máximo em reais', () => {
    const resultado = recargaRequestSchema.safeParse({ valorCentavos: VALOR_MAXIMO_RECARGA_CENTAVOS + 1 })
    expect(resultado.success).toBe(false)
    if (!resultado.success) {
      const mensagem = semEspacoFino(resultado.error.flatten().fieldErrors.valorCentavos?.[0])
      expect(mensagem).toContain('R$ 5.000,00')
      expect(mensagem?.toLowerCase()).toContain('máximo')
    }
  })

  it('aceita o valor máximo exato', () => {
    const resultado = recargaRequestSchema.safeParse({ valorCentavos: VALOR_MAXIMO_RECARGA_CENTAVOS })
    expect(resultado.success).toBe(true)
  })
})
