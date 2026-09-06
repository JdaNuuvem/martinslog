import { NextRequest, NextResponse } from 'next/server'
import {
  CancelamentoNaoPermitidoError,
  DomainError,
  EnvioNaoEncontradoError,
} from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { cancelarEtiqueta } from '@/server/etiquetas-service'
import { cancelarEtiquetaComoAdmin } from '@/server/admin/envios'

/**
 * Cancela um envio do próprio usuário. **Não devolve dinheiro** — a
 * confirmação na interface diz isso antes de chegar aqui.
 *
 * Envio de outro usuário devolve 404, nunca 403, seguindo o padrão do resto
 * da API: quem chuta um id não descobre se ele existe.
 *
 * A exceção é o ADMINISTRADOR, que enxerga os envios de todas as lojas nesta
 * mesma tela. Sem isto, ele veria a lista inteira com um botão "Cancelar" que
 * responde "envio não encontrado" para tudo que não é dele — um botão que
 * mente. O caminho de administração registra quem cancelou e por quê, que é a
 * única resposta possível quando o lojista reclamar depois.
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
    if (sessao.papel === 'ADMIN') {
      await cancelarEtiquetaComoAdmin(sessao.userId, id, 'Cancelado pela administração.')
    } else {
      await cancelarEtiqueta(sessao.userId, id)
    }
    return NextResponse.json({ status: 'CANCELLED' }, { status: 200 })
  } catch (error) {
    if (error instanceof EnvioNaoEncontradoError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: 'Envio não encontrado.' },
        { status: 404 },
      )
    }

    if (error instanceof CancelamentoNaoPermitidoError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 409 })
    }

    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao cancelar envio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao cancelar o envio.' },
      { status: 500 },
    )
  }
}
