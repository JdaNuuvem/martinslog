import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { confirmarRecargaRequestSchema } from '@/lib/carteira-schema'
import { lerSessao } from '@/server/auth/sessao'
import { confirmarRecarga } from '@/server/wallet-service'

/**
 * Confirma uma cobrança Pix simulada e credita a carteira de quem a criou.
 *
 * Rota administrativa — NUNCA chamável pelo próprio cliente confirmando o
 * próprio pagamento (isso seria saldo grátis): exige `papel === 'ADMIN'`
 * na sessão. O `userId` creditado vem sempre do `PaymentIntent` já salvo
 * (`confirmarRecarga` busca `intent.userId`), nunca do corpo da
 * requisição — mesmo um admin não pode "escolher" outro dono.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }
  if (sessao.papel !== 'ADMIN') {
    return NextResponse.json({ mensagem: 'Ação restrita a administradores.' }, { status: 403 })
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'CORPO_INVALIDO', mensagem: 'Corpo da requisição não é um JSON válido.' },
      { status: 400 },
    )
  }

  const analisado = confirmarRecargaRequestSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Identificador da cobrança inválido.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    await confirmarRecarga(analisado.data.paymentIntentId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof DomainError) {
      const status = error.codigo === 'PAGAMENTO_NAO_ENCONTRADO' ? 404 : 422
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status })
    }

    console.error('Erro inesperado ao confirmar recarga', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao confirmar a recarga.' },
      { status: 500 },
    )
  }
}
