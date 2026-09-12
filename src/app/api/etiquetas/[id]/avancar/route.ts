import { NextRequest, NextResponse } from 'next/server'
import { DomainError, EnvioNaoEncontradoError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { avancarEtapa } from '@/server/avancar-etapa-service'
import { donoEfetivo } from '@/server/dono-efetivo'

/**
 * Avança o envio do próprio usuário para a próxima etapa do percurso.
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
    // Mesma resolução de dono que o lote já fazia: sem ela, o botão de uma
    // linha só responde "não encontrado" em tudo que não é do administrador.
    const etapa = await avancarEtapa(await donoEfetivo(sessao, id), id)
    return NextResponse.json({ etapa }, { status: 200 })
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

    console.error('Erro inesperado ao avançar a etapa do envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao avançar a etapa.' },
      { status: 500 },
    )
  }
}
