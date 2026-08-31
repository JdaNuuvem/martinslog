import { NextRequest, NextResponse } from 'next/server'
import { DomainError, UsuarioNaoEncontradoError } from '@/domain/errors'
import { alterarPapelSchema } from '@/lib/admin-papel-schema'
import { exigirAdmin, respostaNaoEncontrado } from '@/server/admin/guarda'
import { alterarPapel } from '@/server/admin/papel'

/**
 * `POST /api/admin/usuarios/[id]/papel` — promove ou rebaixa o papel de um
 * usuário.
 *
 * O papel do ator (quem chama) nunca vem daqui: `exigirAdmin` já leu do
 * banco antes desta linha rodar. O papel do corpo é só o que se deseja para
 * o **alvo**, e mesmo assim passa por `alterarPapel`, que recusa a troca se
 * o alvo for o próprio ator ou se for o último administrador — as duas
 * checagens mais sensíveis desta tela inteira.
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

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = alterarPapelSchema.safeParse(corpo)
  if (!analisado.success) {
    const campos = analisado.error.flatten().fieldErrors
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: campos.papel?.[0] ?? 'Papel inválido.', campos },
      { status: 400 },
    )
  }

  try {
    const resultado = await alterarPapel(guarda.sessao.userId, userId, analisado.data.papel)
    return NextResponse.json(resultado, { status: 200 })
  } catch (error) {
    if (error instanceof UsuarioNaoEncontradoError) {
      return respostaNaoEncontrado()
    }
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao alterar papel de usuário', { userId, cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao alterar o papel do usuário.' },
      { status: 500 },
    )
  }
}
