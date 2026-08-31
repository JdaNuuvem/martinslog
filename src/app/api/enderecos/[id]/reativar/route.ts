import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { reativarEndereco } from '@/server/enderecos-service'

type Params = { params: Promise<{ id: string }> }

/**
 * Reativa um endereço arquivado.
 *
 * `POST` e não `PUT`: é uma ação sobre o recurso, não a substituição do seu
 * conteúdo, e não carrega corpo. Fica em arquivo próprio para não competir
 * com os handlers de `/api/enderecos/[id]`.
 *
 * Endereço inexistente, de outro usuário ou que não está arquivado devolvem
 * o mesmo 404 — reativar endereço alheio não pode ser distinguível de
 * reativar um id que nunca existiu.
 */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await params

  try {
    const endereco = await reativarEndereco(sessao.userId, id)
    return NextResponse.json({ endereco })
  } catch (error) {
    if (error instanceof DomainError) {
      const status = error.codigo === 'ENDERECO_NAO_ENCONTRADO' ? 404 : 422
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status })
    }

    console.error('Erro inesperado ao reativar endereço', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao reativar o endereço.' },
      { status: 500 },
    )
  }
}
