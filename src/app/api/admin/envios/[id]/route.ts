import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { acaoEtiquetaAdminSchema } from '@/lib/admin-usuarios-schema'
import { exigirAdmin } from '@/server/admin/guarda'
import { cancelarEtiquetaComoAdmin, excluirEnvio } from '@/server/admin/envios'

/**
 * `POST /api/admin/envios/[id]` — cancela ou exclui uma etiqueta de cliente.
 *
 * As duas ações chegam pelo mesmo verbo e são distinguidas pelo campo `acao`
 * do corpo, e não por `DELETE`, justamente porque **excluir exige motivo**:
 * um `DELETE` sem corpo convida a apagar sem justificar, e a exclusão é
 * irreversível — o `AuditLog` é tudo o que sobra do envio.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id: shipmentId } = await context.params

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = acaoEtiquetaAdminSchema.safeParse(corpo)
  if (!analisado.success) {
    const campos = analisado.error.flatten().fieldErrors
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: campos.motivo?.[0] ?? campos.acao?.[0] ?? 'Ação inválida.',
        campos,
      },
      { status: 400 },
    )
  }

  const { acao, motivo } = analisado.data
  const ator = guarda.sessao.userId

  try {
    if (acao === 'CANCELAR') {
      await cancelarEtiquetaComoAdmin(ator, shipmentId, motivo)
    } else {
      await excluirEnvio(ator, shipmentId, motivo)
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { codigo: error.codigo, mensagem: error.message },
        { status: error.codigo === 'ENVIO_NAO_ENCONTRADO' ? 404 : 422 },
      )
    }

    console.error('Erro inesperado em ação administrativa sobre envio', {
      shipmentId,
      acao,
      cause: error,
    })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao executar a ação.' },
      { status: 500 },
    )
  }
}
