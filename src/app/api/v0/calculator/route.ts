import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { respostaErro } from '../_lib/erro'
import { autenticarRequisicao, calcularCotacao } from '@/server/api-publica-service'

/**
 * Corpo espelha os campos de cotação do painel (`/api/cotacao`), na forma
 * que um plugin de terceiro portado do SuperFrete já envia. `price` não
 * existe aqui de propósito: quem cota não manda preço, recebe preço.
 */
const corpoSchema = z.object({
  cepOrigem: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP de origem inválido'),
  cepDestino: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP de destino inválido'),
  formato: z.enum(['CAIXA', 'ROLO', 'ENVELOPE']),
  pesoRealG: z.number().int().positive(),
  alturaCm: z.number().int().positive(),
  larguraCm: z.number().int().positive(),
  comprimentoCm: z.number().int().positive(),
})

/** `POST /api/v0/calculator` — cotação → lista de opções com preço e prazo. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)

    const corpo = await request.json().catch(() => null)
    const analisado = corpoSchema.safeParse(corpo)
    if (!analisado.success) {
      return NextResponse.json(
        {
          codigo: 'CORPO_INVALIDO',
          mensagem: 'Dados de cotação inválidos.',
          campos: analisado.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    const opcoes = await calcularCotacao(analisado.data, contexto.userId)
    return NextResponse.json(opcoes, { status: 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em POST /api/v0/calculator')
  }
}
