import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { enderecoRequestSchema } from '@/lib/endereco-schema'
import { lerSessao } from '@/server/auth/sessao'
import { criarEndereco, listarEnderecos } from '@/server/enderecos-service'

/**
 * Lista os endereços (remetentes e destinatários) do usuário autenticado.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const enderecos = await listarEnderecos(sessao.userId)
  return NextResponse.json({ enderecos })
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

  const analisado = enderecoRequestSchema.safeParse(corpo)
  if (!analisado.success) {
    return NextResponse.json(
      {
        codigo: 'CORPO_INVALIDO',
        mensagem: 'Dados do endereço inválidos.',
        campos: analisado.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  try {
    const endereco = await criarEndereco(sessao.userId, analisado.data)
    return NextResponse.json({ endereco }, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status: 422 })
    }

    console.error('Erro inesperado ao criar endereço', { cause: error })
    return NextResponse.json(
      { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao criar o endereço.' },
      { status: 500 },
    )
  }
}
