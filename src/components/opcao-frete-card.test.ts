import { describe, expect, it } from 'vitest'
import { destinoDaOpcao } from './opcao-frete-card'

describe('destinoDaOpcao', () => {
  it('leva o autenticado ao fluxo de envio com a cotação escolhida', () => {
    expect(destinoDaOpcao('cot-1', 'serv-1', true)).toBe(
      '/envios/novo?quoteId=cot-1&servicoId=serv-1',
    )
  })

  it('leva o visitante ao login com o fluxo guardado no destino', () => {
    expect(destinoDaOpcao('cot-1', 'serv-1', false)).toBe(
      '/login?destino=%2Fenvios%2Fnovo%3FquoteId%3Dcot-1%26servicoId%3Dserv-1',
    )
  })

  it('escapa identificadores para não quebrar a query', () => {
    expect(destinoDaOpcao('a&b', 'c d', true)).toBe('/envios/novo?quoteId=a%26b&servicoId=c%20d')
  })
})
