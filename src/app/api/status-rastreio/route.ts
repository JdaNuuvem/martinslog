import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { statusRastreioRequestSchema } from '@/lib/status-rastreio-schema'
import { lerSessao } from '@/server/auth/sessao'
import {
  CODIGOS_PADRAO,
  listarStatusDaConta,
  listarStatusPadrao,
  salvarStatus,
} from '@/server/status-rastreio-service'

/**
 * Catálogo de status da conta autenticada.
 *
 * É uma tela do dono da conta, não do admin da plataforma: cada conta
 * escreve a linguagem que o destinatário dela lê, e o `userId` vem sempre da
 * sessão — nunca do corpo da requisição.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const [personalizados, padrao] = await Promise.all([
    listarStatusDaConta(sessao.userId),
    listarStatusPadrao(),
  ])

  return NextResponse.json({ personalizados, padrao, codigosPadrao: CODIGOS_PADRAO })
}

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

  const analisado = statusRastreioRequestSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do status inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    const status = await salvarStatus(sessao.userId, analisado.data)
    return NextResponse.json({ status }, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao salvar status de rastreio', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao salvar o status.' },
      { status: 500 },
    )
  }
}
