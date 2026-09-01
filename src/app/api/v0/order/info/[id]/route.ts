import { NextRequest, NextResponse } from 'next/server'
import { respostaErro } from '../../../_lib/erro'
import { autenticarRequisicao, obterInfoEnvio } from '@/server/api-publica-service'

/**
 * `GET /api/v0/order/info/:id` — detalhe do envio, com código de rastreio.
 * O envio é sempre resolvido pelo dono do token: um id de outro lojista
 * devolve 404 pelo mesmo caminho de "não existe" (`EnvioNaoEncontradoError`
 * em `respostaErro`), nunca 403 — a resposta não confirma nem nega, pela
 * diferença de código, que aquele id existe em outra conta.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const contexto = await autenticarRequisicao(request)
    const { id } = await context.params
    const info = await obterInfoEnvio(contexto, id)
    return NextResponse.json(info, { status: 200 })
  } catch (error) {
    return respostaErro(error, 'Erro inesperado em GET /api/v0/order/info/[id]')
  }
}
