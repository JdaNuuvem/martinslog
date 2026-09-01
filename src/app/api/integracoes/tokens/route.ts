import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DomainError } from '@/domain/errors'
import { lerSessao } from '@/server/auth/sessao'
import { criarToken, listarTokens } from '@/server/api-token-service'

const criarTokenSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(120, 'Nome muito longo'),
  ambiente: z.enum(['SANDBOX', 'PRODUCAO']),
})

/** `GET /api/integracoes/tokens` — lista os tokens da conta logada. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const tokens = await listarTokens(sessao.userId)
  return NextResponse.json({ tokens }, { status: 200 })
}

/**
 * `POST /api/integracoes/tokens` — cria um token. O corpo da resposta traz
 * `tokenClaro`: a única vez que o valor em claro existe fora do processo do
 * servidor.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const corpo = await request.json().catch(() => null)
  const analisado = criarTokenSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do token inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    const token = await criarToken(sessao.userId, analisado.data.nome, analisado.data.ambiente)
    return NextResponse.json({ token }, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }
    console.error('Erro inesperado ao criar token de API', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado. Tente novamente.' },
      { status: 500 },
    )
  }
}
