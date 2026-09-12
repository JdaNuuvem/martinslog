import { NextRequest, NextResponse } from 'next/server'
import { DomainError, EnvioNaoEncontradoError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { donoEfetivo } from '@/server/dono-efetivo'
import { reenviarAvisoDoStatus } from '@/server/reenvio-aviso-service'

/**
 * Reenvia ao comprador o aviso da situação atual do envio.
 *
 * Envio de outro usuário devolve 404, nunca 403, seguindo o padrão do resto
 * da API: quem chuta um id não descobre se ele existe.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await context.params

  try {
    // Mesma resolução de dono das outras ações da linha: sem ela, o botão
    // responde "não encontrado" em tudo que não é do administrador.
    const reenvio = await reenviarAvisoDoStatus(await donoEfetivo(sessao, id), id)
    return NextResponse.json({ reenvio }, { status: 200 })
  } catch (error) {
    if (error instanceof EnvioNaoEncontradoError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: 'Envio não encontrado.' },
        { status: 404 },
      )
    }

    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao reenviar o aviso do envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao reenviar o aviso.' },
      { status: 500 },
    )
  }
}
