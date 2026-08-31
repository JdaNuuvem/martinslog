import { NextRequest, NextResponse } from 'next/server'
import { DomainError, UsuarioNaoEncontradoError } from '@/domain/errors'
import { exigirAdmin, respostaNaoEncontrado } from '@/server/admin/guarda'
import { encerrarSessoesUsuario } from '@/server/admin/papel'

/**
 * `POST /api/admin/usuarios/[id]/sessoes` — encerra todas as sessões da
 * conta.
 *
 * É a ferramenta para uma conta comprometida: apaga as linhas `Session` do
 * banco (não um cookie), então qualquer dispositivo com o cookie antigo
 * deixa de autenticar na próxima requisição — `lerSessao` confirma a sessão
 * no banco a cada leitura, e a linha simplesmente não existe mais.
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
    const resultado = await encerrarSessoesUsuario(guarda.sessao.userId, userId)
    return NextResponse.json(resultado, { status: 200 })
  } catch (error) {
    if (error instanceof UsuarioNaoEncontradoError) {
      return respostaNaoEncontrado()
    }
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao encerrar sessões de usuário', { userId, cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao encerrar as sessões.' },
      { status: 500 },
    )
  }
}
