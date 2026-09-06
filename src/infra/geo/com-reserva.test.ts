import { describe, expect, it, vi } from 'vitest'
import { CepInvalidoError, ServicoIndisponivelError } from '@/domain/errors'
import { GeoComReserva } from './com-reserva'
import type { EnderecoCep, GeoProvider } from './provider'

/**
 * A regra entre as duas fontes de CEP, caso a caso.
 *
 * O que estes testes protegem não é a mecânica do `try/catch` — é a decisão de
 * negócio embutida nela. Cada combinação erra para um lado diferente, e o lado
 * errado custa dinheiro: recusar CEP válido é venda paga sem etiqueta; aceitar
 * CEP inexistente é etiqueta impressa para lugar nenhum.
 */

const CASA_BRANCA: EnderecoCep = {
  cep: '13700000',
  logradouro: '',
  bairro: '',
  cidade: 'Casa Branca',
  uf: 'SP',
}

const PRACA_DA_SE: EnderecoCep = {
  cep: '01001000',
  logradouro: 'Praça da Sé',
  bairro: 'Sé',
  cidade: 'São Paulo',
  uf: 'SP',
}

function fonte(resultado: EnderecoCep | Error): GeoProvider {
  return {
    buscarPorCep: vi.fn(async () => {
      if (resultado instanceof Error) throw resultado
      return resultado
    }),
  }
}

describe('GeoComReserva', () => {
  it('a principal achou: nem consulta a reserva', async () => {
    const reserva = fonte(CASA_BRANCA)
    const geo = new GeoComReserva(fonte(PRACA_DA_SE), reserva)

    expect(await geo.buscarPorCep('01001000')).toEqual(PRACA_DA_SE)
    // Consultar a reserva à toa dobraria a latência da rota mais quente do
    // produto — o CEP digitado no formulário de checkout.
    expect(reserva.buscarPorCep).not.toHaveBeenCalled()
  })

  it('a principal diz que não existe, a reserva acha: vale a reserva', async () => {
    /*
      Este é o caso que motivou a reserva existir. O ViaCEP não carrega CEP
      geral de município; sem esta linha, todo comprador de cidade pequena
      tinha a venda recusada com "CEP não encontrado" para um CEP válido.
    */
    const geo = new GeoComReserva(fonte(new CepInvalidoError('não achei')), fonte(CASA_BRANCA))

    expect(await geo.buscarPorCep('13700000')).toEqual(CASA_BRANCA)
  })

  it('a principal está fora do ar, a reserva acha: passa', async () => {
    const geo = new GeoComReserva(
      fonte(new ServicoIndisponivelError('ViaCEP caiu')),
      fonte(CASA_BRANCA),
    )

    expect(await geo.buscarPorCep('13700000')).toEqual(CASA_BRANCA)
  })

  it('as duas dizem que não existe: recusa', async () => {
    const geo = new GeoComReserva(
      fonte(new CepInvalidoError('não achei')),
      fonte(new CepInvalidoError('também não')),
    )

    await expect(geo.buscarPorCep('99999999')).rejects.toBeInstanceOf(CepInvalidoError)
  })

  it('a principal não responde e a reserva nega: NÃO recusa', async () => {
    /*
      O ramo que mais custa dinheiro. Com o ViaCEP fora do ar, uma negativa da
      BrasilAPI sozinha barraria toda venda cujo CEP ela não conhece — em
      lote, de uma vez, que é exatamente o que a segunda fonte veio evitar.

      Vira indisponibilidade: a cotação pula a validação em vez de recusar.
    */
    const geo = new GeoComReserva(
      fonte(new ServicoIndisponivelError('ViaCEP caiu')),
      fonte(new CepInvalidoError('não achei')),
    )

    await expect(geo.buscarPorCep('13700000')).rejects.toBeInstanceOf(ServicoIndisponivelError)
  })

  it('a principal nega e a reserva não responde: mantém a recusa', async () => {
    /*
      Uma fonte AFIRMOU que o CEP não existe. Deixar passar por dúvida geraria
      etiqueta para endereço inexistente — e a etiqueta errada some no
      transporte, enquanto a recusa aparece na lista de erros e alguém
      conserta.
    */
    const geo = new GeoComReserva(
      fonte(new CepInvalidoError('não achei')),
      fonte(new ServicoIndisponivelError('BrasilAPI caiu')),
    )

    await expect(geo.buscarPorCep('99999999')).rejects.toBeInstanceOf(CepInvalidoError)
  })

  it('as duas fora do ar: indisponibilidade, não recusa', async () => {
    /*
      A diferença importa a jusante: a cotação PULA a validação quando o
      serviço está indisponível, e RECUSA quando o CEP é inválido. Trocar um
      pelo outro derrubaria todas as vendas durante uma queda de fornecedor.
    */
    const geo = new GeoComReserva(
      fonte(new ServicoIndisponivelError('ViaCEP caiu')),
      fonte(new ServicoIndisponivelError('BrasilAPI caiu')),
    )

    await expect(geo.buscarPorCep('01001000')).rejects.toBeInstanceOf(ServicoIndisponivelError)
  })
})
