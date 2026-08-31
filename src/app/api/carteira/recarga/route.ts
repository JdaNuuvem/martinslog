import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { recargaRequestSchema } from '@/lib/carteira-schema'
import { lerSessao } from '@/server/auth/sessao'
import { criarRecarga } from '@/server/wallet-service'

/**
 * Cria uma cobrança Pix simulada para o usuário autenticado recarregar a
 * própria carteira. Só cria a cobrança (`PENDENTE`) — nunca credita nada:
 * a confirmação é uma rota administrativa separada
 * (`POST /api/carteira/confirmar`), que este endpoint não expõe nem chama.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
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

  const analisado = recargaRequestSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Valor de recarga inválido.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    const recarga = await criarRecarga(sessao.userId, analisado.data.valorCentavos)
    return NextResponse.json({ recarga }, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao criar recarga', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao criar a recarga.' },
      { status: 500 },
    )
  }
}
