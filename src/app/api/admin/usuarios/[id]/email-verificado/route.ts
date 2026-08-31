import { NextRequest, NextResponse } from 'next/server'
import { DomainError, UsuarioNaoEncontradoError } from '@/domain/errors'
import { exigirAdmin, respostaNaoEncontrado } from '@/server/admin/guarda'
import { marcarEmailVerificado } from '@/server/admin/papel'

/**
 * `POST /api/admin/usuarios/[id]/email-verificado` — marca manualmente o
 * e-mail do usuário como verificado (suporte confirmou por outro canal).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id: userId } = await context.params

  try {
    const resultado = await marcarEmailVerificado(guarda.sessao.userId, userId)
    return NextResponse.json(resultado, { status: 200 })
  } catch (error) {
    if (error instanceof UsuarioNaoEncontradoError) {
      return respostaNaoEncontrado()
    }
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao marcar e-mail como verificado', { userId, cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao marcar o e-mail como verificado.' },
      { status: 500 },
    )
  }
}
