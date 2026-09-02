import { NextRequest, NextResponse } from 'next/server'
import { respostaErro } from '../../../_lib/erro'
import { autenticarRequisicao, obterHistorico } from '@/server/api-publica-service'

/**
 * `GET /api/v0/order/history/:id` — o que já aconteceu com o envio.
 *
 * Existe para que saber de uma mudança não dependa de repetir a consulta de
 * estado: o integrador lê a linha do tempo inteira de uma vez e compara com o
 * que já tinha, em vez de gastar cota perguntando "mudou?".
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)
    const { id } = await context.params
    return NextResponse.json(await obterHistorico(contexto, id), { status: 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em GET /api/v0/order/history')
  }
}
