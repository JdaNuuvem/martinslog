import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { removerStatus } from '@/server/status-rastreio-service'

type Params = { params: Promise<{ id: string }> }

/**
 * Remove a personalização. O código volta ao texto padrão da plataforma em
 * vez de sumir da timeline: desligar uma personalização nunca deve apagar
 * um evento que o destinatário já esperava ver.
 *
 * Status de outra conta responde igual a inexistente.
 */
export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await params

  try {
    await removerStatus(sessao.userId, id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 404 })
    }

    console.error('Erro inesperado ao remover status de rastreio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao remover o status.' },
      { status: 500 },
    )
  }
}
