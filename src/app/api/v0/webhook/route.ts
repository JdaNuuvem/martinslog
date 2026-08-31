import { NextRequest, NextResponse } from 'next/server'
import { ArquivoInvalidoError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { cadastrarWebhook } from '@/server/webhook-service'
import { prisma } from '@/infra/db/client'

/**
 * Cadastro e listagem dos webhooks do próprio usuário.
 *
 * O segredo aparece **uma única vez**, na resposta do POST. A listagem nunca
 * o devolve: se ele pudesse ser lido depois, bastaria uma falha de
 * autorização em qualquer tela para que terceiros passassem a forjar
 * entregas assinadas.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  let corpo: { url?: unknown; eventos?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(
      { codigo: 'ARQUIVO_INVALIDO', mensagem: 'Corpo inválido.' },
      { status: 422 },
    )
  }

  const url = typeof corpo.url === 'string' ? corpo.url : ''
  const eventos = Array.isArray(corpo.eventos)
    ? corpo.eventos.filter((evento): evento is string => typeof evento === 'string')
    : []

  try {
    const criado = await cadastrarWebhook(sessao.userId, url, eventos)
    return NextResponse.json({ webhook: criado }, { status: 201 })
  } catch (error) {
    if (error instanceof ArquivoInvalidoError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao cadastrar webhook', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao cadastrar o webhook.' },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const webhooks = await prisma.webhookApp.findMany({
    where: { userId: sessao.userId },
    // `segredo` fora do select de propósito: não volta nunca depois da criação.
    select: { id: true, url: true, eventos: true, ativo: true, criadoEm: true },
    orderBy: { criadoEm: 'desc' },
  })

  return NextResponse.json({ webhooks })
}
