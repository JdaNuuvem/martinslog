import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/infra/db/client'
import { exigirAdmin } from '@/server/admin/guarda'

/**
 * Mostra o comprovante que o comprador anexou.
 *
 * É uma rota, e não uma página, porque o que se quer aqui é ver a imagem — e o
 * que a loja guarda é uma URI de dados. Servir os bytes direto abre a imagem no
 * visualizador do navegador, com zoom, em vez de espremê-la num cartão.
 *
 * Quando o comprovante for um endereço http (para onde isto deve caminhar), a
 * rota redireciona em vez de servir: baixar e reservir o arquivo de outro
 * servidor só acrescentaria uma cópia e uma chance de erro.
 *
 * `no-store`: é documento de pagamento de uma pessoa. Não fica em cache de
 * navegador nem de intermediário.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarda = await exigirAdmin(request)
  if (!guarda.autorizado) {
    return guarda.resposta
  }

  const { id } = await context.params

  const pedido = await prisma.pedido.findUnique({
    where: { id },
    select: { comprovante: true, externalId: true },
  })

  if (!pedido?.comprovante) {
    return NextResponse.json(
      { codigo: 'SEM_COMPROVANTE', mensagem: 'Este pedido não tem comprovante anexado.' },
      { status: 404 },
    )
  }

  if (/^https?:\/\//i.test(pedido.comprovante)) {
    return NextResponse.redirect(pedido.comprovante)
  }

  const casamento = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(pedido.comprovante)
  if (!casamento) {
    return NextResponse.json(
      {
        codigo: 'COMPROVANTE_ILEGIVEL',
        mensagem: 'O comprovante deste pedido não está num formato que dê para exibir.',
      },
      { status: 422 },
    )
  }

  const [, tipo, base64] = casamento
  const bytes = Buffer.from(base64!, 'base64')

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': tipo!,
      'cache-control': 'no-store',
      // `inline` para abrir na aba; o nome ajuda quem decidir salvar.
      'content-disposition': `inline; filename="comprovante-${pedido.externalId}"`,
    },
  })
}
