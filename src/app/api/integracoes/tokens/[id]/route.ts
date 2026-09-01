import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { revogarToken } from '@/server/api-token-service'

/**
 * `DELETE /api/integracoes/tokens/[id]` — revoga o token. Token de outra
 * conta é tratado como inexistente (404), não 403 — a resposta não
 * confirma nem nega que aquele id existe em outra conta.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await context.params

  try {
    await revogarToken(sessao.userId, id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof DomainError) {
      const status = error.codigo === 'NAO_AUTORIZADO' ? 404 : 422
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status })
    }
    console.error('Erro inesperado ao revogar token de API', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado. Tente novamente.' },
      { status: 500 },
    )
  }
}
