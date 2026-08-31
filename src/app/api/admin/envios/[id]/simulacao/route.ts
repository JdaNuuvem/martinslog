import { NextRequest, NextResponse } from 'next/server'
import { DomainError, EnvioNaoEncontradoError } from '@/domain/errors'
import { acaoSimulacaoSchema } from '@/lib/simulacao-schema'
import { exigirAdmin, respostaNaoEncontrado } from '@/server/admin/guarda'
import {
  aplicarStatusAgora,
  forcarProximoEvento,
  reiniciarLinhaDoTempo,
  trocarCenario,
} from '@/server/admin/simulacao'

/**
 * Intervenções administrativas na linha do tempo de um envio: trocar o
 * cenário, forçar o próximo evento e reiniciar a simulação.
 *
 * As três chegam pela mesma rota porque operam sobre o mesmo recurso — a
 * linha do tempo daquele envio — e porque assim a guarda de acesso e a
 * validação do corpo existem em um lugar só. Cada uma grava `AuditLog` no
 * serviço correspondente.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id } = await context.params

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = acaoSimulacaoSchema.safeParse(corpo)
  if (!analisado.success) {
    const campos = analisado.error.flatten().fieldErrors
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem:
          campos.acao?.[0] ?? campos.cenario?.[0] ?? 'Ação de simulação inválida.',
        campos,
      },
      { status: 400 },
    )
  }

  const acao = analisado.data
  const ator = guarda.sessao.userId

  try {
    switch (acao.acao) {
      case 'TROCAR_CENARIO':
        // O schema garante que `cenario` existe quando a ação é esta.
        await trocarCenario(ator, id, acao.cenario!)
        break
      case 'FORCAR_EVENTO':
        await forcarProximoEvento(ator, id)
        break
      case 'REINICIAR':
        await reiniciarLinhaDoTempo(ator, id)
        break
      case 'APLICAR_STATUS':
        // O schema garante que `codigo` existe quando a ação é esta.
        await aplicarStatusAgora(ator, id, acao.codigo!)
        break
    }

    return NextResponse.json({ acao: acao.acao }, { status: 200 })
  } catch (error) {
    if (error instanceof EnvioNaoEncontradoError) {
      return respostaNaoEncontrado()
    }

    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado em ação administrativa de simulação', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao executar a ação.' },
      { status: 500 },
    )
  }
}
