import { NextRequest, NextResponse } from 'next/server'
import { UsuarioNaoEncontradoError } from '@/domain/errors'
import { exigirAdmin, respostaNaoEncontrado } from '@/server/admin/guarda'
import { obterContextoAcesso } from '@/server/admin/papel'

/**
 * `GET /api/admin/usuarios/[id]/acesso` — contexto para o cartão de "Papel
 * e acesso" da ficha do usuário: papel atual, verificação de e-mail,
 * sessões ativas, e se o alvo é o próprio ator ou o último administrador.
 *
 * Existe como rota própria (em vez de estender a consulta que já carrega a
 * ficha) porque essa consulta pertence a outra sessão de trabalho — este
 * componente busca o que precisa por conta própria.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id: userId } = await context.params

  try {
    const contexto = await obterContextoAcesso(guarda.sessao.userId, userId)
    return NextResponse.json(contexto, { status: 200 })
  } catch (error) {
    if (error instanceof UsuarioNaoEncontradoError) {
      return respostaNaoEncontrado()
    }

    console.error('Erro inesperado ao carregar contexto de acesso', { userId, cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao carregar o contexto de acesso.' },
      { status: 500 },
    )
  }
}
