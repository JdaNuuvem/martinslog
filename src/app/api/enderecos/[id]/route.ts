import { NextRequest, NextResponse } from 'next/server'
import { DomainError } from '@/domain/errors'
import { enderecoRequestSchema } from '@/lib/endereco-schema'
import { lerSessao } from '@/server/auth/sessao'
import { arquivarEndereco, atualizarEndereco, buscarEnderecoDoUsuario } from '@/server/enderecos-service'

type Params = { params: Promise<{ id: string }> }

/**
 * Traduz erros de domínio para status HTTP. `ENDERECO_NAO_ENCONTRADO` vira
 * 404 tanto para "não existe" quanto para "pertence a outro usuário" — as
 * duas situações são indistinguíveis para quem chama a API.
 */
function respostaDeErro(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    const status = error.codigo === 'ENDERECO_NAO_ENCONTRADO' ? 404 : 422
    return NextResponse.json({ codigo: error.codigo, mensagem: error.message }, { status })
  }

  console.error('Erro inesperado ao processar endereço', { cause: error })
  return NextResponse.json(
    { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado ao processar o endereço.' },
    { status: 500 },
  )
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await params

  try {
    const endereco = await buscarEnderecoDoUsuario(sessao.userId, id)
    return NextResponse.json({ endereco })
  } catch (error) {
    return respostaDeErro(error)
  }
}

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await params

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
    const endereco = await atualizarEndereco(sessao.userId, id, analisado.data)
    return NextResponse.json({ endereco })
  } catch (error) {
    return respostaDeErro(error)
  }
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sessao = await lerSessao(request)
  if (!sessao) {
    return NextResponse.json({ mensagem: 'Não autenticado.' }, { status: 401 })
  }

  const { id } = await params

  try {
    await arquivarEndereco(sessao.userId, id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return respostaDeErro(error)
  }
}
